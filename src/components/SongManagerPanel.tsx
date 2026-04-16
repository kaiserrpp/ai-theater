import * as DocumentPicker from 'expo-document-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { uploadSharedSongAudio } from '../api/sharedSongUploads';
import {
  createSharedMusicalNumber,
  deleteSharedMusicalNumber,
  deleteSharedMusicalNumberAudio,
  deleteSharedSongAudio,
  registerSharedSongAudio,
  registerSharedMusicalNumberAudio,
  updateSharedMusicalNumber,
  updateSharedMusicalNumberAudio,
  updateSharedSongAudio,
  verifySongAdminPassword,
} from '../api/sharedScripts';
import {
  SharedMusicalNumberAsset,
  SharedScriptManifest,
  SharedSongAudioAsset,
  SharedSongAsset,
  SharedSongAudioKind,
} from '../types/sharedScript';
import { formatSongAudioKind } from '../utils/sharedSongs';

interface Props {
  sharedScript: SharedScriptManifest | null;
  availableRoles: string[];
  myRoles: string[];
  onManifestUpdated: (manifest: SharedScriptManifest) => void;
  standalone?: boolean;
}

const DEFAULT_UPLOAD_KIND: SharedSongAudioKind = 'karaoke';
type SongManagerViewMode = 'menu' | 'my-songs' | 'all-songs' | 'manage';
type SongPlaybackMode = SharedSongAudioKind | 'all';
type ManageSection = 'song-blocks' | 'musical-numbers';
type PlaylistEntry = {
  song: SharedSongAsset;
  audio: SharedSongAudioAsset;
};
type PlaybackSession =
  | { kind: 'single'; audio: SharedSongAudioAsset }
  | { kind: 'playlist'; mode: SongPlaybackMode; entries: PlaylistEntry[]; index: number };
let cachedSongAdminPassword: string | null = null;

const buildDefaultAudioLabel = (kind: SharedSongAudioKind, guideRoles: string[]) => {
  if (kind === 'vocal_guide') {
    return guideRoles.length > 0 ? `Vocal guide - ${guideRoles.join(' + ')}` : 'Vocal guide';
  }

  return 'Karaoke';
};

const buildDefaultMusicalNumberTitle = (songs: SharedSongAsset[]) => {
  if (songs.length === 0) {
    return 'Numero musical';
  }

  if (songs.length === 1) {
    return songs[0].title;
  }

  return `${songs[0].title} -> ${songs[songs.length - 1].title}`;
};

const resolveAssetBlob = async (asset: DocumentPicker.DocumentPickerAsset) => {
  const assetWithFile = asset as DocumentPicker.DocumentPickerAsset & { file?: File };

  if (assetWithFile.file instanceof File) {
    return assetWithFile.file;
  }

  const response = await fetch(asset.uri);
  return response.blob();
};

export const SongManagerPanel: React.FC<Props> = ({
  sharedScript,
  availableRoles,
  myRoles,
  onManifestUpdated,
  standalone = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [viewMode, setViewMode] = useState<SongManagerViewMode>('menu');
  const [isUnlocked, setIsUnlocked] = useState(Boolean(cachedSongAdminPassword));
  const [password, setPassword] = useState(cachedSongAdminPassword ?? '');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [manageSection, setManageSection] = useState<ManageSection>('song-blocks');
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedMusicalNumberId, setSelectedMusicalNumberId] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState('');
  const [audioKind, setAudioKind] = useState<SharedSongAudioKind>(DEFAULT_UPLOAD_KIND);
  const [guideRoles, setGuideRoles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [isSongPickerVisible, setIsSongPickerVisible] = useState(false);
  const [isUploadFormVisible, setIsUploadFormVisible] = useState(false);
  const [editingAudioId, setEditingAudioId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);
  const [musicalNumberTitle, setMusicalNumberTitle] = useState('');
  const [musicalNumberSongIds, setMusicalNumberSongIds] = useState<string[]>([]);
  const [expandedMusicalNumberFormSongId, setExpandedMusicalNumberFormSongId] = useState<string | null>(null);
  const [isMusicalNumberFormVisible, setIsMusicalNumberFormVisible] = useState(false);
  const [editingMusicalNumberId, setEditingMusicalNumberId] = useState<string | null>(null);
  const [isSavingMusicalNumber, setIsSavingMusicalNumber] = useState(false);
  const [deletingMusicalNumberId, setDeletingMusicalNumberId] = useState<string | null>(null);
  const [musicalNumberAudioLabel, setMusicalNumberAudioLabel] = useState('');
  const [musicalNumberAudioKind, setMusicalNumberAudioKind] =
    useState<SharedSongAudioKind>(DEFAULT_UPLOAD_KIND);
  const [musicalNumberGuideRoles, setMusicalNumberGuideRoles] = useState<string[]>([]);
  const [isMusicalNumberUploading, setIsMusicalNumberUploading] = useState(false);
  const [musicalNumberUploadProgress, setMusicalNumberUploadProgress] = useState<number | null>(null);
  const [editingMusicalNumberAudioId, setEditingMusicalNumberAudioId] = useState<string | null>(null);
  const [isSavingMusicalNumberAudio, setIsSavingMusicalNumberAudio] = useState(false);
  const [deletingMusicalNumberAudioId, setDeletingMusicalNumberAudioId] = useState<string | null>(null);
  const [isMusicalNumberAudioFormVisible, setIsMusicalNumberAudioFormVisible] = useState(false);
  const [playingPreviewAudioId, setPlayingPreviewAudioId] = useState<string | null>(null);
  const [previewAudioError, setPreviewAudioError] = useState<string | null>(null);
  const [previewAudioElement] = useState<HTMLAudioElement | null>(
    typeof Audio === 'undefined' ? null : new Audio()
  );
  const replayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayCycleRef = useRef(0);
  const playbackSessionRef = useRef<PlaybackSession | null>(null);
  const [activePlaylistMode, setActivePlaylistMode] = useState<SongPlaybackMode | null>(null);
  const totalAudioCount = useMemo(
    () => sharedScript?.songs.reduce((count, song) => count + song.audios.length, 0) ?? 0,
    [sharedScript]
  );

  const mySongs = useMemo(
    () =>
      sharedScript?.songs.filter((song) =>
        song.audios.some((audio) => audio.guideRoles.some((role) => myRoles.includes(role)))
      ) ?? [],
    [myRoles, sharedScript]
  );

  const songsForCurrentView = useMemo(() => {
    if (!sharedScript) {
      return [];
    }

    if (viewMode === 'my-songs') {
      return mySongs;
    }

    return sharedScript.songs;
  }, [mySongs, sharedScript, viewMode]);

  const musicalNumbers = useMemo(() => sharedScript?.musicalNumbers ?? [], [sharedScript]);

  useEffect(() => {
    if (!songsForCurrentView.length) {
      setSelectedSongId(null);
      return;
    }

    setSelectedSongId((previousSongId) =>
      previousSongId && songsForCurrentView.some((song) => song.id === previousSongId)
        ? previousSongId
        : songsForCurrentView[0].id
    );
  }, [songsForCurrentView]);

  useEffect(() => {
    if (!musicalNumbers.length) {
      setSelectedMusicalNumberId(null);
      return;
    }

    setSelectedMusicalNumberId((previousMusicalNumberId) =>
      previousMusicalNumberId &&
      musicalNumbers.some((musicalNumber) => musicalNumber.id === previousMusicalNumberId)
        ? previousMusicalNumberId
        : musicalNumbers[0].id
    );
  }, [musicalNumbers]);

  useEffect(() => {
    setAudioLabel('');
    setAudioKind(DEFAULT_UPLOAD_KIND);
    setGuideRoles([]);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
  }, [selectedSongId]);

  useEffect(() => {
    setMusicalNumberAudioLabel('');
    setMusicalNumberAudioKind(DEFAULT_UPLOAD_KIND);
    setMusicalNumberGuideRoles([]);
    setMusicalNumberUploadProgress(null);
    setEditingMusicalNumberAudioId(null);
    setIsMusicalNumberAudioFormVisible(false);
  }, [selectedMusicalNumberId]);

  const selectedSong = useMemo<SharedSongAsset | null>(() => {
    if (!selectedSongId) {
      return null;
    }

    return songsForCurrentView.find((song) => song.id === selectedSongId) ?? null;
  }, [selectedSongId, songsForCurrentView]);

  const selectedMusicalNumber = useMemo<SharedMusicalNumberAsset | null>(() => {
    if (!selectedMusicalNumberId) {
      return null;
    }

    return musicalNumbers.find((musicalNumber) => musicalNumber.id === selectedMusicalNumberId) ?? null;
  }, [musicalNumbers, selectedMusicalNumberId]);

  const selectedMusicalNumberFormSongs = useMemo(
    () =>
      !sharedScript
        ? []
        : musicalNumberSongIds
            .map((songId) => sharedScript.songs.find((song) => song.id === songId) ?? null)
            .filter((song): song is SharedSongAsset => Boolean(song))
            .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex),
    [musicalNumberSongIds, sharedScript]
  );

  const activePlaylistDescription = useMemo(() => {
    if (!activePlaylistMode || (viewMode !== 'my-songs' && viewMode !== 'all-songs')) {
      return null;
    }

    const scope = viewMode === 'my-songs' ? 'de tus personajes' : 'del musical';
    const modeLabel =
      activePlaylistMode === 'karaoke'
        ? 'karaokes'
        : activePlaylistMode === 'vocal_guide'
          ? 'vocal guides'
          : 'todas las canciones';

    return `Reproduciendo ${modeLabel} ${scope}.`;
  }, [activePlaylistMode, viewMode]);

  const editingAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!selectedSong || !editingAudioId) {
      return null;
    }

    return selectedSong.audios.find((audio) => audio.id === editingAudioId) ?? null;
  }, [editingAudioId, selectedSong]);

  const editingMusicalNumberAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!selectedMusicalNumber || !editingMusicalNumberAudioId) {
      return null;
    }

    return (
      selectedMusicalNumber.audios.find((audio) => audio.id === editingMusicalNumberAudioId) ?? null
    );
  }, [editingMusicalNumberAudioId, selectedMusicalNumber]);

  const toggleGuideRole = (role: string) => {
    setGuideRoles((previousRoles) =>
      previousRoles.includes(role)
        ? previousRoles.filter((currentRole) => currentRole !== role)
        : [...previousRoles, role]
    );
  };

  const toggleMusicalNumberGuideRole = (role: string) => {
    setMusicalNumberGuideRoles((previousRoles) =>
      previousRoles.includes(role)
        ? previousRoles.filter((currentRole) => currentRole !== role)
        : [...previousRoles, role]
    );
  };

  const toggleMusicalNumberSong = (songId: string) => {
    setMusicalNumberSongIds((previousSongIds) => {
      const nextSongIds = previousSongIds.includes(songId)
        ? previousSongIds.filter((currentSongId) => currentSongId !== songId)
        : [...previousSongIds, songId];

      if (!sharedScript) {
        return nextSongIds;
      }

      const sortedSongIds = nextSongIds
        .map((currentSongId) => sharedScript.songs.find((song) => song.id === currentSongId) ?? null)
        .filter((song): song is SharedSongAsset => Boolean(song))
        .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex)
        .map((song) => song.id);

      if (!editingMusicalNumberId && musicalNumberTitle.trim().length === 0) {
        const titleCandidate = buildDefaultMusicalNumberTitle(
          sortedSongIds
            .map((currentSongId) => sharedScript.songs.find((song) => song.id === currentSongId) ?? null)
            .filter((song): song is SharedSongAsset => Boolean(song))
        );
        setMusicalNumberTitle(titleCandidate);
      }

      return sortedSongIds;
    });
  };

  const toggleMusicalNumberFormSongSelection = (song: SharedSongAsset) => {
    setExpandedMusicalNumberFormSongId((previousSongId) =>
      previousSongId === song.id ? null : song.id
    );
    toggleMusicalNumberSong(song.id);
  };

  const pickPlaylistAudio = useCallback(
    (song: SharedSongAsset, mode: SongPlaybackMode): SharedSongAudioAsset | null => {
      const candidates =
        mode === 'all' ? song.audios : song.audios.filter((audio) => audio.kind === mode);

      if (!candidates.length) {
        return null;
      }

      const roleMatchedAudio = candidates.find((audio) =>
        audio.guideRoles.some((role) => myRoles.includes(role))
      );

      if (mode === 'vocal_guide' && roleMatchedAudio) {
        return roleMatchedAudio;
      }

      if (mode === 'all') {
        return candidates.find((audio) => audio.kind === 'karaoke') ?? roleMatchedAudio ?? candidates[0];
      }

      return candidates[0];
    },
    [myRoles]
  );

  const cancelQueuedReplay = useCallback((resetSession = true) => {
    if (replayTimeoutRef.current) {
      clearTimeout(replayTimeoutRef.current);
      replayTimeoutRef.current = null;
    }

    replayCycleRef.current += 1;
    if (resetSession) {
      playbackSessionRef.current = null;
      setActivePlaylistMode(null);
    }
  }, []);

  const stopPreviewAudio = useCallback(
    (options?: { cancelLoop?: boolean }) => {
      if (options?.cancelLoop !== false) {
        cancelQueuedReplay();
      }

      if (!previewAudioElement) {
        return;
      }

      previewAudioElement.pause();
      previewAudioElement.currentTime = 0;
      previewAudioElement.onended = null;
      previewAudioElement.onerror = null;
      setPlayingPreviewAudioId(null);
    },
    [cancelQueuedReplay, previewAudioElement]
  );

  const startPreviewPlayback = useCallback(
    async (audio: SharedSongAudioAsset, cycleId: number) => {
      if (!previewAudioElement) {
        setPreviewAudioError('La reproduccion de audio solo esta disponible en la app web.');
        return;
      }

      previewAudioElement.src = audio.audioUrl;
      previewAudioElement.load();
      previewAudioElement.onended = () => {
        setPlayingPreviewAudioId(null);
        replayTimeoutRef.current = setTimeout(() => {
          replayTimeoutRef.current = null;
          if (replayCycleRef.current !== cycleId) {
            return;
          }

          const session = playbackSessionRef.current;
          if (!session) {
            return;
          }

          if (session.kind === 'single') {
            void startPreviewPlayback(session.audio, cycleId);
            return;
          }

          const nextIndex = (session.index + 1) % session.entries.length;
          const nextEntry = session.entries[nextIndex];
          playbackSessionRef.current = { ...session, index: nextIndex };
          setSelectedSongId(nextEntry.song.id);
          void startPreviewPlayback(nextEntry.audio, cycleId);
        }, 3000);
      };
      previewAudioElement.onerror = () => {
        setPlayingPreviewAudioId(null);
        setPreviewAudioError('No se pudo reproducir este audio.');
      };

      try {
        previewAudioElement.currentTime = 0;
        setPlayingPreviewAudioId(audio.id);
        await previewAudioElement.play();
      } catch {
        setPlayingPreviewAudioId(null);
        setPreviewAudioError('No se pudo reproducir este audio.');
      }
    },
    [previewAudioElement]
  );

  const handlePlayPreviewAudio = useCallback(
    async (audio: SharedSongAudioAsset) => {
      if (!previewAudioElement) {
        setPreviewAudioError('La reproduccion de audio solo esta disponible en la app web.');
        return;
      }

      if (playingPreviewAudioId === audio.id) {
        stopPreviewAudio();
        return;
      }

      setPreviewAudioError(null);
      cancelQueuedReplay(false);
      stopPreviewAudio({ cancelLoop: false });
      playbackSessionRef.current = { kind: 'single', audio };
      setActivePlaylistMode(null);

      const cycleId = replayCycleRef.current;
      await startPreviewPlayback(audio, cycleId);
    },
    [cancelQueuedReplay, playingPreviewAudioId, previewAudioElement, startPreviewPlayback, stopPreviewAudio]
  );

  const handleStartPlaylist = useCallback(
    async (mode: SongPlaybackMode) => {
      if (!previewAudioElement) {
        setPreviewAudioError('La reproduccion de audio solo esta disponible en la app web.');
        return;
      }

      if (activePlaylistMode === mode) {
        stopPreviewAudio();
        return;
      }

      const entries = songsForCurrentView
        .map((song) => {
          const audio = pickPlaylistAudio(song, mode);
          return audio ? { song, audio } : null;
        })
        .filter((entry): entry is PlaylistEntry => Boolean(entry));

      if (!entries.length) {
        setPreviewAudioError(
          mode === 'karaoke'
            ? 'No hay karaokes disponibles para este listado.'
            : mode === 'vocal_guide'
              ? 'No hay vocal guides disponibles para este listado.'
              : 'No hay audios disponibles para este listado.'
        );
        return;
      }

      const preferredIndex = selectedSong
        ? entries.findIndex((entry) => entry.song.id === selectedSong.id)
        : 0;
      const nextIndex = preferredIndex >= 0 ? preferredIndex : 0;
      const nextEntry = entries[nextIndex];

      setPreviewAudioError(null);
      cancelQueuedReplay(false);
      stopPreviewAudio({ cancelLoop: false });
      playbackSessionRef.current = { kind: 'playlist', mode, entries, index: nextIndex };
      setActivePlaylistMode(mode);
      setSelectedSongId(nextEntry.song.id);

      const cycleId = replayCycleRef.current;
      await startPreviewPlayback(nextEntry.audio, cycleId);
    },
    [
      activePlaylistMode,
      cancelQueuedReplay,
      pickPlaylistAudio,
      previewAudioElement,
      selectedSong,
      songsForCurrentView,
      startPreviewPlayback,
      stopPreviewAudio,
    ]
  );

  useEffect(() => () => {
    stopPreviewAudio();
  }, [stopPreviewAudio]);

  const handleUnlock = async () => {
    if (!password.trim()) {
      setPasswordError('Introduce la password de gestion.');
      return;
    }

    setIsVerifyingPassword(true);
    setPasswordError(null);

    try {
      await verifySongAdminPassword(password.trim());
      cachedSongAdminPassword = password.trim();
      setPassword(cachedSongAdminPassword);
      setIsUnlocked(true);
      setManagerError(null);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'No se pudo validar la password.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleSelectSong = (songId: string) => {
    stopPreviewAudio();
    setSelectedSongId(songId);
    setIsSongPickerVisible(false);
    setPreviewAudioError(null);
  };

  const resetAudioForm = () => {
    stopPreviewAudio();
    setAudioLabel('');
    setAudioKind(DEFAULT_UPLOAD_KIND);
    setGuideRoles([]);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
  };

  const resetMusicalNumberForm = useCallback(() => {
    setMusicalNumberTitle('');
    setMusicalNumberSongIds([]);
    setExpandedMusicalNumberFormSongId(null);
    setIsMusicalNumberFormVisible(false);
    setEditingMusicalNumberId(null);
  }, []);

  const resetMusicalNumberAudioForm = useCallback(() => {
    stopPreviewAudio();
    setMusicalNumberAudioLabel('');
    setMusicalNumberAudioKind(DEFAULT_UPLOAD_KIND);
    setMusicalNumberGuideRoles([]);
    setMusicalNumberUploadProgress(null);
    setEditingMusicalNumberAudioId(null);
    setIsMusicalNumberAudioFormVisible(false);
  }, [stopPreviewAudio]);

  const startEditingAudio = (audio: SharedSongAudioAsset) => {
    stopPreviewAudio();
    setEditingAudioId(audio.id);
    setAudioLabel(audio.label);
    setAudioKind(audio.kind);
    setGuideRoles(audio.guideRoles);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(true);
  };

  const pickAndUploadAudioFile = async () => {
    if (!sharedScript || !selectedSong) {
      return null;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*', 'audio/mp4', 'video/mp4'],
      copyToCacheDirectory: false,
    });

    if (result.canceled) {
      return null;
    }

    const file = await resolveAssetBlob(result.assets[0]);
    setUploadProgress(0);

    return uploadSharedSongAudio({
      shareId: sharedScript.shareId,
      targetId: selectedSong.id,
      targetType: 'song',
      file,
      password: password.trim(),
      onUploadProgress: (percentage) => setUploadProgress(Math.round(percentage)),
    });
  };

  const handleUploadAudio = async () => {
    if (!sharedScript || !selectedSong) {
      return;
    }

    setManagerError(null);
    setIsUploading(true);

    try {
      const uploadedAudio = await pickAndUploadAudioFile();
      if (!uploadedAudio) {
        return;
      }
      const nextLabel = audioLabel.trim() || buildDefaultAudioLabel(audioKind, guideRoles);

      const manifest = await registerSharedSongAudio({
        shareId: sharedScript.shareId,
        songId: selectedSong.id,
        password: password.trim(),
        label: nextLabel,
        kind: audioKind,
        guideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      onManifestUpdated(manifest);
      resetAudioForm();
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'No se pudo subir el audio.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveAudioEdits = async () => {
    if (!sharedScript || !selectedSong || !editingAudio) {
      return;
    }

    setIsSavingEdit(true);
    setManagerError(null);

    try {
      const manifest = await updateSharedSongAudio({
        shareId: sharedScript.shareId,
        songId: selectedSong.id,
        audioId: editingAudio.id,
        password: password.trim(),
        label: audioLabel.trim() || buildDefaultAudioLabel(audioKind, guideRoles),
        kind: audioKind,
        guideRoles,
      });

      onManifestUpdated(manifest);
      resetAudioForm();
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudieron guardar los cambios del audio.'
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleReplaceAudio = async () => {
    if (!sharedScript || !selectedSong || !editingAudio) {
      return;
    }

    setIsSavingEdit(true);
    setManagerError(null);

    try {
      const uploadedAudio = await pickAndUploadAudioFile();
      if (!uploadedAudio) {
        return;
      }

      const manifest = await updateSharedSongAudio({
        shareId: sharedScript.shareId,
        songId: selectedSong.id,
        audioId: editingAudio.id,
        password: password.trim(),
        label: audioLabel.trim() || buildDefaultAudioLabel(audioKind, guideRoles),
        kind: audioKind,
        guideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      onManifestUpdated(manifest);
      resetAudioForm();
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo reemplazar el audio.'
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteAudio = async (audioId: string) => {
    if (!sharedScript || !selectedSong) {
      return;
    }

    setDeletingAudioId(audioId);
    setManagerError(null);

    try {
      const manifest = await deleteSharedSongAudio({
        shareId: sharedScript.shareId,
        songId: selectedSong.id,
        audioId,
        password: password.trim(),
      });

      onManifestUpdated(manifest);
      if (editingAudioId === audioId) {
        resetAudioForm();
      }
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo borrar el audio.'
      );
    } finally {
      setDeletingAudioId(null);
    }
  };

  const handleSelectMusicalNumber = (musicalNumberId: string) => {
    stopPreviewAudio();
    setSelectedMusicalNumberId(musicalNumberId);
    setPreviewAudioError(null);
  };

  const startCreatingMusicalNumber = () => {
    resetMusicalNumberAudioForm();
    setEditingMusicalNumberId(null);
    setMusicalNumberTitle('');
    setMusicalNumberSongIds([]);
    setExpandedMusicalNumberFormSongId(null);
    setIsMusicalNumberFormVisible(true);
  };

  const startEditingMusicalNumber = (musicalNumber: SharedMusicalNumberAsset) => {
    resetMusicalNumberAudioForm();
    setEditingMusicalNumberId(musicalNumber.id);
    setMusicalNumberTitle(musicalNumber.title);
    setMusicalNumberSongIds(musicalNumber.songIds);
    setExpandedMusicalNumberFormSongId(musicalNumber.songIds[0] ?? null);
    setSelectedMusicalNumberId(musicalNumber.id);
    setIsMusicalNumberFormVisible(true);
  };

  const handleSaveMusicalNumber = async () => {
    if (!sharedScript) {
      return;
    }

    setIsSavingMusicalNumber(true);
    setManagerError(null);

    try {
      const title = musicalNumberTitle.trim() || 'Numero musical';
      const manifest = editingMusicalNumberId
        ? await updateSharedMusicalNumber({
            shareId: sharedScript.shareId,
            musicalNumberId: editingMusicalNumberId,
            password: password.trim(),
            title,
            songIds: musicalNumberSongIds,
          })
        : await createSharedMusicalNumber({
            shareId: sharedScript.shareId,
            password: password.trim(),
            title,
            songIds: musicalNumberSongIds,
          });

      onManifestUpdated(manifest);
      const nextMusicalNumber =
        manifest.musicalNumbers.find((candidate) =>
          editingMusicalNumberId ? candidate.id === editingMusicalNumberId : candidate.title === title
        ) ?? manifest.musicalNumbers[0] ?? null;

      setSelectedMusicalNumberId(nextMusicalNumber?.id ?? null);
      resetMusicalNumberForm();
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo guardar el numero musical.'
      );
    } finally {
      setIsSavingMusicalNumber(false);
    }
  };

  const handleDeleteMusicalNumber = async (musicalNumberId: string) => {
    if (!sharedScript) {
      return;
    }

    setDeletingMusicalNumberId(musicalNumberId);
    setManagerError(null);

    try {
      const manifest = await deleteSharedMusicalNumber({
        shareId: sharedScript.shareId,
        musicalNumberId,
        password: password.trim(),
      });

      onManifestUpdated(manifest);
      if (editingMusicalNumberId === musicalNumberId) {
        resetMusicalNumberForm();
      }
      if (selectedMusicalNumberId === musicalNumberId) {
        setSelectedMusicalNumberId(manifest.musicalNumbers[0]?.id ?? null);
      }
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo borrar el numero musical.'
      );
    } finally {
      setDeletingMusicalNumberId(null);
    }
  };

  const pickAndUploadMusicalNumberAudioFile = async () => {
    if (!sharedScript || !selectedMusicalNumber) {
      return null;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*', 'audio/mp4', 'video/mp4'],
      copyToCacheDirectory: false,
    });

    if (result.canceled) {
      return null;
    }

    const file = await resolveAssetBlob(result.assets[0]);
    setMusicalNumberUploadProgress(0);

    return uploadSharedSongAudio({
      shareId: sharedScript.shareId,
      targetId: selectedMusicalNumber.id,
      targetType: 'musical-number',
      file,
      password: password.trim(),
      onUploadProgress: (percentage) => setMusicalNumberUploadProgress(Math.round(percentage)),
    });
  };

  const startEditingMusicalNumberAudio = (audio: SharedSongAudioAsset) => {
    stopPreviewAudio();
    setEditingMusicalNumberAudioId(audio.id);
    setMusicalNumberAudioLabel(audio.label);
    setMusicalNumberAudioKind(audio.kind);
    setMusicalNumberGuideRoles(audio.guideRoles);
    setMusicalNumberUploadProgress(null);
    setManagerError(null);
    setIsMusicalNumberAudioFormVisible(true);
  };

  const handleUploadMusicalNumberAudio = async () => {
    if (!sharedScript || !selectedMusicalNumber) {
      return;
    }

    setManagerError(null);
    setIsMusicalNumberUploading(true);

    try {
      const uploadedAudio = await pickAndUploadMusicalNumberAudioFile();
      if (!uploadedAudio) {
        return;
      }

      const manifest = await registerSharedMusicalNumberAudio({
        shareId: sharedScript.shareId,
        musicalNumberId: selectedMusicalNumber.id,
        musicalNumberTitle: selectedMusicalNumber.title,
        songIds: selectedMusicalNumber.songIds,
        password: password.trim(),
        label:
          musicalNumberAudioLabel.trim() ||
          buildDefaultAudioLabel(musicalNumberAudioKind, musicalNumberGuideRoles),
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      onManifestUpdated(manifest);
      resetMusicalNumberAudioForm();
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'No se pudo subir el audio.');
    } finally {
      setIsMusicalNumberUploading(false);
    }
  };

  const handleSaveMusicalNumberAudioEdits = async () => {
    if (!sharedScript || !selectedMusicalNumber || !editingMusicalNumberAudio) {
      return;
    }

    setIsSavingMusicalNumberAudio(true);
    setManagerError(null);

    try {
      const manifest = await updateSharedMusicalNumberAudio({
        shareId: sharedScript.shareId,
        musicalNumberId: selectedMusicalNumber.id,
        musicalNumberTitle: selectedMusicalNumber.title,
        songIds: selectedMusicalNumber.songIds,
        audioId: editingMusicalNumberAudio.id,
        password: password.trim(),
        label:
          musicalNumberAudioLabel.trim() ||
          buildDefaultAudioLabel(musicalNumberAudioKind, musicalNumberGuideRoles),
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
      });

      onManifestUpdated(manifest);
      resetMusicalNumberAudioForm();
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudieron guardar los cambios del audio.'
      );
    } finally {
      setIsSavingMusicalNumberAudio(false);
    }
  };

  const handleReplaceMusicalNumberAudio = async () => {
    if (!sharedScript || !selectedMusicalNumber || !editingMusicalNumberAudio) {
      return;
    }

    setIsSavingMusicalNumberAudio(true);
    setManagerError(null);

    try {
      const uploadedAudio = await pickAndUploadMusicalNumberAudioFile();
      if (!uploadedAudio) {
        return;
      }

      const manifest = await updateSharedMusicalNumberAudio({
        shareId: sharedScript.shareId,
        musicalNumberId: selectedMusicalNumber.id,
        musicalNumberTitle: selectedMusicalNumber.title,
        songIds: selectedMusicalNumber.songIds,
        audioId: editingMusicalNumberAudio.id,
        password: password.trim(),
        label:
          musicalNumberAudioLabel.trim() ||
          buildDefaultAudioLabel(musicalNumberAudioKind, musicalNumberGuideRoles),
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      onManifestUpdated(manifest);
      resetMusicalNumberAudioForm();
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo reemplazar el audio.'
      );
    } finally {
      setIsSavingMusicalNumberAudio(false);
    }
  };

  const handleDeleteMusicalNumberAudio = async (audioId: string) => {
    if (!sharedScript || !selectedMusicalNumber) {
      return;
    }

    setDeletingMusicalNumberAudioId(audioId);
    setManagerError(null);

    try {
      const manifest = await deleteSharedMusicalNumberAudio({
        shareId: sharedScript.shareId,
        musicalNumberId: selectedMusicalNumber.id,
        musicalNumberTitle: selectedMusicalNumber.title,
        songIds: selectedMusicalNumber.songIds,
        audioId,
        password: password.trim(),
      });

      onManifestUpdated(manifest);
      if (editingMusicalNumberAudioId === audioId) {
        resetMusicalNumberAudioForm();
      }
    } catch (error) {
      setManagerError(
        error instanceof Error ? error.message : 'No se pudo borrar el audio.'
      );
    } finally {
      setDeletingMusicalNumberAudioId(null);
    }
  };

  const isDisabled = !sharedScript;
  const isPanelVisible = standalone || isVisible;
  const canManageSongs = Platform.OS === 'web';

  const resetManagerPanels = useCallback(() => {
    setIsSongPickerVisible(false);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
    setManageSection('song-blocks');
    setIsMusicalNumberFormVisible(false);
    setEditingMusicalNumberId(null);
    setMusicalNumberSongIds([]);
    setExpandedMusicalNumberFormSongId(null);
    setMusicalNumberTitle('');
    setIsMusicalNumberAudioFormVisible(false);
    setEditingMusicalNumberAudioId(null);
    setMusicalNumberAudioLabel('');
    setMusicalNumberAudioKind(DEFAULT_UPLOAD_KIND);
    setMusicalNumberGuideRoles([]);
    setMusicalNumberUploadProgress(null);
    setManagerError(null);
    setPasswordError(null);
    setPreviewAudioError(null);
    stopPreviewAudio();
  }, [stopPreviewAudio]);

  const openViewMode = useCallback(
    (nextViewMode: SongManagerViewMode) => {
      resetManagerPanels();
      setViewMode(nextViewMode);
      if (nextViewMode === 'manage') {
        setIsSongPickerVisible(true);
      }
    },
    [resetManagerPanels]
  );

  const goBackToSongMenu = useCallback(() => {
    resetManagerPanels();
    setViewMode('menu');
  }, [resetManagerPanels]);

  const renderSongPracticeDetail = (song: SharedSongAsset | null = selectedSong) => {
    if (!song) {
      return null;
    }

    return (
      <View style={styles.songDetailBox}>
        <Text style={styles.songDetailTitle}>{song.title}</Text>
        <Text style={styles.songDetailMeta}>
          {song.sceneTitle || 'Sin escena asociada'}
        </Text>

        {song.audios.length > 0 ? (
          <View style={styles.audioList}>
            <Text style={styles.sectionTitle}>Audios disponibles</Text>
            {song.audios.map((audio) => {
              const isPlaying = playingPreviewAudioId === audio.id;

              return (
                <View key={audio.id} style={styles.audioChip}>
                  <Text style={styles.audioChipTitle}>{audio.label}</Text>
                  <Text style={styles.audioChipMeta}>
                    {formatSongAudioKind(audio.kind)}
                    {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                  </Text>
                  {audio.audioFileName ? (
                    <Text style={styles.audioChipMeta}>{audio.audioFileName}</Text>
                  ) : null}
                  <View style={styles.audioActions}>
                    <TouchableOpacity
                      style={[styles.audioActionButton, styles.audioPlayButton]}
                      onPress={() => void handlePlayPreviewAudio(audio)}
                    >
                      <View style={styles.audioButtonContent}>
                        <MaterialCommunityIcons
                          name={isPlaying ? 'stop-circle-outline' : 'play-circle-outline'}
                          size={18}
                          color="#184e77"
                        />
                        <Text style={styles.audioPlayText}>{isPlaying ? 'Detener' : 'Reproducir'}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.infoText}>Todavia no hay audios para esta cancion.</Text>
        )}

        {previewAudioError ? <Text style={styles.errorText}>{previewAudioError}</Text> : null}
        <Text style={styles.songLyrics}>{song.lyrics}</Text>
      </View>
    );
  };

  const renderSongList = (songs: SharedSongAsset[], showDetailInline = false) => (
    <View style={styles.songList}>
      {songs.map((song) => {
        const isSelected = selectedSong?.id === song.id;

        return (
          <View key={song.id} style={styles.songListItem}>
            <TouchableOpacity
              style={[styles.songRow, isSelected && styles.songRowSelected]}
              onPress={() => handleSelectSong(song.id)}
            >
            <View style={styles.songRowText}>
              <Text style={[styles.songRowTitle, isSelected && styles.songRowTitleSelected]}>
                {song.title}
              </Text>
              <Text style={styles.songRowMeta}>
                {song.sceneTitle || 'Sin escena'} · {song.audios.length} audio
                {song.audios.length === 1 ? '' : 's'}
              </Text>
            </View>
            </TouchableOpacity>
            {showDetailInline && isSelected ? renderSongPracticeDetail(song) : null}
          </View>
        );
      })}
    </View>
  );

  const renderMusicalNumberDetail = (musicalNumber: SharedMusicalNumberAsset | null = selectedMusicalNumber) => {
    if (!musicalNumber) {
      return null;
    }

    const cueSongs = sharedScript
      ? musicalNumber.songIds
          .map((songId) => sharedScript.songs.find((song) => song.id === songId) ?? null)
          .filter((song): song is SharedSongAsset => Boolean(song))
      : [];

    return (
      <View style={styles.songDetailBox}>
        <Text style={styles.songDetailTitle}>{musicalNumber.title}</Text>
        <Text style={styles.songDetailMeta}>
          {cueSongs.length} bloque{cueSongs.length === 1 ? '' : 's'} enlazado
          {cueSongs.length === 1 ? '' : 's'}
          {musicalNumber.sceneTitle ? ` · ${musicalNumber.sceneTitle}` : ''}
        </Text>

        <View style={styles.numberCueList}>
          {cueSongs.map((song) => (
            <View key={song.id} style={styles.numberCueChip}>
              <Text style={styles.numberCueChipText}>{song.title}</Text>
            </View>
          ))}
        </View>

        {musicalNumber.audios.length > 0 ? (
          <View style={styles.audioList}>
            <Text style={styles.sectionTitle}>Audios cargados</Text>
            {musicalNumber.audios.map((audio) => (
              <View key={audio.id} style={styles.audioChip}>
                <Text style={styles.audioChipTitle}>{audio.label}</Text>
                <Text style={styles.audioChipMeta}>
                  {formatSongAudioKind(audio.kind)}
                  {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                </Text>
                {audio.audioFileName ? (
                  <Text style={styles.audioChipMeta}>{audio.audioFileName}</Text>
                ) : null}
                <View style={styles.audioActions}>
                  <TouchableOpacity
                    style={[styles.audioActionButton, styles.audioEditButton]}
                    onPress={() => startEditingMusicalNumberAudio(audio)}
                  >
                    <Text style={styles.audioActionText}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.audioActionButton, styles.audioDeleteButton]}
                    onPress={() => void handleDeleteMusicalNumberAudio(audio.id)}
                    disabled={deletingMusicalNumberAudioId === audio.id}
                  >
                    <Text style={styles.audioDeleteText}>
                      {deletingMusicalNumberAudioId === audio.id ? 'Borrando...' : 'Borrar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.infoText}>Todavia no hay audios para este numero musical.</Text>
        )}
      </View>
    );
  };

  const renderMusicalNumberList = () => (
    <View style={styles.songList}>
      {musicalNumbers.map((musicalNumber) => {
        const isSelected = selectedMusicalNumber?.id === musicalNumber.id;
        const cueSongs = sharedScript
          ? musicalNumber.songIds
              .map((songId) => sharedScript.songs.find((song) => song.id === songId) ?? null)
              .filter((song): song is SharedSongAsset => Boolean(song))
          : [];

        return (
          <View key={musicalNumber.id} style={styles.songListItem}>
            <TouchableOpacity
              style={[styles.songRow, isSelected && styles.songRowSelected]}
              onPress={() => handleSelectMusicalNumber(musicalNumber.id)}
            >
              <View style={styles.songRowText}>
                <Text style={[styles.songRowTitle, isSelected && styles.songRowTitleSelected]}>
                  {musicalNumber.title}
                </Text>
                <Text style={styles.songRowMeta}>
                  {cueSongs.length} bloque{cueSongs.length === 1 ? '' : 's'} ·{' '}
                  {musicalNumber.audios.length} audio{musicalNumber.audios.length === 1 ? '' : 's'}
                </Text>
              </View>
            </TouchableOpacity>
            {isSelected ? renderMusicalNumberDetail(musicalNumber) : null}
          </View>
        );
      })}
    </View>
  );

  const renderMusicalNumberSongSelectionList = () => (
    <View style={styles.songList}>
      {sharedScript?.songs.map((song) => {
        const isSelected = musicalNumberSongIds.includes(song.id);
        const isExpanded = expandedMusicalNumberFormSongId === song.id;
        const primaryLabel = song.sceneTitle || song.title || 'Bloque de cancion';
        const secondaryLabel =
          song.sceneTitle && song.title && song.title !== song.sceneTitle
            ? song.title
            : song.audios.length > 0
              ? `${song.audios.length} audio${song.audios.length === 1 ? '' : 's'} cargado${song.audios.length === 1 ? '' : 's'}`
              : 'Sin audios cargados';

        return (
          <View key={`musical-number-form-song-${song.id}`} style={styles.songListItem}>
            <TouchableOpacity
              style={[styles.songRow, isSelected && styles.songRowSelected]}
              onPress={() => toggleMusicalNumberFormSongSelection(song)}
            >
              <View style={styles.songRowMain}>
                <View style={styles.songRowText}>
                  <Text style={[styles.songRowTitle, isSelected && styles.songRowTitleSelected]}>
                    {primaryLabel}
                  </Text>
                  <Text style={styles.songRowMeta}>{secondaryLabel}</Text>
                </View>
                <View style={[styles.selectionCheck, isSelected && styles.selectionCheckSelected]}>
                  <MaterialCommunityIcons
                    name={isSelected ? 'check-bold' : 'plus'}
                    size={18}
                    color={isSelected ? '#fff' : '#7a4d13'}
                  />
                </View>
              </View>
            </TouchableOpacity>
            {isExpanded ? (
              <View style={styles.songDetailBox}>
                <Text style={styles.songDetailTitle}>{song.title}</Text>
                <Text style={styles.songDetailMeta}>
                  {song.sceneTitle || 'Sin escena asociada'}
                </Text>
                <Text style={styles.selectionSummary}>
                  {isSelected
                    ? 'Incluido en este numero musical.'
                    : 'Toca arriba para incluir este bloque en el numero musical.'}
                </Text>
                <Text style={styles.songLyrics}>{song.lyrics}</Text>
              </View>
            ) : null}
          </View>
        );
      }) ?? null}
    </View>
  );

  const _renderSongPracticeDetailLegacy = () => {
    if (!selectedSong) {
      return null;
    }

    return (
      <View style={styles.songDetailBox}>
        <Text style={styles.songDetailTitle}>{selectedSong.title}</Text>
        <Text style={styles.songDetailMeta}>
          {selectedSong.sceneTitle || 'Sin escena asociada'}
        </Text>

        {selectedSong.audios.length > 0 ? (
          <View style={styles.audioList}>
            <Text style={styles.sectionTitle}>Audios disponibles</Text>
            {selectedSong.audios.map((audio) => {
              const isPlaying = playingPreviewAudioId === audio.id;

              return (
                <View key={audio.id} style={styles.audioChip}>
                  <Text style={styles.audioChipTitle}>{audio.label}</Text>
                  <Text style={styles.audioChipMeta}>
                    {formatSongAudioKind(audio.kind)}
                    {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                  </Text>
                  {audio.audioFileName ? (
                    <Text style={styles.audioChipMeta}>{audio.audioFileName}</Text>
                  ) : null}
                  <View style={styles.audioActions}>
                    <TouchableOpacity
                      style={[styles.audioActionButton, styles.audioPlayButton]}
                      onPress={() => void handlePlayPreviewAudio(audio)}
                    >
                      <Text style={styles.audioPlayText}>{isPlaying ? 'Detener' : 'Reproducir'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.infoText}>Todavía no hay audios para esta canción.</Text>
        )}

        {previewAudioError ? <Text style={styles.errorText}>{previewAudioError}</Text> : null}
        <Text style={styles.songLyrics}>{selectedSong.lyrics}</Text>
      </View>
    );
  };
  void _renderSongPracticeDetailLegacy;

  return (
    <View style={styles.wrapper}>
      {!standalone ? (
        <TouchableOpacity
          style={[styles.toggleButton, isDisabled && styles.toggleButtonDisabled]}
          onPress={() => setIsVisible((previousValue) => !previousValue)}
          disabled={isDisabled}
        >
          <Text style={styles.toggleButtonText}>
            {isVisible ? 'Ocultar gestion de canciones' : 'Gestionar canciones'}
            {sharedScript ? ` (${sharedScript.songs.length})` : ''}
          </Text>
        </TouchableOpacity>
      ) : null}

      {!isPanelVisible ? null : (
        <View style={styles.panel}>
          {!sharedScript ? (
            <Text style={styles.infoText}>Comparte esta obra antes de gestionar sus canciones.</Text>
          ) : (
            <>
              <Text style={styles.panelTitle}>Canciones de {sharedScript.scriptData.obra}</Text>
              <Text style={styles.panelHint}>
                {sharedScript.songs.length} canciones detectadas · {totalAudioCount} audio
                {totalAudioCount === 1 ? '' : 's'} cargado{totalAudioCount === 1 ? '' : 's'}
              </Text>

              {viewMode === 'menu' ? (
                <View style={styles.modeMenu}>
                  <TouchableOpacity
                    style={[styles.modeCard, styles.modeCardBlue]}
                    onPress={() => openViewMode('my-songs')}
                  >
                    <Text style={styles.modeCardTitle}>Mis canciones</Text>
                    <Text style={styles.modeCardText}>
                      {mySongs.length === 0
                        ? 'Todavia no hay canciones etiquetadas para tus personajes.'
                        : `${mySongs.length} canciones donde canta tu reparto.`}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modeCard, styles.modeCardPurple]}
                    onPress={() => openViewMode('all-songs')}
                  >
                    <Text style={styles.modeCardTitle}>Todas las canciones</Text>
                    <Text style={styles.modeCardText}>
                      {sharedScript.songs.length} canciones disponibles para practicar.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modeCard,
                      styles.modeCardBrown,
                      !canManageSongs && styles.modeCardDisabled,
                    ]}
                    onPress={() => openViewMode('manage')}
                    disabled={!canManageSongs}
                  >
                    <Text style={styles.modeCardTitle}>Anadir/modificar canciones</Text>
                    <Text style={styles.modeCardText}>
                      {canManageSongs
                        ? `${totalAudioCount} audio${totalAudioCount === 1 ? '' : 's'} para revisar o ampliar.`
                        : 'Disponible en la app web.'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : viewMode === 'my-songs' || viewMode === 'all-songs' ? (
                <>
                  <TouchableOpacity style={styles.secondaryAction} onPress={goBackToSongMenu}>
                    <Text style={styles.secondaryActionText}>Volver al menu de canciones</Text>
                  </TouchableOpacity>

                  <Text style={styles.selectionSummary}>
                    {viewMode === 'my-songs'
                      ? 'Canciones etiquetadas para tus personajes.'
                      : 'Listado completo de canciones de la obra.'}
                  </Text>

                  <View style={styles.playlistActions}>
                    <TouchableOpacity
                      style={[
                        styles.playlistButton,
                        styles.playlistKaraokeButton,
                        activePlaylistMode === 'karaoke' && styles.playlistButtonActive,
                      ]}
                      onPress={() => void handleStartPlaylist('karaoke')}
                    >
                      <View style={styles.playlistButtonContent}>
                        <MaterialCommunityIcons name="microphone-variant" size={17} color="#fff" />
                        <MaterialCommunityIcons
                          name={activePlaylistMode === 'karaoke' ? 'stop-circle' : 'play-circle'}
                          size={17}
                          color="#fff7dc"
                        />
                        <Text style={styles.playlistButtonText}>Karaoke</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.playlistButton,
                        styles.playlistGuideButton,
                        activePlaylistMode === 'vocal_guide' && styles.playlistButtonActive,
                      ]}
                      onPress={() => void handleStartPlaylist('vocal_guide')}
                    >
                      <View style={styles.playlistButtonContent}>
                        <MaterialCommunityIcons name="account-voice" size={17} color="#fff" />
                        <MaterialCommunityIcons
                          name={activePlaylistMode === 'vocal_guide' ? 'stop-circle' : 'play-circle'}
                          size={17}
                          color="#f4ebff"
                        />
                        <Text style={styles.playlistButtonText}>V. Guide</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.playlistButton,
                        styles.playlistAllButton,
                        activePlaylistMode === 'all' && styles.playlistButtonActive,
                      ]}
                      onPress={() => void handleStartPlaylist('all')}
                    >
                      <View style={styles.playlistButtonContent}>
                        <MaterialCommunityIcons name="playlist-music" size={17} color="#fff" />
                        <MaterialCommunityIcons
                          name={activePlaylistMode === 'all' ? 'stop-circle' : 'play-circle'}
                          size={17}
                          color="#dff3ff"
                        />
                        <Text style={styles.playlistButtonText}>Todas</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  {activePlaylistDescription ? (
                    <Text style={styles.playlistStatusText}>{activePlaylistDescription}</Text>
                  ) : null}

                  {songsForCurrentView.length > 0 ? (
                    <>
                      {renderSongList(songsForCurrentView, true)}
                    </>
                  ) : (
                    <Text style={styles.infoText}>
                      {viewMode === 'my-songs'
                        ? 'Todavia no hay canciones etiquetadas para los personajes seleccionados.'
                        : 'Esta obra todavia no tiene canciones detectadas.'}
                    </Text>
                  )}
                </>
              ) : Platform.OS !== 'web' ? (
                <>
                  <TouchableOpacity style={styles.secondaryAction} onPress={goBackToSongMenu}>
                    <Text style={styles.secondaryActionText}>Volver al menu de canciones</Text>
                  </TouchableOpacity>
                  <Text style={styles.infoText}>
                    La subida de canciones esta disponible en la app web.
                  </Text>
                </>
              ) : !isUnlocked ? (
                <>
                  <TouchableOpacity style={styles.secondaryAction} onPress={goBackToSongMenu}>
                    <Text style={styles.secondaryActionText}>Volver al menu de canciones</Text>
                  </TouchableOpacity>
                  <View style={styles.authBox}>
                    <Text style={styles.authTitle}>Password de gestion</Text>
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Introduce la password"
                      secureTextEntry
                      style={styles.passwordInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
                    <TouchableOpacity
                      style={[styles.primaryAction, isVerifyingPassword && styles.buttonDisabled]}
                      onPress={() => void handleUnlock()}
                      disabled={isVerifyingPassword}
                    >
                      <Text style={styles.primaryActionText}>
                        {isVerifyingPassword ? 'Validando...' : 'Entrar'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.secondaryAction} onPress={goBackToSongMenu}>
                    <Text style={styles.secondaryActionText}>Volver al menu de canciones</Text>
                  </TouchableOpacity>
                  <Text style={styles.successText}>Sesion de gestion activa.</Text>
                  <View style={styles.manageTabs}>
                    <TouchableOpacity
                      style={[
                        styles.manageTabButton,
                        manageSection === 'song-blocks' && styles.manageTabButtonActive,
                      ]}
                      onPress={() => {
                        setManageSection('song-blocks');
                        resetMusicalNumberForm();
                        resetMusicalNumberAudioForm();
                      }}
                    >
                      <Text
                        style={[
                          styles.manageTabButtonText,
                          manageSection === 'song-blocks' && styles.manageTabButtonTextActive,
                        ]}
                      >
                        Bloques de cancion
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.manageTabButton,
                        manageSection === 'musical-numbers' && styles.manageTabButtonActive,
                      ]}
                      onPress={() => {
                        setManageSection('musical-numbers');
                        resetAudioForm();
                      }}
                    >
                      <Text
                        style={[
                          styles.manageTabButtonText,
                          manageSection === 'musical-numbers' && styles.manageTabButtonTextActive,
                        ]}
                      >
                        Numeros musicales
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {manageSection === 'song-blocks' ? (
                    <>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    onPress={() => setIsSongPickerVisible((previousValue) => !previousValue)}
                  >
                    <Text style={styles.secondaryActionText}>
                      {isSongPickerVisible
                        ? 'Ocultar canciones'
                        : selectedSong
                          ? 'Cambiar cancion'
                          : 'Seleccionar cancion'}
                    </Text>
                  </TouchableOpacity>

                  {selectedSong ? (
                    <Text style={styles.selectionSummary}>
                      Cancion seleccionada: {selectedSong.title}
                    </Text>
                  ) : (
                    <Text style={styles.selectionSummary}>
                      Elige una cancion para ver su detalle y cargar audios.
                    </Text>
                  )}

                  {isSongPickerVisible ? (
                    <View style={styles.songList}>
                    {sharedScript.songs.map((song) => {
                      const isSelected = selectedSong?.id === song.id;

                      return (
                        <TouchableOpacity
                          key={song.id}
                          style={[styles.songRow, isSelected && styles.songRowSelected]}
                          onPress={() => handleSelectSong(song.id)}
                        >
                          <View style={styles.songRowText}>
                            <Text style={[styles.songRowTitle, isSelected && styles.songRowTitleSelected]}>
                              {song.title}
                            </Text>
                            <Text style={styles.songRowMeta}>
                              {song.sceneTitle || 'Sin escena'} · {song.audios.length} audio
                              {song.audios.length === 1 ? '' : 's'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                    </View>
                  ) : null}

                  {selectedSong ? (
                    <View style={styles.songDetailBox}>
                      <Text style={styles.songDetailTitle}>{selectedSong.title}</Text>
                      <Text style={styles.songDetailMeta}>
                        {selectedSong.sceneTitle || 'Sin escena asociada'}
                      </Text>

                      {selectedSong.audios.length > 0 ? (
                        <View style={styles.audioList}>
                          <Text style={styles.sectionTitle}>Audios cargados</Text>
                          {selectedSong.audios.map((audio) => (
                            <View key={audio.id} style={styles.audioChip}>
                              <Text style={styles.audioChipTitle}>{audio.label}</Text>
                              <Text style={styles.audioChipMeta}>
                                {formatSongAudioKind(audio.kind)}
                                {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                              </Text>
                              {audio.audioFileName ? (
                                <Text style={styles.audioChipMeta}>{audio.audioFileName}</Text>
                              ) : null}
                              <View style={styles.audioActions}>
                                <TouchableOpacity
                                  style={[styles.audioActionButton, styles.audioEditButton]}
                                  onPress={() => startEditingAudio(audio)}
                                >
                                  <Text style={styles.audioActionText}>Editar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.audioActionButton, styles.audioDeleteButton]}
                                  onPress={() => void handleDeleteAudio(audio.id)}
                                  disabled={deletingAudioId === audio.id}
                                >
                                  <Text style={styles.audioDeleteText}>
                                    {deletingAudioId === audio.id ? 'Borrando...' : 'Borrar'}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.infoText}>Todavia no hay audios para esta cancion.</Text>
                      )}

                      <Text style={styles.songLyrics}>{selectedSong.lyrics}</Text>

                      <TouchableOpacity
                        style={styles.secondaryAction}
                        onPress={() => setIsUploadFormVisible((previousValue) => !previousValue)}
                      >
                        <Text style={styles.secondaryActionText}>
                          {isUploadFormVisible
                            ? 'Ocultar menu de audio'
                            : editingAudio
                              ? 'Seguir editando audio'
                              : 'Anadir audio a esta cancion'}
                        </Text>
                      </TouchableOpacity>

                      {isUploadFormVisible ? (
                        <View style={styles.formSection}>
                          <Text style={styles.sectionTitle}>
                            {editingAudio ? 'Editar audio' : 'Nuevo audio'}
                          </Text>
                        <Text style={styles.formLabel}>Tipo de audio</Text>
                        <View style={styles.kindActions}>
                          {(['karaoke', 'vocal_guide'] as SharedSongAudioKind[]).map((kind) => (
                            <TouchableOpacity
                              key={kind}
                              style={[styles.kindButton, audioKind === kind && styles.kindButtonSelected]}
                              onPress={() => setAudioKind(kind)}
                            >
                              <Text
                                style={[
                                  styles.kindButtonText,
                                  audioKind === kind && styles.kindButtonTextSelected,
                                ]}
                              >
                                {formatSongAudioKind(kind)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        <Text style={styles.formLabel}>Etiqueta</Text>
                        <TextInput
                          value={audioLabel}
                          onChangeText={setAudioLabel}
                          placeholder={buildDefaultAudioLabel(audioKind, guideRoles)}
                          style={styles.textInput}
                        />

                        <Text style={styles.formLabel}>Personajes que cantan en este audio</Text>
                        <View style={styles.roleTags}>
                          {availableRoles.map((role) => {
                            const isSelected = guideRoles.includes(role);

                            return (
                              <TouchableOpacity
                                key={`${selectedSong.id}-${role}`}
                                style={[styles.roleTag, isSelected && styles.roleTagSelected]}
                                onPress={() => toggleGuideRole(role)}
                              >
                                <Text style={[styles.roleTagText, isSelected && styles.roleTagTextSelected]}>
                                  {role}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        {uploadProgress !== null ? (
                          <Text style={styles.progressText}>Subiendo audio... {uploadProgress}%</Text>
                        ) : null}
                        {managerError ? <Text style={styles.errorText}>{managerError}</Text> : null}

                        {editingAudio ? (
                          <View style={styles.editActionStack}>
                            <TouchableOpacity
                              style={[styles.primaryAction, isSavingEdit && styles.buttonDisabled]}
                              onPress={() => void handleSaveAudioEdits()}
                              disabled={isSavingEdit}
                            >
                              <Text style={styles.primaryActionText}>
                                {isSavingEdit ? 'Guardando...' : 'Guardar cambios'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.secondaryAction, isSavingEdit && styles.buttonDisabled]}
                              onPress={() => void handleReplaceAudio()}
                              disabled={isSavingEdit}
                            >
                              <Text style={styles.secondaryActionText}>
                                {isSavingEdit ? 'Actualizando audio...' : 'Reemplazar audio'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.cancelLink}
                              onPress={resetAudioForm}
                              disabled={isSavingEdit}
                            >
                              <Text style={styles.cancelLinkText}>Cancelar edicion</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.primaryAction, isUploading && styles.buttonDisabled]}
                            onPress={() => void handleUploadAudio()}
                            disabled={isUploading}
                          >
                            <Text style={styles.primaryActionText}>
                              {isUploading ? 'Subiendo audio...' : 'Seleccionar audio'}
                            </Text>
                          </TouchableOpacity>
                        )}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.secondaryAction}
                        onPress={() => {
                          if (isMusicalNumberFormVisible) {
                            resetMusicalNumberForm();
                            return;
                          }

                          startCreatingMusicalNumber();
                        }}
                      >
                        <Text style={styles.secondaryActionText}>
                          {isMusicalNumberFormVisible
                            ? 'Ocultar formulario de numero musical'
                            : editingMusicalNumberId
                              ? 'Seguir editando numero musical'
                              : 'Crear numero musical'}
                        </Text>
                      </TouchableOpacity>

                      {selectedMusicalNumber ? (
                        <Text style={styles.selectionSummary}>
                          Numero musical seleccionado: {selectedMusicalNumber.title}
                        </Text>
                      ) : (
                        <Text style={styles.selectionSummary}>
                          Elige o crea un numero musical enlazando varios bloques de cancion.
                        </Text>
                      )}

                      {isMusicalNumberFormVisible ? (
                        <View style={styles.formSection}>
                          <Text style={styles.sectionTitle}>
                            {editingMusicalNumberId ? 'Editar numero musical' : 'Nuevo numero musical'}
                          </Text>
                          <Text style={styles.formLabel}>Titulo</Text>
                          <TextInput
                            value={musicalNumberTitle}
                            onChangeText={setMusicalNumberTitle}
                            placeholder="Ej. Santa Fe completa"
                            style={styles.textInput}
                          />
                          <Text style={styles.formLabel}>Bloques de cancion incluidos</Text>
                          {renderMusicalNumberSongSelectionList()}
                          {selectedMusicalNumberFormSongs.length > 0 ? (
                            <Text style={styles.selectionSummary}>
                              Tramo: {selectedMusicalNumberFormSongs[0].title} ·{' '}
                              {
                                selectedMusicalNumberFormSongs[
                                  selectedMusicalNumberFormSongs.length - 1
                                ].title
                              }
                            </Text>
                          ) : null}
                          {managerError ? <Text style={styles.errorText}>{managerError}</Text> : null}
                          <TouchableOpacity
                            style={[
                              styles.primaryAction,
                              (isSavingMusicalNumber || musicalNumberSongIds.length < 2) &&
                                styles.buttonDisabled,
                            ]}
                            onPress={() => void handleSaveMusicalNumber()}
                            disabled={isSavingMusicalNumber || musicalNumberSongIds.length < 2}
                          >
                            <Text style={styles.primaryActionText}>
                              {isSavingMusicalNumber ? 'Guardando...' : 'Guardar numero musical'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.cancelLink}
                            onPress={resetMusicalNumberForm}
                            disabled={isSavingMusicalNumber}
                          >
                            <Text style={styles.cancelLinkText}>Cancelar</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      {musicalNumbers.length > 0 ? (
                        renderMusicalNumberList()
                      ) : (
                        <Text style={styles.infoText}>
                          Todavia no hay numeros musicales definidos para esta obra.
                        </Text>
                      )}

                      {selectedMusicalNumber ? (
                        <>
                          <View style={styles.manageNumberActions}>
                            <TouchableOpacity
                              style={styles.secondaryAction}
                              onPress={() => startEditingMusicalNumber(selectedMusicalNumber)}
                            >
                              <Text style={styles.secondaryActionText}>Editar numero musical</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.secondaryAction, styles.deleteAction]}
                              onPress={() => void handleDeleteMusicalNumber(selectedMusicalNumber.id)}
                              disabled={deletingMusicalNumberId === selectedMusicalNumber.id}
                            >
                              <Text style={styles.deleteActionText}>
                                {deletingMusicalNumberId === selectedMusicalNumber.id
                                  ? 'Borrando...'
                                  : 'Borrar numero musical'}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <TouchableOpacity
                            style={styles.secondaryAction}
                            onPress={() =>
                              setIsMusicalNumberAudioFormVisible((previousValue) => !previousValue)
                            }
                          >
                            <Text style={styles.secondaryActionText}>
                              {isMusicalNumberAudioFormVisible
                                ? 'Ocultar menu de audio'
                                : editingMusicalNumberAudio
                                  ? 'Seguir editando audio'
                                  : 'Anadir audio a este numero musical'}
                            </Text>
                          </TouchableOpacity>

                          {isMusicalNumberAudioFormVisible ? (
                            <View style={styles.formSection}>
                              <Text style={styles.sectionTitle}>
                                {editingMusicalNumberAudio ? 'Editar audio' : 'Nuevo audio'}
                              </Text>
                              <Text style={styles.formLabel}>Tipo de audio</Text>
                              <View style={styles.kindActions}>
                                {(['karaoke', 'vocal_guide'] as SharedSongAudioKind[]).map((kind) => (
                                  <TouchableOpacity
                                    key={`number-audio-kind-${kind}`}
                                    style={[
                                      styles.kindButton,
                                      musicalNumberAudioKind === kind && styles.kindButtonSelected,
                                    ]}
                                    onPress={() => setMusicalNumberAudioKind(kind)}
                                  >
                                    <Text
                                      style={[
                                        styles.kindButtonText,
                                        musicalNumberAudioKind === kind &&
                                          styles.kindButtonTextSelected,
                                      ]}
                                    >
                                      {formatSongAudioKind(kind)}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                              <Text style={styles.formLabel}>Etiqueta</Text>
                              <TextInput
                                value={musicalNumberAudioLabel}
                                onChangeText={setMusicalNumberAudioLabel}
                                placeholder={buildDefaultAudioLabel(
                                  musicalNumberAudioKind,
                                  musicalNumberGuideRoles
                                )}
                                style={styles.textInput}
                              />
                              <Text style={styles.formLabel}>Personajes que cantan en este audio</Text>
                              <View style={styles.roleTags}>
                                {availableRoles.map((role) => {
                                  const isSelected = musicalNumberGuideRoles.includes(role);
                                  return (
                                    <TouchableOpacity
                                      key={`${selectedMusicalNumber.id}-${role}`}
                                      style={[styles.roleTag, isSelected && styles.roleTagSelected]}
                                      onPress={() => toggleMusicalNumberGuideRole(role)}
                                    >
                                      <Text
                                        style={[
                                          styles.roleTagText,
                                          isSelected && styles.roleTagTextSelected,
                                        ]}
                                      >
                                        {role}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                              {musicalNumberUploadProgress !== null ? (
                                <Text style={styles.progressText}>
                                  Subiendo audio... {musicalNumberUploadProgress}%
                                </Text>
                              ) : null}
                              {managerError ? <Text style={styles.errorText}>{managerError}</Text> : null}
                              {editingMusicalNumberAudio ? (
                                <View style={styles.editActionStack}>
                                  <TouchableOpacity
                                    style={[
                                      styles.primaryAction,
                                      isSavingMusicalNumberAudio && styles.buttonDisabled,
                                    ]}
                                    onPress={() => void handleSaveMusicalNumberAudioEdits()}
                                    disabled={isSavingMusicalNumberAudio}
                                  >
                                    <Text style={styles.primaryActionText}>
                                      {isSavingMusicalNumberAudio ? 'Guardando...' : 'Guardar cambios'}
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[
                                      styles.secondaryAction,
                                      isSavingMusicalNumberAudio && styles.buttonDisabled,
                                    ]}
                                    onPress={() => void handleReplaceMusicalNumberAudio()}
                                    disabled={isSavingMusicalNumberAudio}
                                  >
                                    <Text style={styles.secondaryActionText}>
                                      {isSavingMusicalNumberAudio
                                        ? 'Actualizando audio...'
                                        : 'Reemplazar audio'}
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.cancelLink}
                                    onPress={resetMusicalNumberAudioForm}
                                    disabled={isSavingMusicalNumberAudio}
                                  >
                                    <Text style={styles.cancelLinkText}>Cancelar edicion</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={[
                                    styles.primaryAction,
                                    isMusicalNumberUploading && styles.buttonDisabled,
                                  ]}
                                  onPress={() => void handleUploadMusicalNumberAudio()}
                                  disabled={isMusicalNumberUploading}
                                >
                                  <Text style={styles.primaryActionText}>
                                    {isMusicalNumberUploading ? 'Subiendo audio...' : 'Seleccionar audio'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  toggleButton: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(111, 76, 25, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(111, 76, 25, 0.92)',
  },
  toggleButtonDisabled: {
    opacity: 0.55,
  },
  toggleButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  panel: {
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: '#eadfca',
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    color: '#432818',
  },
  panelHint: {
    textAlign: 'center',
    color: '#6b5b49',
    lineHeight: 20,
  },
  modeMenu: {
    gap: 12,
  },
  modeCard: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  modeCardBlue: {
    backgroundColor: 'rgba(24, 78, 119, 0.1)',
    borderColor: 'rgba(24, 78, 119, 0.24)',
  },
  modeCardPurple: {
    backgroundColor: 'rgba(104, 67, 160, 0.1)',
    borderColor: 'rgba(104, 67, 160, 0.24)',
  },
  modeCardBrown: {
    backgroundColor: 'rgba(111, 76, 25, 0.1)',
    borderColor: 'rgba(111, 76, 25, 0.24)',
  },
  modeCardDisabled: {
    opacity: 0.55,
  },
  modeCardTitle: {
    color: '#432818',
    fontSize: 16,
    fontWeight: '800',
  },
  modeCardText: {
    color: '#6b5b49',
    lineHeight: 20,
  },
  authBox: {
    gap: 12,
  },
  authTitle: {
    fontWeight: '700',
    textAlign: 'center',
    color: '#432818',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#d8cbb6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d8cbb6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  formSection: {
    gap: 12,
    marginTop: 6,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#ecdcc5',
  },
  formLabel: {
    fontWeight: '700',
    color: '#432818',
  },
  sectionTitle: {
    textAlign: 'center',
    color: '#5f3a00',
    fontWeight: '800',
  },
  primaryAction: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(24, 78, 119, 0.9)',
  },
  primaryActionText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryAction: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#f5ede3',
    borderWidth: 1,
    borderColor: '#e4d1b3',
  },
  secondaryActionText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  manageTabs: {
    flexDirection: 'row',
    gap: 10,
  },
  manageTabButton: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4d1b3',
    backgroundColor: '#f5ede3',
    alignItems: 'center',
  },
  manageTabButtonActive: {
    backgroundColor: '#fff8ef',
    borderColor: '#c29557',
  },
  manageTabButtonText: {
    color: '#6f4c19',
    fontWeight: '700',
    textAlign: 'center',
  },
  manageTabButtonTextActive: {
    color: '#7a4d13',
  },
  selectionSummary: {
    textAlign: 'center',
    color: '#6b5b49',
    lineHeight: 20,
  },
  manageNumberActions: {
    gap: 10,
  },
  deleteAction: {
    backgroundColor: '#fff4f4',
    borderColor: '#f0c8c8',
  },
  deleteActionText: {
    color: '#b3261e',
    fontWeight: '700',
    textAlign: 'center',
  },
  playlistActions: {
    flexDirection: 'row',
    gap: 8,
  },
  playlistButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  playlistButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 0,
  },
  playlistKaraokeButton: {
    backgroundColor: 'rgba(165, 37, 88, 0.9)',
    borderColor: 'rgba(165, 37, 88, 0.96)',
  },
  playlistGuideButton: {
    backgroundColor: 'rgba(91, 63, 140, 0.9)',
    borderColor: 'rgba(91, 63, 140, 0.96)',
  },
  playlistAllButton: {
    backgroundColor: 'rgba(24, 78, 119, 0.9)',
    borderColor: 'rgba(24, 78, 119, 0.96)',
  },
  playlistButtonActive: {
    opacity: 0.75,
  },
  playlistButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11.5,
    lineHeight: 14,
    textAlign: 'center',
    flexShrink: 1,
  },
  playlistStatusText: {
    textAlign: 'center',
    color: '#6b5b49',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  infoText: {
    textAlign: 'center',
    color: '#6b5b49',
    lineHeight: 20,
  },
  errorText: {
    color: '#c62828',
    textAlign: 'center',
    lineHeight: 20,
  },
  successText: {
    textAlign: 'center',
    color: '#2b9348',
    fontWeight: '700',
  },
  songList: {
    gap: 10,
  },
  songListItem: {
    gap: 10,
  },
  songRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eadfca',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  songRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  songRowSelected: {
    borderColor: '#c29557',
    backgroundColor: '#fff8ef',
  },
  songRowText: {
    gap: 4,
    flex: 1,
  },
  songRowTitle: {
    fontWeight: '700',
    color: '#2f2a24',
  },
  songRowTitleSelected: {
    color: '#7a4d13',
  },
  songRowMeta: {
    color: '#6b5b49',
    lineHeight: 20,
  },
  selectionCheck: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d8cbb6',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectionCheckSelected: {
    backgroundColor: '#7a4d13',
    borderColor: '#7a4d13',
  },
  songDetailBox: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff8ef',
    borderWidth: 1,
    borderColor: '#f0dcc0',
  },
  songDetailTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    color: '#5f3a00',
  },
  songDetailMeta: {
    textAlign: 'center',
    color: '#7a6332',
  },
  numberCueList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  numberCueChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(194, 149, 87, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(194, 149, 87, 0.3)',
  },
  numberCueChipText: {
    color: '#7a4d13',
    fontWeight: '600',
  },
  songLyrics: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#4d3b16',
  },
  audioList: {
    gap: 10,
  },
  audioChip: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#edd6b2',
  },
  audioChipTitle: {
    fontWeight: '700',
    color: '#432818',
  },
  audioChipMeta: {
    color: '#6b5b49',
    lineHeight: 20,
  },
  audioActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  audioButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioActionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  audioPlayButton: {
    backgroundColor: 'rgba(24, 78, 119, 0.1)',
    borderColor: 'rgba(24, 78, 119, 0.24)',
  },
  audioPlayText: {
    color: '#184e77',
    fontWeight: '700',
  },
  audioEditButton: {
    backgroundColor: '#f5ede3',
    borderColor: '#e4d1b3',
  },
  audioDeleteButton: {
    backgroundColor: '#fff4f4',
    borderColor: '#f0c8c8',
  },
  audioActionText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  audioDeleteText: {
    color: '#b3261e',
    fontWeight: '700',
  },
  kindActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  kindButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#f5ede3',
  },
  kindButtonSelected: {
    backgroundColor: '#7a4d13',
  },
  kindButtonText: {
    color: '#7a4d13',
    fontWeight: '700',
  },
  kindButtonTextSelected: {
    color: '#fff',
  },
  roleTags: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  roleTag: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e1d2bc',
  },
  roleTagSelected: {
    backgroundColor: '#ecd6b8',
    borderColor: '#c29557',
  },
  roleTagText: {
    color: '#7a4d13',
  },
  roleTagTextSelected: {
    color: '#5f3a00',
    fontWeight: '700',
  },
  progressText: {
    textAlign: 'center',
    color: '#184e77',
    fontWeight: '700',
  },
  editActionStack: {
    gap: 10,
  },
  cancelLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelLinkText: {
    color: '#7a4d13',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
