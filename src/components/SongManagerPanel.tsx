import * as DocumentPicker from 'expo-document-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { extractSharedSongAudioFromVideo, uploadSharedSongAudio } from '../api/sharedSongUploads';
import {
  createSharedMusicalNumber,
  deleteSharedMusicalNumber,
  deleteSharedMusicalNumberAudio,
  deleteSharedSongAudio,
  fetchSharedScript,
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
import {
  countSharedLibraryAudios,
  formatSongAudioKind,
  getSongsForLineRange,
} from '../utils/sharedSongs';
import { Dialogue } from '../types/script';
import { isSceneMarker, isSongCue } from '../utils/scriptScenes';

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
type MusicalNumberSceneOption = {
  title: string;
  songCount: number;
};
type MusicalNumberSceneEntry = {
  lineIndex: number;
  kind: 'dialogue' | 'song';
  title: string;
  meta: string;
  detailText: string;
  songId: string | null;
};
type PracticeMusicalNumberAsset = SharedMusicalNumberAsset & {
  cueSongs: SharedSongAsset[];
  rangeEntries: MusicalNumberSceneEntry[];
  practiceAudios: SharedSongAudioAsset[];
};
type PlaylistEntry = {
  musicalNumber: PracticeMusicalNumberAsset;
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

const validateAudioMetadata = ({
  label,
  guideRoles,
}: {
  label: string;
  guideRoles: string[];
}) => {
  if (!label.trim()) {
    return 'Pon un nombre al audio antes de guardarlo.';
  }

  if (guideRoles.length === 0) {
    return 'Selecciona al menos un personaje para este audio.';
  }

  return null;
};

const normalizeRange = (startLineIndex: number, endLineIndex: number) =>
  startLineIndex <= endLineIndex
    ? { startLineIndex, endLineIndex }
    : { startLineIndex: endLineIndex, endLineIndex: startLineIndex };

const truncateText = (value: string, maxLength = 96) => {
  const normalizedValue = value.replace(/\s+/g, ' ').trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 1).trimEnd()}…`;
};

const buildDialogueEntryLabel = (line: Dialogue) => {
  if (Array.isArray(line.r) && line.r.length > 0) {
    return line.r.join(' / ');
  }

  return line.p;
};

const getMusicalNumberSortIndex = (musicalNumber: SharedMusicalNumberAsset) =>
  typeof musicalNumber.startLineIndex === 'number' && musicalNumber.startLineIndex >= 0
    ? musicalNumber.startLineIndex
    : Number.MAX_SAFE_INTEGER;

const buildMusicalNumberEntryMeta = (entry: MusicalNumberSceneEntry) =>
  entry.kind === 'song' ? 'Bloque de cancion' : 'Linea hablada';

const groupCueSongsByTitle = (songs: SharedSongAsset[]) => {
  const groupedSongs = new Map<
    string,
    { key: string; title: string; count: number; lineIndexes: number[] }
  >();

  songs.forEach((song) => {
    const currentGroup = groupedSongs.get(song.title);
    if (currentGroup) {
      currentGroup.count += 1;
      currentGroup.lineIndexes.push(song.lineIndex);
      return;
    }

    groupedSongs.set(song.title, {
      key: `${song.title}:${song.id}`,
      title: song.title,
      count: 1,
      lineIndexes: [song.lineIndex],
    });
  });

  return Array.from(groupedSongs.values());
};

const buildPracticeMusicalNumberAudioLabel = (
  sourceTitle: string,
  audio: SharedSongAudioAsset
) => {
  const trimmedSourceTitle = sourceTitle.trim();
  const trimmedAudioLabel = audio.label.trim();

  if (!trimmedSourceTitle || !trimmedAudioLabel) {
    return trimmedAudioLabel || trimmedSourceTitle || 'Audio';
  }

  const normalizedSourceTitle = trimmedSourceTitle.toLowerCase();
  const normalizedAudioLabel = trimmedAudioLabel.toLowerCase();

  if (normalizedAudioLabel.startsWith(normalizedSourceTitle)) {
    return trimmedAudioLabel;
  }

  return `${trimmedSourceTitle} · ${trimmedAudioLabel}`;
};

const getManifestUpdatedAt = (manifest: SharedScriptManifest) => {
  const timestamp = Date.parse(manifest.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const pickFreshestManifest = (
  fallbackManifest: SharedScriptManifest,
  refreshedManifest: SharedScriptManifest
) => {
  const fallbackUpdatedAt = getManifestUpdatedAt(fallbackManifest);
  const refreshedUpdatedAt = getManifestUpdatedAt(refreshedManifest);

  if (refreshedUpdatedAt < fallbackUpdatedAt) {
    return fallbackManifest;
  }

  if (
    refreshedUpdatedAt === fallbackUpdatedAt &&
    countSharedLibraryAudios(refreshedManifest.songs, refreshedManifest.musicalNumbers) <
      countSharedLibraryAudios(fallbackManifest.songs, fallbackManifest.musicalNumbers)
  ) {
    return fallbackManifest;
  }

  return refreshedManifest;
};

const resolveAssetUploadFile = async (asset: DocumentPicker.DocumentPickerAsset) => {
  const assetWithFile = asset as DocumentPicker.DocumentPickerAsset & { file?: File };

  if (assetWithFile.file instanceof File) {
    return assetWithFile.file;
  }

  const response = await fetch(asset.uri);
  const fetchedBlob = await response.blob();
  const resolvedBlob =
    !fetchedBlob.type && typeof asset.mimeType === 'string' && asset.mimeType.trim().length > 0
      ? new Blob([await fetchedBlob.arrayBuffer()], { type: asset.mimeType })
      : fetchedBlob;
  const blob = resolvedBlob as Blob & { name?: string };
  blob.name =
    typeof asset.name === 'string' && asset.name.trim().length > 0 ? asset.name.trim() : 'audio';

  return blob;
};

const isVideoAsset = (file: Blob & { type?: string }) =>
  typeof file.type === 'string' && file.type.trim().toLowerCase().startsWith('video/');

export const SongManagerPanel: React.FC<Props> = ({
  sharedScript,
  availableRoles,
  myRoles,
  onManifestUpdated,
  standalone = false,
}) => {
  const floatingPlaybackBarOverlayStyle =
    Platform.OS === 'web'
      ? ({
          position: 'fixed',
          left: 12,
          right: 12,
          top: 12,
          zIndex: 1000,
        } as const)
      : null;
  const [isVisible, setIsVisible] = useState(false);
  const [viewMode, setViewMode] = useState<SongManagerViewMode>('menu');
  const [isUnlocked, setIsUnlocked] = useState(Boolean(cachedSongAdminPassword));
  const [password, setPassword] = useState(cachedSongAdminPassword ?? '');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [, setManageSection] = useState<ManageSection>('musical-numbers');
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
  const [musicalNumberSceneTitle, setMusicalNumberSceneTitle] = useState<string | null>(null);
  const [musicalNumberStartLineIndex, setMusicalNumberStartLineIndex] = useState<number | null>(null);
  const [musicalNumberEndLineIndex, setMusicalNumberEndLineIndex] = useState<number | null>(null);
  const [expandedMusicalNumberFormLineIndex, setExpandedMusicalNumberFormLineIndex] =
    useState<number | null>(null);
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
  const [isPreviewAudioPaused, setIsPreviewAudioPaused] = useState(false);
  const [previewAudioError, setPreviewAudioError] = useState<string | null>(null);
  const [previewAudioElement] = useState<HTMLAudioElement | null>(
    typeof Audio === 'undefined' ? null : new Audio()
  );
  const replayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replayCycleRef = useRef(0);
  const playbackSessionRef = useRef<PlaybackSession | null>(null);
  const [activePlaylistMode, setActivePlaylistMode] = useState<SongPlaybackMode | null>(null);
  const sharedSongs = useMemo(() => sharedScript?.songs ?? [], [sharedScript]);
  const musicalNumbers = useMemo(() => sharedScript?.musicalNumbers ?? [], [sharedScript]);
  const orderedMusicalNumbers = useMemo(
    () =>
      [...musicalNumbers].sort((leftNumber, rightNumber) => {
        const lineDelta =
          getMusicalNumberSortIndex(leftNumber) - getMusicalNumberSortIndex(rightNumber);
        if (lineDelta !== 0) {
          return lineDelta;
        }

        const endDelta = leftNumber.endLineIndex - rightNumber.endLineIndex;
        if (endDelta !== 0) {
          return endDelta;
        }

        return leftNumber.title.localeCompare(rightNumber.title, 'es', { sensitivity: 'base' });
      }),
    [musicalNumbers]
  );
  const musicalNumberAudioCount = useMemo(
    () => musicalNumbers.reduce((count, musicalNumber) => count + musicalNumber.audios.length, 0),
    [musicalNumbers]
  );

  const buildMusicalNumberCueSongs = useCallback(
    (musicalNumber: SharedMusicalNumberAsset) =>
      sharedSongs
        .filter((song) => musicalNumber.songIds.includes(song.id))
        .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex),
    [sharedSongs]
  );

  const buildPracticeMusicalNumberAudios = useCallback(
    (
      musicalNumber: SharedMusicalNumberAsset,
      cueSongs: SharedSongAsset[]
    ): SharedSongAudioAsset[] => {
      const directAudios = musicalNumber.audios.map((audio) => ({
        ...audio,
        id: `musical-number:${musicalNumber.id}:${audio.id}`,
      }));

      const inheritedAudios = cueSongs.flatMap((song) =>
        song.audios.map((audio) => ({
          ...audio,
          id: `song:${song.id}:${audio.id}`,
          label: buildPracticeMusicalNumberAudioLabel(song.title, audio),
        }))
      );

      return [...directAudios, ...inheritedAudios];
    },
    []
  );

  const buildMusicalNumberRangeEntries = useCallback(
    (musicalNumber: SharedMusicalNumberAsset): MusicalNumberSceneEntry[] => {
      if (!sharedScript || !musicalNumber.sceneTitle) {
        return [];
      }

      const entries: MusicalNumberSceneEntry[] = [];
      let currentScene = '';

      sharedScript.scriptData.guion.forEach((line, lineIndex) => {
        if (isSceneMarker(line)) {
          currentScene = line.t;
          return;
        }

        if (
          currentScene !== musicalNumber.sceneTitle ||
          lineIndex < musicalNumber.startLineIndex ||
          lineIndex > musicalNumber.endLineIndex
        ) {
          return;
        }

        if (isSongCue(line)) {
          const song = sharedSongs.find((candidate) => candidate.lineIndex === lineIndex) ?? null;
          entries.push({
            lineIndex,
            kind: 'song',
            title: song?.title || line.songTitle || 'Cancion',
            meta: song
              ? `${song.audios.length} audio${song.audios.length === 1 ? '' : 's'} cargado${song.audios.length === 1 ? '' : 's'}`
              : 'Bloque de cancion',
            detailText: song?.lyrics || line.t,
            songId: song?.id ?? null,
          });
          return;
        }

        entries.push({
          lineIndex,
          kind: 'dialogue',
          title: buildDialogueEntryLabel(line),
          meta: truncateText(line.t),
          detailText: line.t,
          songId: null,
        });
      });

      return entries;
    },
    [sharedScript, sharedSongs]
  );

  const practiceMusicalNumbers = useMemo<PracticeMusicalNumberAsset[]>(
    () =>
      orderedMusicalNumbers.map((musicalNumber) => {
        const cueSongs = buildMusicalNumberCueSongs(musicalNumber);

        return {
          ...musicalNumber,
          cueSongs,
          rangeEntries: buildMusicalNumberRangeEntries(musicalNumber),
          practiceAudios: buildPracticeMusicalNumberAudios(musicalNumber, cueSongs),
        };
      }),
    [
      buildMusicalNumberCueSongs,
      buildMusicalNumberRangeEntries,
      buildPracticeMusicalNumberAudios,
      orderedMusicalNumbers,
    ]
  );

  const myPracticeMusicalNumbers = useMemo(
    () =>
      practiceMusicalNumbers.filter((musicalNumber) =>
        musicalNumber.practiceAudios.some((audio) =>
          audio.guideRoles.some((role) => myRoles.includes(role))
        )
      ),
    [myRoles, practiceMusicalNumbers]
  );

  const musicalNumbersForCurrentView = useMemo(() => {
    if (viewMode === 'my-songs') {
      return myPracticeMusicalNumbers;
    }

    if (viewMode === 'all-songs') {
      return practiceMusicalNumbers;
    }

    return [];
  }, [myPracticeMusicalNumbers, practiceMusicalNumbers, viewMode]);

  useEffect(() => {
    if (!sharedSongs.length) {
      setSelectedSongId(null);
      return;
    }

    setSelectedSongId((previousSongId) =>
      previousSongId && sharedSongs.some((song) => song.id === previousSongId)
        ? previousSongId
        : sharedSongs[0].id
    );
  }, [sharedSongs]);

  useEffect(() => {
    if (!orderedMusicalNumbers.length) {
      setSelectedMusicalNumberId(null);
      return;
    }

    setSelectedMusicalNumberId((previousMusicalNumberId) =>
      previousMusicalNumberId &&
      orderedMusicalNumbers.some((musicalNumber) => musicalNumber.id === previousMusicalNumberId)
        ? previousMusicalNumberId
        : null
    );
  }, [orderedMusicalNumbers]);

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

    return sharedSongs.find((song) => song.id === selectedSongId) ?? null;
  }, [selectedSongId, sharedSongs]);

  const selectedMusicalNumber = useMemo<SharedMusicalNumberAsset | null>(() => {
    if (!selectedMusicalNumberId) {
      return null;
    }

    return (
      orderedMusicalNumbers.find((musicalNumber) => musicalNumber.id === selectedMusicalNumberId) ??
      null
    );
  }, [orderedMusicalNumbers, selectedMusicalNumberId]);

  const selectedPracticeMusicalNumber = useMemo<PracticeMusicalNumberAsset | null>(() => {
    if (viewMode !== 'my-songs' && viewMode !== 'all-songs') {
      return null;
    }

    if (!musicalNumbersForCurrentView.length) {
      return null;
    }

    return (
      musicalNumbersForCurrentView.find(
        (musicalNumber) => musicalNumber.id === selectedMusicalNumberId
      ) ?? null
    );
  }, [musicalNumbersForCurrentView, selectedMusicalNumberId, viewMode]);

  const activePlaybackEntry = (() => {
    const session = playbackSessionRef.current;
    if (!session) {
      return null;
    }

    if (session.kind === 'playlist') {
      const currentEntry = session.entries[session.index] ?? null;
      return currentEntry
        ? {
            kind: 'playlist' as const,
            audio: currentEntry.audio,
            musicalNumber: currentEntry.musicalNumber,
            index: session.index,
            total: session.entries.length,
          }
        : null;
    }

    return {
      kind: 'single' as const,
      audio: session.audio,
      musicalNumber: selectedPracticeMusicalNumber,
      index: 0,
      total: 1,
    };
  })();

  const shouldShowFloatingPlaybackControls = Boolean(activePlaybackEntry);

  const musicalNumberSceneOptions = useMemo<MusicalNumberSceneOption[]>(() => {
    if (!sharedScript) {
      return [];
    }

    const sceneOrder: string[] = [];
    const sceneSongCounts = new Map<string, number>();
    let currentScene = '';

    sharedScript.scriptData.guion.forEach((line, lineIndex) => {
      if (isSceneMarker(line)) {
        currentScene = line.t;
        if (!sceneSongCounts.has(currentScene)) {
          sceneSongCounts.set(currentScene, 0);
          sceneOrder.push(currentScene);
        }
        return;
      }

      if (currentScene && isSongCue(line)) {
        const hasMappedSong = sharedScript.songs.some((song) => song.lineIndex === lineIndex);
        if (hasMappedSong) {
          sceneSongCounts.set(currentScene, (sceneSongCounts.get(currentScene) ?? 0) + 1);
        }
      }
    });

    return sceneOrder
      .map((title) => ({
        title,
        songCount: sceneSongCounts.get(title) ?? 0,
      }))
      .filter((scene) => scene.songCount > 0);
  }, [sharedScript]);

  const musicalNumberSceneEntries = useMemo<MusicalNumberSceneEntry[]>(() => {
    if (!sharedScript || !musicalNumberSceneTitle) {
      return [];
    }

    const entries: MusicalNumberSceneEntry[] = [];
    let currentScene = '';

    sharedScript.scriptData.guion.forEach((line, lineIndex) => {
      if (isSceneMarker(line)) {
        currentScene = line.t;
        return;
      }

      if (currentScene !== musicalNumberSceneTitle) {
        return;
      }

      if (isSongCue(line)) {
        const song = sharedScript.songs.find((candidate) => candidate.lineIndex === lineIndex) ?? null;
        entries.push({
          lineIndex,
          kind: 'song',
          title: song?.title || line.songTitle || 'Cancion',
          meta: song
            ? `${song.audios.length} audio${song.audios.length === 1 ? '' : 's'} cargado${song.audios.length === 1 ? '' : 's'}`
            : 'Bloque de cancion',
          detailText: song?.lyrics || line.t,
          songId: song?.id ?? null,
        });
        return;
      }

      entries.push({
        lineIndex,
        kind: 'dialogue',
        title: buildDialogueEntryLabel(line),
        meta: truncateText(line.t),
        detailText: line.t,
        songId: null,
      });
    });

    return entries;
  }, [musicalNumberSceneTitle, sharedScript]);

  const normalizedMusicalNumberRange = useMemo(() => {
    if (musicalNumberStartLineIndex === null || musicalNumberEndLineIndex === null) {
      return null;
    }

    return normalizeRange(musicalNumberStartLineIndex, musicalNumberEndLineIndex);
  }, [musicalNumberEndLineIndex, musicalNumberStartLineIndex]);

  const selectedMusicalNumberFormSongs = useMemo(
    () =>
      !sharedScript || !musicalNumberSceneTitle || !normalizedMusicalNumberRange
        ? []
        : getSongsForLineRange(
            sharedScript.songs,
            musicalNumberSceneTitle,
            normalizedMusicalNumberRange.startLineIndex,
            normalizedMusicalNumberRange.endLineIndex
          ),
    [musicalNumberSceneTitle, normalizedMusicalNumberRange, sharedScript]
  );

  const selectedMusicalNumberStartEntry = useMemo(
    () =>
      musicalNumberStartLineIndex === null
        ? null
        : musicalNumberSceneEntries.find((entry) => entry.lineIndex === musicalNumberStartLineIndex) ?? null,
    [musicalNumberSceneEntries, musicalNumberStartLineIndex]
  );

  const selectedMusicalNumberEndEntry = useMemo(
    () =>
      musicalNumberEndLineIndex === null
        ? null
        : musicalNumberSceneEntries.find((entry) => entry.lineIndex === musicalNumberEndLineIndex) ?? null,
    [musicalNumberEndLineIndex, musicalNumberSceneEntries]
  );

  useEffect(() => {
    if (
      editingMusicalNumberId ||
      musicalNumberTitle.trim().length > 0 ||
      selectedMusicalNumberFormSongs.length === 0
    ) {
      return;
    }

    setMusicalNumberTitle(buildDefaultMusicalNumberTitle(selectedMusicalNumberFormSongs));
  }, [editingMusicalNumberId, musicalNumberTitle, selectedMusicalNumberFormSongs]);

  useEffect(() => {
    if (
      musicalNumberStartLineIndex !== null &&
      !musicalNumberSceneEntries.some((entry) => entry.lineIndex === musicalNumberStartLineIndex)
    ) {
      setMusicalNumberStartLineIndex(null);
    }

    if (
      musicalNumberEndLineIndex !== null &&
      !musicalNumberSceneEntries.some((entry) => entry.lineIndex === musicalNumberEndLineIndex)
    ) {
      setMusicalNumberEndLineIndex(null);
    }

    if (
      expandedMusicalNumberFormLineIndex !== null &&
      !musicalNumberSceneEntries.some((entry) => entry.lineIndex === expandedMusicalNumberFormLineIndex)
    ) {
      setExpandedMusicalNumberFormLineIndex(null);
    }
  }, [
    expandedMusicalNumberFormLineIndex,
    musicalNumberEndLineIndex,
    musicalNumberSceneEntries,
    musicalNumberStartLineIndex,
  ]);

  const activePlaylistDescription = useMemo(() => {
    if (!activePlaylistMode) {
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

  const refreshSharedManifest = useCallback(
    async (fallbackManifest: SharedScriptManifest) => {
      if (!sharedScript?.shareId) {
        onManifestUpdated(fallbackManifest);
        return fallbackManifest;
      }

      try {
        const refreshedManifest = await fetchSharedScript(sharedScript.shareId);
        const nextManifest = pickFreshestManifest(fallbackManifest, refreshedManifest);
        onManifestUpdated(nextManifest);
        return nextManifest;
      } catch {
        onManifestUpdated(fallbackManifest);
        return fallbackManifest;
      }
    },
    [onManifestUpdated, sharedScript?.shareId]
  );

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

  const handleSelectMusicalNumberScene = (sceneTitle: string) => {
    setMusicalNumberSceneTitle((previousSceneTitle) => {
      if (previousSceneTitle === sceneTitle) {
        return previousSceneTitle;
      }

      setMusicalNumberStartLineIndex(null);
      setMusicalNumberEndLineIndex(null);
      setExpandedMusicalNumberFormLineIndex(null);
      if (!editingMusicalNumberId) {
        setMusicalNumberTitle('');
      }

      return sceneTitle;
    });
  };

  const handleToggleMusicalNumberFormEntry = (lineIndex: number) => {
    setExpandedMusicalNumberFormLineIndex((previousLineIndex) =>
      previousLineIndex === lineIndex ? null : lineIndex
    );
  };

  const handleSetMusicalNumberBoundary = (
    boundary: 'start' | 'end',
    entry: MusicalNumberSceneEntry
  ) => {
    setExpandedMusicalNumberFormLineIndex(entry.lineIndex);

    if (boundary === 'start') {
      setMusicalNumberStartLineIndex(entry.lineIndex);
      return;
    }

    setMusicalNumberEndLineIndex(entry.lineIndex);
  };

  const pickPlaylistAudio = useCallback(
    (
      musicalNumber: PracticeMusicalNumberAsset,
      mode: SongPlaybackMode
    ): SharedSongAudioAsset | null => {
      const candidates =
        mode === 'all'
          ? musicalNumber.practiceAudios
          : musicalNumber.practiceAudios.filter((audio) => audio.kind === mode);

      if (!candidates.length) {
        return null;
      }

      if (mode === 'all') {
        const karaokeRoleMatchedAudio = candidates.find(
          (audio) =>
            audio.kind === 'karaoke' &&
            audio.guideRoles.some((role) => myRoles.includes(role))
        );
        const anyRoleMatchedAudio = candidates.find((audio) =>
          audio.guideRoles.some((role) => myRoles.includes(role))
        );

        return (
          karaokeRoleMatchedAudio ??
          candidates.find((audio) => audio.kind === 'karaoke') ??
          anyRoleMatchedAudio ??
          candidates[0]
        );
      }

      const karaokeAudios = candidates.filter((audio) => audio.kind === 'karaoke');
      const vocalGuideAudios = candidates.filter((audio) => audio.kind === 'vocal_guide');
      const participantRoles = Array.from(
        new Set(candidates.flatMap((audio) => audio.guideRoles))
      );
      const allParticipantsCovered =
        participantRoles.length > 0 && participantRoles.every((role) => myRoles.includes(role));
      const getRoleStats = (audio: SharedSongAudioAsset) => ({
        overlapCount: audio.guideRoles.filter((role) => myRoles.includes(role)).length,
        outsideCount: audio.guideRoles.filter((role) => !myRoles.includes(role)).length,
        taggedCount: audio.guideRoles.length,
      });
      const sortAudioList = (
        audioList: SharedSongAudioAsset[],
        sortMode: 'matching-vocal' | 'complement-vocal' | 'karaoke'
      ) =>
        [...audioList].sort((leftAudio, rightAudio) => {
          const leftStats = getRoleStats(leftAudio);
          const rightStats = getRoleStats(rightAudio);

          if (sortMode === 'matching-vocal') {
            if (rightStats.overlapCount !== leftStats.overlapCount) {
              return rightStats.overlapCount - leftStats.overlapCount;
            }
          }

          if (sortMode === 'complement-vocal') {
            if (rightStats.outsideCount !== leftStats.outsideCount) {
              return rightStats.outsideCount - leftStats.outsideCount;
            }
          }

          if (sortMode === 'karaoke') {
            if (rightStats.overlapCount !== leftStats.overlapCount) {
              return rightStats.overlapCount - leftStats.overlapCount;
            }
          }

          if (rightStats.taggedCount !== leftStats.taggedCount) {
            return rightStats.taggedCount - leftStats.taggedCount;
          }

          return leftAudio.label.localeCompare(rightAudio.label);
        });

      const matchingVocalGuides = sortAudioList(
        vocalGuideAudios.filter((audio) => getRoleStats(audio).overlapCount > 0),
        'matching-vocal'
      );
      const complementaryVocalGuides = sortAudioList(
        vocalGuideAudios.filter((audio) => {
          const stats = getRoleStats(audio);
          return stats.overlapCount === 0 && stats.outsideCount > 0;
        }),
        'complement-vocal'
      );
      const sortedKaraokes = sortAudioList(karaokeAudios, 'karaoke');

      if (mode === 'karaoke') {
        if (allParticipantsCovered && sortedKaraokes.length > 0) {
          return sortedKaraokes[0];
        }

        if (complementaryVocalGuides.length > 0) {
          return complementaryVocalGuides[0];
        }

        return sortedKaraokes[0] ?? matchingVocalGuides[0] ?? vocalGuideAudios[0] ?? candidates[0];
      }

      if (mode === 'vocal_guide') {
        return matchingVocalGuides[0] ?? sortedKaraokes[0] ?? vocalGuideAudios[0] ?? candidates[0];
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
      setIsPreviewAudioPaused(false);
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
        setIsPreviewAudioPaused(false);
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
          setSelectedMusicalNumberId(nextEntry.musicalNumber.id);
          void startPreviewPlayback(nextEntry.audio, cycleId);
        }, 3000);
      };
      previewAudioElement.onerror = () => {
        setPlayingPreviewAudioId(null);
        setIsPreviewAudioPaused(false);
        setPreviewAudioError('No se pudo reproducir este audio.');
      };

      try {
        previewAudioElement.currentTime = 0;
        setPlayingPreviewAudioId(audio.id);
        setIsPreviewAudioPaused(false);
        await previewAudioElement.play();
      } catch {
        setPlayingPreviewAudioId(null);
        setIsPreviewAudioPaused(false);
        setPreviewAudioError('No se pudo reproducir este audio.');
      }
    },
    [previewAudioElement]
  );

  const handlePauseResumePreviewAudio = useCallback(
    async (audio: SharedSongAudioAsset) => {
      if (!previewAudioElement || playingPreviewAudioId !== audio.id) {
        return;
      }

      if (isPreviewAudioPaused) {
        try {
          setPreviewAudioError(null);
          await previewAudioElement.play();
          setIsPreviewAudioPaused(false);
        } catch {
          setPreviewAudioError('No se pudo reanudar este audio.');
        }
        return;
      }

      previewAudioElement.pause();
      setIsPreviewAudioPaused(true);
    },
    [isPreviewAudioPaused, playingPreviewAudioId, previewAudioElement]
  );

  const handleToggleFloatingPlayback = useCallback(async () => {
    if (!previewAudioElement || !activePlaybackEntry) {
      return;
    }

    if (playingPreviewAudioId === activePlaybackEntry.audio.id && !isPreviewAudioPaused) {
      previewAudioElement.pause();
      setIsPreviewAudioPaused(true);
      return;
    }

    try {
      setPreviewAudioError(null);
      await previewAudioElement.play();
      setPlayingPreviewAudioId(activePlaybackEntry.audio.id);
      setIsPreviewAudioPaused(false);
    } catch {
      setPreviewAudioError('No se pudo reanudar este audio.');
    }
  }, [activePlaybackEntry, isPreviewAudioPaused, playingPreviewAudioId, previewAudioElement]);

  const handleCloseFloatingPlayback = useCallback(() => {
    stopPreviewAudio();
    setPreviewAudioError(null);
  }, [stopPreviewAudio]);

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

      const entries = musicalNumbersForCurrentView
        .map((musicalNumber) => {
          const audio = pickPlaylistAudio(musicalNumber, mode);
          return audio ? { musicalNumber, audio } : null;
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

      const preferredIndex = selectedPracticeMusicalNumber
        ? entries.findIndex((entry) => entry.musicalNumber.id === selectedPracticeMusicalNumber.id)
        : 0;
      const nextIndex = preferredIndex >= 0 ? preferredIndex : 0;
      const nextEntry = entries[nextIndex];

      setPreviewAudioError(null);
      cancelQueuedReplay(false);
      stopPreviewAudio({ cancelLoop: false });
      playbackSessionRef.current = { kind: 'playlist', mode, entries, index: nextIndex };
      setActivePlaylistMode(mode);
      setSelectedMusicalNumberId(nextEntry.musicalNumber.id);

      const cycleId = replayCycleRef.current;
      await startPreviewPlayback(nextEntry.audio, cycleId);
    },
    [
      activePlaylistMode,
      cancelQueuedReplay,
      pickPlaylistAudio,
      previewAudioElement,
      selectedPracticeMusicalNumber,
      musicalNumbersForCurrentView,
      startPreviewPlayback,
      stopPreviewAudio,
    ]
  );

  const handleNavigateFloatingPlaylist = useCallback(
    async (direction: 'previous' | 'next') => {
      const session = playbackSessionRef.current;
      if (!previewAudioElement || !session || session.kind !== 'playlist' || session.entries.length < 2) {
        return;
      }

      const delta = direction === 'previous' ? -1 : 1;
      const nextIndex = (session.index + delta + session.entries.length) % session.entries.length;
      const nextEntry = session.entries[nextIndex];

      setPreviewAudioError(null);
      cancelQueuedReplay(false);
      stopPreviewAudio({ cancelLoop: false });
      playbackSessionRef.current = { ...session, index: nextIndex };
      setActivePlaylistMode(session.mode);
      setSelectedMusicalNumberId(nextEntry.musicalNumber.id);

      const cycleId = replayCycleRef.current;
      await startPreviewPlayback(nextEntry.audio, cycleId);
    },
    [cancelQueuedReplay, previewAudioElement, startPreviewPlayback, stopPreviewAudio]
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
    setSelectedSongId(songId);
    setIsSongPickerVisible(false);
    setPreviewAudioError(null);
  };

  const resetAudioForm = useCallback(() => {
    setAudioLabel('');
    setAudioKind(DEFAULT_UPLOAD_KIND);
    setGuideRoles([]);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
  }, []);

  const resetMusicalNumberForm = useCallback(() => {
    setMusicalNumberTitle('');
    setMusicalNumberSceneTitle(null);
    setMusicalNumberStartLineIndex(null);
    setMusicalNumberEndLineIndex(null);
    setExpandedMusicalNumberFormLineIndex(null);
    setIsMusicalNumberFormVisible(false);
    setEditingMusicalNumberId(null);
  }, []);

  const resetMusicalNumberAudioForm = useCallback(() => {
    setMusicalNumberAudioLabel('');
    setMusicalNumberAudioKind(DEFAULT_UPLOAD_KIND);
    setMusicalNumberGuideRoles([]);
    setMusicalNumberUploadProgress(null);
    setEditingMusicalNumberAudioId(null);
    setIsMusicalNumberAudioFormVisible(false);
  }, []);

  const returnToMusicalNumberCatalog = useCallback(() => {
    resetAudioForm();
    resetMusicalNumberForm();
    resetMusicalNumberAudioForm();
    setManageSection('musical-numbers');
    setSelectedMusicalNumberId(null);
    setManagerError(null);
    setPreviewAudioError(null);
  }, [resetAudioForm, resetMusicalNumberAudioForm, resetMusicalNumberForm]);

  const confirmMusicalNumberDeletion = useCallback(
    async (musicalNumber: SharedMusicalNumberAsset) => {
      const message = `Se borrara "${musicalNumber.title}". Esta accion no se puede deshacer.`;

      if (Platform.OS === 'web') {
        return typeof window !== 'undefined' ? window.confirm(message) : false;
      }

      return new Promise<boolean>((resolve) => {
        let isResolved = false;
        const finish = (value: boolean) => {
          if (isResolved) {
            return;
          }

          isResolved = true;
          resolve(value);
        };

        Alert.alert(
          'Borrar numero musical',
          message,
          [
            {
              text: 'Cancelar',
              style: 'cancel',
              onPress: () => finish(false),
            },
            {
              text: 'Borrar',
              style: 'destructive',
              onPress: () => finish(true),
            },
          ],
          {
            cancelable: true,
            onDismiss: () => finish(false),
          }
        );
      });
    },
    []
  );

  const startEditingAudio = (audio: SharedSongAudioAsset) => {
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
      type: ['audio/*', 'audio/mp4', 'video/*'],
      copyToCacheDirectory: false,
    });

    if (result.canceled) {
      return null;
    }

    const file = await resolveAssetUploadFile(result.assets[0]);
    setUploadProgress(0);
    const uploadedSource = await uploadSharedSongAudio({
      shareId: sharedScript.shareId,
      targetId: selectedSong.id,
      targetType: 'song',
      file,
      password: password.trim(),
      onUploadProgress: (percentage) => setUploadProgress(Math.round(percentage)),
    });

    if (!isVideoAsset(file)) {
      return uploadedSource;
    }

    setUploadProgress(null);
    setManagerError('Convirtiendo el video a audio en servidor...');

    return extractSharedSongAudioFromVideo({
      shareId: sharedScript.shareId,
      targetId: selectedSong.id,
      targetType: 'song',
      password: password.trim(),
      sourceUrl: uploadedSource.url,
      sourcePathname: uploadedSource.pathname,
      sourceFileName: uploadedSource.fileName,
      sourceContentType: uploadedSource.contentType,
    });
  };

  const handleUploadAudio = async () => {
    if (!sharedScript || !selectedSong) {
      return;
    }

    const nextLabel = audioLabel.trim();
    const validationError = validateAudioMetadata({ label: nextLabel, guideRoles });
    if (validationError) {
      setManagerError(validationError);
      return;
    }

    setManagerError(null);
    setIsUploading(true);

    try {
      const uploadedAudio = await pickAndUploadAudioFile();
      if (!uploadedAudio) {
        return;
      }

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

      await refreshSharedManifest(manifest);
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

    const nextLabel = audioLabel.trim();
    const validationError = validateAudioMetadata({ label: nextLabel, guideRoles });
    if (validationError) {
      setManagerError(validationError);
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
        label: nextLabel,
        kind: audioKind,
        guideRoles,
      });

      await refreshSharedManifest(manifest);
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

    const nextLabel = audioLabel.trim();
    const validationError = validateAudioMetadata({ label: nextLabel, guideRoles });
    if (validationError) {
      setManagerError(validationError);
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
        label: nextLabel,
        kind: audioKind,
        guideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      await refreshSharedManifest(manifest);
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

      await refreshSharedManifest(manifest);
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
    setSelectedMusicalNumberId((previousMusicalNumberId) =>
      previousMusicalNumberId === musicalNumberId ? null : musicalNumberId
    );
    setPreviewAudioError(null);
  };

  const startCreatingMusicalNumber = () => {
    resetMusicalNumberAudioForm();
    setEditingMusicalNumberId(null);
    setMusicalNumberTitle('');
    setMusicalNumberSceneTitle(null);
    setMusicalNumberStartLineIndex(null);
    setMusicalNumberEndLineIndex(null);
    setExpandedMusicalNumberFormLineIndex(null);
    setIsMusicalNumberFormVisible(true);
  };

  const startEditingMusicalNumber = (musicalNumber: SharedMusicalNumberAsset) => {
    resetMusicalNumberAudioForm();
    setEditingMusicalNumberId(musicalNumber.id);
    setMusicalNumberTitle(musicalNumber.title);
    setMusicalNumberSceneTitle(musicalNumber.sceneTitle);
    setMusicalNumberStartLineIndex(musicalNumber.startLineIndex);
    setMusicalNumberEndLineIndex(musicalNumber.endLineIndex);
    setExpandedMusicalNumberFormLineIndex(musicalNumber.startLineIndex);
    setSelectedMusicalNumberId(musicalNumber.id);
    setIsMusicalNumberFormVisible(true);
  };

  const handleSaveMusicalNumber = async () => {
    if (!sharedScript) {
      return;
    }

    const title = musicalNumberTitle.trim();
    if (!title) {
      setManagerError('Pon un nombre al numero musical antes de guardarlo.');
      return;
    }

    setIsSavingMusicalNumber(true);
    setManagerError(null);

    try {
      const sceneTitle = musicalNumberSceneTitle?.trim() ?? '';
      const normalizedRange =
        musicalNumberStartLineIndex !== null && musicalNumberEndLineIndex !== null
          ? normalizeRange(musicalNumberStartLineIndex, musicalNumberEndLineIndex)
          : null;

      const manifest = editingMusicalNumberId
        ? await updateSharedMusicalNumber({
            shareId: sharedScript.shareId,
            musicalNumberId: editingMusicalNumberId,
            password: password.trim(),
            title,
            sceneTitle,
            startLineIndex: normalizedRange?.startLineIndex ?? -1,
            endLineIndex: normalizedRange?.endLineIndex ?? -1,
          })
        : await createSharedMusicalNumber({
            shareId: sharedScript.shareId,
            password: password.trim(),
            title,
            sceneTitle,
            startLineIndex: normalizedRange?.startLineIndex ?? -1,
            endLineIndex: normalizedRange?.endLineIndex ?? -1,
          });

      const refreshedManifest = await refreshSharedManifest(manifest);
      const nextMusicalNumber =
        refreshedManifest.musicalNumbers.find((candidate) =>
          editingMusicalNumberId ? candidate.id === editingMusicalNumberId : candidate.title === title
        ) ?? refreshedManifest.musicalNumbers[0] ?? null;

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

  const handleDeleteMusicalNumber = async (musicalNumber: SharedMusicalNumberAsset) => {
    if (!sharedScript) {
      return;
    }

    const shouldDelete = await confirmMusicalNumberDeletion(musicalNumber);
    if (!shouldDelete) {
      return;
    }

    setDeletingMusicalNumberId(musicalNumber.id);
    setManagerError(null);

    try {
      const manifest = await deleteSharedMusicalNumber({
        shareId: sharedScript.shareId,
        musicalNumberId: musicalNumber.id,
        password: password.trim(),
      });

      await refreshSharedManifest(manifest);
      returnToMusicalNumberCatalog();
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
      type: ['audio/*', 'audio/mp4', 'video/*'],
      copyToCacheDirectory: false,
    });

    if (result.canceled) {
      return null;
    }

    const file = await resolveAssetUploadFile(result.assets[0]);
    setMusicalNumberUploadProgress(0);
    const uploadedSource = await uploadSharedSongAudio({
      shareId: sharedScript.shareId,
      targetId: selectedMusicalNumber.id,
      targetType: 'musical-number',
      file,
      password: password.trim(),
      onUploadProgress: (percentage) => setMusicalNumberUploadProgress(Math.round(percentage)),
    });

    if (!isVideoAsset(file)) {
      return uploadedSource;
    }

    setMusicalNumberUploadProgress(null);
    setManagerError('Convirtiendo el video a audio en servidor...');

    return extractSharedSongAudioFromVideo({
      shareId: sharedScript.shareId,
      targetId: selectedMusicalNumber.id,
      targetType: 'musical-number',
      password: password.trim(),
      sourceUrl: uploadedSource.url,
      sourcePathname: uploadedSource.pathname,
      sourceFileName: uploadedSource.fileName,
      sourceContentType: uploadedSource.contentType,
    });
  };

  const startEditingMusicalNumberAudio = (audio: SharedSongAudioAsset) => {
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

    const nextLabel = musicalNumberAudioLabel.trim();
    const validationError = validateAudioMetadata({
      label: nextLabel,
      guideRoles: musicalNumberGuideRoles,
    });
    if (validationError) {
      setManagerError(validationError);
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
        sceneTitle: selectedMusicalNumber.sceneTitle,
        startLineIndex: selectedMusicalNumber.startLineIndex,
        endLineIndex: selectedMusicalNumber.endLineIndex,
        songIds: selectedMusicalNumber.songIds,
        password: password.trim(),
        label: nextLabel,
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      await refreshSharedManifest(manifest);
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

    const nextLabel = musicalNumberAudioLabel.trim();
    const validationError = validateAudioMetadata({
      label: nextLabel,
      guideRoles: musicalNumberGuideRoles,
    });
    if (validationError) {
      setManagerError(validationError);
      return;
    }

    setIsSavingMusicalNumberAudio(true);
    setManagerError(null);

    try {
      const manifest = await updateSharedMusicalNumberAudio({
        shareId: sharedScript.shareId,
        musicalNumberId: selectedMusicalNumber.id,
        musicalNumberTitle: selectedMusicalNumber.title,
        sceneTitle: selectedMusicalNumber.sceneTitle,
        startLineIndex: selectedMusicalNumber.startLineIndex,
        endLineIndex: selectedMusicalNumber.endLineIndex,
        songIds: selectedMusicalNumber.songIds,
        audioId: editingMusicalNumberAudio.id,
        password: password.trim(),
        label: nextLabel,
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
      });

      await refreshSharedManifest(manifest);
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

    const nextLabel = musicalNumberAudioLabel.trim();
    const validationError = validateAudioMetadata({
      label: nextLabel,
      guideRoles: musicalNumberGuideRoles,
    });
    if (validationError) {
      setManagerError(validationError);
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
        sceneTitle: selectedMusicalNumber.sceneTitle,
        startLineIndex: selectedMusicalNumber.startLineIndex,
        endLineIndex: selectedMusicalNumber.endLineIndex,
        songIds: selectedMusicalNumber.songIds,
        audioId: editingMusicalNumberAudio.id,
        password: password.trim(),
        label: nextLabel,
        kind: musicalNumberAudioKind,
        guideRoles: musicalNumberGuideRoles,
        audioUrl: uploadedAudio.url,
        audioFileName: uploadedAudio.fileName,
        contentType: uploadedAudio.contentType,
        size: uploadedAudio.size,
      });

      await refreshSharedManifest(manifest);
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
        sceneTitle: selectedMusicalNumber.sceneTitle,
        startLineIndex: selectedMusicalNumber.startLineIndex,
        endLineIndex: selectedMusicalNumber.endLineIndex,
        songIds: selectedMusicalNumber.songIds,
        audioId,
        password: password.trim(),
      });

      await refreshSharedManifest(manifest);
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
    setManageSection('musical-numbers');
    setSelectedMusicalNumberId(null);
    setIsMusicalNumberFormVisible(false);
    setEditingMusicalNumberId(null);
    setMusicalNumberTitle('');
    setMusicalNumberSceneTitle(null);
    setMusicalNumberStartLineIndex(null);
    setMusicalNumberEndLineIndex(null);
    setExpandedMusicalNumberFormLineIndex(null);
    setIsMusicalNumberAudioFormVisible(false);
    setEditingMusicalNumberAudioId(null);
    setMusicalNumberAudioLabel('');
    setMusicalNumberAudioKind(DEFAULT_UPLOAD_KIND);
    setMusicalNumberGuideRoles([]);
    setMusicalNumberUploadProgress(null);
    setManagerError(null);
    setPasswordError(null);
    setPreviewAudioError(null);
  }, []);

  const openViewMode = useCallback(
    (nextViewMode: SongManagerViewMode) => {
      resetManagerPanels();
      setViewMode(nextViewMode);
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
              const isPaused = isPlaying && isPreviewAudioPaused;

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
                    {isPlaying ? (
                      <TouchableOpacity
                        style={[styles.audioActionButton, styles.audioPauseButton]}
                        onPress={() => void handlePauseResumePreviewAudio(audio)}
                      >
                        <View style={styles.audioButtonContent}>
                          <MaterialCommunityIcons
                            name={isPaused ? 'play-circle-outline' : 'pause-circle-outline'}
                            size={18}
                            color="#6f4c19"
                          />
                          <Text style={styles.audioPauseText}>{isPaused ? 'Reanudar' : 'Pausar'}</Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
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

  void renderSongPracticeDetail;
  void renderSongList;

  const renderPracticeMusicalNumberDetail = (
    musicalNumber: PracticeMusicalNumberAsset | null = selectedPracticeMusicalNumber
  ) => {
    if (!musicalNumber) {
      return null;
    }

    return (
      <View style={styles.songDetailBox}>
        <Text style={styles.songDetailTitle}>{musicalNumber.title}</Text>
        <Text style={styles.songDetailMeta}>
          {musicalNumber.sceneTitle || 'Sin escena'} · {musicalNumber.cueSongs.length} bloque
          {musicalNumber.cueSongs.length === 1 ? '' : 's'} · {musicalNumber.audios.length} audio
          {musicalNumber.audios.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.songDetailMeta}>
          {describeMusicalNumberBoundary(musicalNumber, 'start')} {'->'}{' '}
          {describeMusicalNumberBoundary(musicalNumber, 'end')}
        </Text>

        {musicalNumber.practiceAudios.length > 0 ? (
          <View style={styles.audioList}>
            <Text style={styles.sectionTitle}>Audios disponibles</Text>
            {musicalNumber.practiceAudios.map((audio) => {
              const isPlaying = playingPreviewAudioId === audio.id;
              const isPaused = isPlaying && isPreviewAudioPaused;

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
                        <Text style={styles.audioPlayText}>
                          {isPlaying ? 'Detener' : 'Reproducir'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {isPlaying ? (
                      <TouchableOpacity
                        style={[styles.audioActionButton, styles.audioPauseButton]}
                        onPress={() => void handlePauseResumePreviewAudio(audio)}
                      >
                        <View style={styles.audioButtonContent}>
                          <MaterialCommunityIcons
                            name={isPaused ? 'play-circle-outline' : 'pause-circle-outline'}
                            size={18}
                            color="#6f4c19"
                          />
                          <Text style={styles.audioPauseText}>
                            {isPaused ? 'Reanudar' : 'Pausar'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.infoText}>Todavia no hay audios para este numero musical.</Text>
        )}

        {previewAudioError ? <Text style={styles.errorText}>{previewAudioError}</Text> : null}

        <View style={styles.rangeEntryList}>
          <Text style={styles.sectionTitle}>Incluye</Text>
          {musicalNumber.rangeEntries.map((entry) => (
            <View key={`${musicalNumber.id}-practice-entry-${entry.lineIndex}`} style={styles.rangeEntryRow}>
              <View
                style={[
                  styles.rangeEntryBadge,
                  entry.kind === 'song' ? styles.rangeEntryBadgeSong : styles.rangeEntryBadgeDialogue,
                ]}
              >
                <Text style={styles.rangeEntryBadgeText}>
                  {entry.kind === 'song' ? 'Cancion' : 'Linea'}
                </Text>
              </View>
              <View style={styles.rangeEntryText}>
                <Text style={styles.rangeEntryTitle}>{entry.title}</Text>
                <Text style={styles.rangeEntryMeta}>
                  {buildMusicalNumberEntryMeta(entry)} · {entry.meta}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderPracticeMusicalNumberList = (
    numbers: PracticeMusicalNumberAsset[],
    showDetailInline = false
  ) => (
    <View style={styles.songList}>
      {numbers.map((musicalNumber) => {
        const isSelected = selectedPracticeMusicalNumber?.id === musicalNumber.id;

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
                  {musicalNumber.sceneTitle || 'Sin escena'} · {musicalNumber.cueSongs.length} bloque
                  {musicalNumber.cueSongs.length === 1 ? '' : 's'} · {musicalNumber.audios.length} audio
                  {musicalNumber.audios.length === 1 ? '' : 's'}
                </Text>
                <Text style={styles.songRowMeta}>
                  {describeMusicalNumberBoundary(musicalNumber, 'start')} {'->'}{' '}
                  {describeMusicalNumberBoundary(musicalNumber, 'end')}
                </Text>
              </View>
            </TouchableOpacity>
            {showDetailInline && isSelected ? renderPracticeMusicalNumberDetail(musicalNumber) : null}
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
    const groupedCueSongs = groupCueSongsByTitle(cueSongs);

    return (
      <View style={styles.songDetailBox}>
        <Text style={styles.songDetailTitle}>{musicalNumber.title}</Text>
        <Text style={styles.songDetailMeta}>
          {cueSongs.length} bloque{cueSongs.length === 1 ? '' : 's'} enlazado
          {cueSongs.length === 1 ? '' : 's'}
          {musicalNumber.sceneTitle ? ` · ${musicalNumber.sceneTitle}` : ''}
        </Text>

        <View style={styles.numberCueList}>
          {groupedCueSongs.map((songGroup) => (
            <View key={songGroup.key} style={styles.numberCueChip}>
              <Text style={styles.numberCueChipText}>
                {songGroup.title}
                {songGroup.count > 1 ? ` (${songGroup.count} bloques)` : ''}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.musicalNumberSummaryBox}>
          <Text style={styles.songDetailMeta}>Escena: {musicalNumber.sceneTitle || 'Sin escena'}</Text>
          <Text style={styles.songDetailMeta}>
            Inicio: {describeMusicalNumberBoundary(musicalNumber, 'start')}
          </Text>
          <Text style={styles.songDetailMeta}>
            Fin: {describeMusicalNumberBoundary(musicalNumber, 'end')}
          </Text>
          <Text style={styles.songDetailMeta}>
            Bloques de cancion: {cueSongs.length} - Audios: {musicalNumber.audios.length}
          </Text>
        </View>

        <View style={styles.manageNumberActions}>
          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() => startEditingMusicalNumber(musicalNumber)}
          >
            <Text style={styles.secondaryActionText}>Editar numero musical</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryAction, styles.deleteAction]}
            onPress={() => void handleDeleteMusicalNumber(musicalNumber)}
            disabled={deletingMusicalNumberId === musicalNumber.id}
          >
            <Text style={styles.deleteActionText}>
              {deletingMusicalNumberId === musicalNumber.id ? 'Borrando...' : 'Borrar numero musical'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() => setIsMusicalNumberAudioFormVisible((previousValue) => !previousValue)}
          >
            <Text style={styles.secondaryActionText}>
              {isMusicalNumberAudioFormVisible
                ? 'Ocultar menu de audio'
                : editingMusicalNumberAudio
                  ? 'Seguir editando audio'
                  : 'Anadir audio a este numero musical'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rangeEntryList}>
          <Text style={styles.sectionTitle}>Incluye</Text>
          {sharedScript?.scriptData.guion.map((line, lineIndex) => {
            if (
              isSceneMarker(line) ||
              !musicalNumber.sceneTitle ||
              lineIndex < musicalNumber.startLineIndex ||
              lineIndex > musicalNumber.endLineIndex
            ) {
              return null;
            }

            let currentScene = '';
            for (let index = 0; index <= lineIndex; index += 1) {
              const candidate = sharedScript.scriptData.guion[index];
              if (isSceneMarker(candidate)) {
                currentScene = candidate.t;
              }
            }

            if (currentScene !== musicalNumber.sceneTitle) {
              return null;
            }

            const isSongEntry = isSongCue(line);
            const song = isSongEntry
              ? sharedScript.songs.find((candidate) => candidate.lineIndex === lineIndex) ?? null
              : null;
            const title = isSongEntry
              ? song?.title || line.songTitle || 'Cancion'
              : buildDialogueEntryLabel(line);
            const meta = isSongEntry
              ? 'Bloque de cancion'
              : truncateText(line.t);

            return (
              <View key={`musical-number-detail-entry-${musicalNumber.id}-${lineIndex}`} style={styles.rangeEntryRow}>
                <View
                  style={[
                    styles.rangeEntryBadge,
                    isSongEntry ? styles.rangeEntryBadgeSong : styles.rangeEntryBadgeDialogue,
                  ]}
                >
                  <Text style={styles.rangeEntryBadgeText}>
                    {isSongEntry ? 'Cancion' : 'Linea'}
                  </Text>
                </View>
                <View style={styles.rangeEntryText}>
                  <Text style={styles.rangeEntryTitle}>{title}</Text>
                  <Text style={styles.rangeEntryMeta}>{meta}</Text>
                </View>
              </View>
            );
          })}
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
        {isMusicalNumberAudioFormVisible ? (
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>
              {editingMusicalNumberAudio ? 'Editar audio' : 'Nuevo audio'}
            </Text>
            <Text style={styles.formLabel}>Tipo de audio</Text>
            <View style={styles.kindActions}>
              {(['karaoke', 'vocal_guide'] as SharedSongAudioKind[]).map((kind) => (
                <TouchableOpacity
                  key={`number-audio-kind-inline-${kind}`}
                  style={[
                    styles.kindButton,
                    musicalNumberAudioKind === kind && styles.kindButtonSelected,
                  ]}
                  onPress={() => setMusicalNumberAudioKind(kind)}
                >
                  <Text
                    style={[
                      styles.kindButtonText,
                      musicalNumberAudioKind === kind && styles.kindButtonTextSelected,
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
                    key={`${musicalNumber.id}-inline-${role}`}
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
                    {isSavingMusicalNumberAudio ? 'Actualizando audio...' : 'Reemplazar audio'}
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
                  {isMusicalNumberUploading ? 'Subiendo audio...' : 'Seleccionar audio o video'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const describeMusicalNumberBoundary = (
    musicalNumber: SharedMusicalNumberAsset,
    boundary: 'start' | 'end'
  ) => {
    if (!sharedScript) {
      return null;
    }

    const lineIndex =
      boundary === 'start' ? musicalNumber.startLineIndex : musicalNumber.endLineIndex;
    const line = sharedScript.scriptData.guion[lineIndex];
    if (!line) {
      return `Linea ${lineIndex + 1}`;
    }

    if (isSongCue(line)) {
      const song = sharedScript.songs.find((candidate) => candidate.lineIndex === lineIndex) ?? null;
      return song?.title || line.songTitle || 'Cancion';
    }

    return `${buildDialogueEntryLabel(line)}: ${truncateText(line.t, 52)}`;
  };

  const renderMusicalNumberList = () => (
    <View style={styles.songList}>
      {orderedMusicalNumbers.map((musicalNumber) => {
          const isSelected = selectedMusicalNumber?.id === musicalNumber.id;
          const cueSongs = sharedScript
            ? musicalNumber.songIds
              .map((songId) => sharedScript.songs.find((song) => song.id === songId) ?? null)
              .filter((song): song is SharedSongAsset => Boolean(song))
          : [];
        const groupedCueSongs = groupCueSongsByTitle(cueSongs);

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
                  {musicalNumber.sceneTitle || 'Sin escena'} · {cueSongs.length} bloque
                  {cueSongs.length === 1 ? '' : 's'} · {groupedCueSongs.length} cancion
                  {groupedCueSongs.length === 1 ? '' : 'es'} ·{' '}
                  {musicalNumber.audios.length} audio{musicalNumber.audios.length === 1 ? '' : 's'}
                </Text>
                <Text style={styles.songRowMeta}>
                  {describeMusicalNumberBoundary(musicalNumber, 'start')} {'->'}{' '}
                  {describeMusicalNumberBoundary(musicalNumber, 'end')}
                </Text>
              </View>
            </TouchableOpacity>
            {isSelected ? renderMusicalNumberDetail(musicalNumber) : null}
          </View>
        );
      })}
    </View>
  );

  const renderMusicalNumberSceneRangeSelectionList = () => (
    <View style={styles.songList}>
      {musicalNumberSceneEntries.map((entry) => {
        const isExpanded = expandedMusicalNumberFormLineIndex === entry.lineIndex;
        const isStart = musicalNumberStartLineIndex === entry.lineIndex;
        const isEnd = musicalNumberEndLineIndex === entry.lineIndex;
        const isIncludedInRange = Boolean(
          normalizedMusicalNumberRange &&
            entry.lineIndex >= normalizedMusicalNumberRange.startLineIndex &&
            entry.lineIndex <= normalizedMusicalNumberRange.endLineIndex
        );

        return (
          <View key={`musical-number-form-entry-${entry.lineIndex}`} style={styles.songListItem}>
            <TouchableOpacity
              style={[
                styles.songRow,
                isIncludedInRange && styles.songRowSelected,
                isStart && styles.songBoundaryStartRow,
                isEnd && styles.songBoundaryEndRow,
              ]}
              onPress={() => handleToggleMusicalNumberFormEntry(entry.lineIndex)}
            >
              <View style={styles.songRowMain}>
                <View style={styles.songRowText}>
                  <Text
                    style={[
                      styles.songRowTitle,
                      isIncludedInRange && styles.songRowTitleSelected,
                    ]}
                  >
                    {entry.title}
                  </Text>
                  <Text style={styles.songRowMeta}>
                    {buildMusicalNumberEntryMeta(entry)} · {entry.meta}
                  </Text>
                </View>
                <View style={styles.boundaryBadgeGroup}>
                  {isStart ? (
                    <View style={[styles.boundaryBadge, styles.boundaryBadgeStart]}>
                      <Text style={styles.boundaryBadgeText}>Inicio</Text>
                    </View>
                  ) : null}
                  {isEnd ? (
                    <View style={[styles.boundaryBadge, styles.boundaryBadgeEnd]}>
                      <Text style={styles.boundaryBadgeText}>Fin</Text>
                    </View>
                  ) : null}
                  {!isStart && !isEnd ? (
                    <View style={[styles.selectionCheck, isIncludedInRange && styles.selectionCheckSelected]}>
                      <MaterialCommunityIcons
                        name={isIncludedInRange ? 'check-bold' : 'chevron-down'}
                        size={18}
                        color={isIncludedInRange ? '#fff' : '#7a4d13'}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
            {isExpanded ? (
              <View style={styles.songDetailBox}>
                <Text style={styles.songDetailTitle}>{entry.title}</Text>
                <Text style={styles.songDetailMeta}>
                  {buildMusicalNumberEntryMeta(entry)} · linea {entry.lineIndex + 1}
                </Text>
                <Text style={styles.songLyrics}>{entry.detailText}</Text>
                <View style={styles.boundaryActionRow}>
                  <TouchableOpacity
                    style={[
                      styles.boundaryActionButton,
                      isStart && styles.boundaryActionButtonActive,
                    ]}
                    onPress={() => handleSetMusicalNumberBoundary('start', entry)}
                  >
                    <Text
                      style={[
                        styles.boundaryActionText,
                        isStart && styles.boundaryActionTextActive,
                      ]}
                    >
                      Marcar inicio
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.boundaryActionButton,
                      isEnd && styles.boundaryActionButtonActive,
                    ]}
                    onPress={() => handleSetMusicalNumberBoundary('end', entry)}
                  >
                    <Text
                      style={[
                        styles.boundaryActionText,
                        isEnd && styles.boundaryActionTextActive,
                      ]}
                    >
                      Marcar fin
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
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
                {sharedScript.songs.length} bloques detectados · {musicalNumbers.length} numero
                {musicalNumbers.length === 1 ? '' : 's'} musical
                {musicalNumbers.length === 1 ? '' : 'es'} · {musicalNumberAudioCount} audio
                {musicalNumberAudioCount === 1 ? '' : 's'} cargado
                {musicalNumberAudioCount === 1 ? '' : 's'}
              </Text>

              {viewMode === 'menu' ? (
                <View style={styles.modeMenu}>
                  <TouchableOpacity
                    style={[styles.modeCard, styles.modeCardBlue]}
                    onPress={() => openViewMode('my-songs')}
                  >
                    <Text style={styles.modeCardTitle}>Mis canciones</Text>
                    <Text style={styles.modeCardText}>
                      {myPracticeMusicalNumbers.length === 0
                        ? 'Todavia no hay numeros musicales etiquetados para tus personajes.'
                        : `${myPracticeMusicalNumbers.length} numeros musicales donde canta tu reparto.`}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modeCard, styles.modeCardPurple]}
                    onPress={() => openViewMode('all-songs')}
                  >
                    <Text style={styles.modeCardTitle}>Todas las canciones</Text>
                    <Text style={styles.modeCardText}>
                      {practiceMusicalNumbers.length} numeros musicales disponibles para practicar.
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
                        ? `${musicalNumbers.length} numero${musicalNumbers.length === 1 ? '' : 's'} musical${musicalNumbers.length === 1 ? '' : 'es'} para revisar o ampliar.`
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
                      ? 'Numeros musicales etiquetados para tus personajes.'
                      : 'Listado completo de numeros musicales de la obra.'}
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

                  {musicalNumbersForCurrentView.length > 0 ? (
                    <>
                      {renderPracticeMusicalNumberList(musicalNumbersForCurrentView, true)}
                    </>
                  ) : (
                    <Text style={styles.infoText}>
                      {viewMode === 'my-songs'
                        ? 'Todavia no hay numeros musicales etiquetados para los personajes seleccionados.'
                        : 'Esta obra todavia no tiene numeros musicales creados.'}
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
                  <Text style={styles.selectionSummary}>
                    Gestiona numeros musicales. Los bloques de cancion se detectan automaticamente dentro del tramo que elijas.
                  </Text>
                  {false ? (
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
                      Cancion seleccionada: {selectedSong?.title}
                    </Text>
                  ) : (
                    <Text style={styles.selectionSummary}>
                      Elige una cancion para ver su detalle y cargar audios.
                    </Text>
                  )}

                  {isSongPickerVisible ? (
                    <View style={styles.songList}>
                    {(sharedScript?.songs ?? []).map((song) => {
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
                      <Text style={styles.songDetailTitle}>{selectedSong?.title}</Text>
                      <Text style={styles.songDetailMeta}>
                        {selectedSong?.sceneTitle || 'Sin escena asociada'}
                      </Text>

                      {(selectedSong?.audios.length ?? 0) > 0 ? (
                        <View style={styles.audioList}>
                          <Text style={styles.sectionTitle}>Audios cargados</Text>
                          {(selectedSong?.audios ?? []).map((audio) => (
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

                      <Text style={styles.songLyrics}>{selectedSong?.lyrics}</Text>

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
                                key={`${selectedSong?.id ?? 'song'}-${role}`}
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
                              {isUploading ? 'Subiendo audio...' : 'Seleccionar audio o video'}
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

                      {false ? (
                        <Text style={styles.selectionSummary}>
                          Numero musical seleccionado: {selectedMusicalNumber?.title}
                        </Text>
                      ) : (
                        <Text style={styles.selectionSummary}>
                          Elige o crea un numero musical marcando un inicio y un fin dentro de una escena.
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
                          <Text style={styles.formLabel}>Escena</Text>
                          {musicalNumberSceneTitle ? (
                            <View style={styles.selectedSceneBox}>
                              <Text style={styles.selectedSceneTitle}>{musicalNumberSceneTitle}</Text>
                              <Text style={styles.selectedSceneMeta}>
                                {musicalNumberSceneEntries.length} elemento
                                {musicalNumberSceneEntries.length === 1 ? '' : 's'} en la escena
                              </Text>
                              <TouchableOpacity
                                style={styles.secondaryAction}
                                onPress={() => handleSelectMusicalNumberScene('')}
                              >
                                <Text style={styles.secondaryActionText}>Cambiar escena</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <View style={styles.sceneSelector}>
                              {musicalNumberSceneOptions.map((scene) => {
                                const isSelectedScene = musicalNumberSceneTitle === scene.title;

                                return (
                                  <TouchableOpacity
                                    key={`musical-number-scene-${scene.title}`}
                                    style={[
                                      styles.sceneChip,
                                      isSelectedScene && styles.sceneChipSelected,
                                    ]}
                                    onPress={() => handleSelectMusicalNumberScene(scene.title)}
                                  >
                                    <Text
                                      style={[
                                        styles.sceneChipText,
                                        isSelectedScene && styles.sceneChipTextSelected,
                                      ]}
                                    >
                                      {scene.title}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.sceneChipMeta,
                                        isSelectedScene && styles.sceneChipMetaSelected,
                                      ]}
                                    >
                                      {scene.songCount} bloque{scene.songCount === 1 ? '' : 's'}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          )}
                          {musicalNumberSceneTitle ? (
                            <>
                              <Text style={styles.formLabel}>Tramo del numero musical</Text>
                              {renderMusicalNumberSceneRangeSelectionList()}
                            </>
                          ) : null}
                          {selectedMusicalNumberStartEntry && selectedMusicalNumberEndEntry ? (
                            <Text style={styles.selectionSummary}>
                              Tramo: {selectedMusicalNumberStartEntry.title} {'->'} {selectedMusicalNumberEndEntry.title}
                              {' · '}
                              {selectedMusicalNumberFormSongs.length} bloque
                              {selectedMusicalNumberFormSongs.length === 1 ? '' : 's'} de cancion
                            </Text>
                          ) : null}
                          {editingMusicalNumberId === '__legacy__' ? (
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
                              (
                                isSavingMusicalNumber ||
                                !musicalNumberSceneTitle ||
                                !selectedMusicalNumberStartEntry ||
                                !selectedMusicalNumberEndEntry ||
                                selectedMusicalNumberFormSongs.length === 0
                              ) &&
                                styles.buttonDisabled,
                            ]}
                            onPress={() => void handleSaveMusicalNumber()}
                            disabled={
                              isSavingMusicalNumber ||
                              !musicalNumberSceneTitle ||
                              !selectedMusicalNumberStartEntry ||
                              !selectedMusicalNumberEndEntry ||
                              selectedMusicalNumberFormSongs.length === 0
                            }
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

                      {orderedMusicalNumbers.length > 0 ? (
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
                              onPress={() => void handleDeleteMusicalNumber(selectedMusicalNumber)}
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
                                    {isMusicalNumberUploading
                                      ? 'Subiendo audio...'
                                      : 'Seleccionar audio o video'}
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
      {shouldShowFloatingPlaybackControls && activePlaybackEntry ? (
        <View
          style={[
            styles.floatingPlaybackBar,
            floatingPlaybackBarOverlayStyle as never,
          ]}
        >
          <View style={styles.floatingPlaybackText}>
            <Text style={styles.floatingPlaybackTitle} numberOfLines={1}>
              {activePlaybackEntry.musicalNumber?.title || activePlaybackEntry.audio.label}
            </Text>
            <Text style={styles.floatingPlaybackMeta} numberOfLines={1}>
              {isPreviewAudioPaused
                ? 'Pausado'
                : activePlaylistMode
                  ? activePlaylistDescription || 'Reproduciendo lista'
                  : 'Reproduciendo cancion'}
            </Text>
          </View>
          <View style={styles.floatingPlaybackActions}>
            <TouchableOpacity
              style={[
                styles.floatingPlaybackButton,
                activePlaybackEntry.kind !== 'playlist' ||
                activePlaybackEntry.total < 2
                  ? styles.floatingPlaybackButtonDisabled
                  : null,
              ]}
              onPress={() => void handleNavigateFloatingPlaylist('previous')}
              disabled={activePlaybackEntry.kind !== 'playlist' || activePlaybackEntry.total < 2}
            >
              <MaterialCommunityIcons name="skip-previous" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.floatingPlaybackButton}
              onPress={() => void handleToggleFloatingPlayback()}
            >
              <MaterialCommunityIcons
                name={isPreviewAudioPaused ? 'play' : 'pause'}
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.floatingPlaybackButton,
                activePlaybackEntry.kind !== 'playlist' ||
                activePlaybackEntry.total < 2
                  ? styles.floatingPlaybackButtonDisabled
                  : null,
              ]}
              onPress={() => void handleNavigateFloatingPlaylist('next')}
              disabled={activePlaybackEntry.kind !== 'playlist' || activePlaybackEntry.total < 2}
            >
              <MaterialCommunityIcons name="skip-next" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.floatingPlaybackCloseButton}
              onPress={handleCloseFloatingPlayback}
            >
              <MaterialCommunityIcons name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
  sceneSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sceneChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4d1b3',
    backgroundColor: '#f5ede3',
    gap: 2,
  },
  sceneChipSelected: {
    backgroundColor: '#fff8ef',
    borderColor: '#c29557',
  },
  sceneChipText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  sceneChipTextSelected: {
    color: '#7a4d13',
  },
  sceneChipMeta: {
    color: '#8a775f',
    fontSize: 12,
  },
  sceneChipMetaSelected: {
    color: '#7a6332',
  },
  selectedSceneBox: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e4d1b3',
    backgroundColor: '#fff8ef',
  },
  selectedSceneTitle: {
    textAlign: 'center',
    color: '#5f3a00',
    fontWeight: '800',
  },
  selectedSceneMeta: {
    textAlign: 'center',
    color: '#6b5b49',
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
  floatingPlaybackBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(95, 12, 20, 0.22)',
    backgroundColor: 'rgba(95, 12, 20, 0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  floatingPlaybackText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  floatingPlaybackTitle: {
    color: '#fffaf2',
    fontWeight: '700',
    fontSize: 14,
  },
  floatingPlaybackMeta: {
    color: 'rgba(255, 245, 230, 0.82)',
    fontSize: 12.5,
  },
  floatingPlaybackActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingPlaybackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  floatingPlaybackButtonDisabled: {
    opacity: 0.4,
  },
  floatingPlaybackCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
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
  songBoundaryStartRow: {
    borderColor: '#4f772d',
  },
  songBoundaryEndRow: {
    borderColor: '#7a4d13',
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
  boundaryBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  boundaryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  boundaryBadgeStart: {
    backgroundColor: 'rgba(79, 119, 45, 0.12)',
    borderColor: 'rgba(79, 119, 45, 0.32)',
  },
  boundaryBadgeEnd: {
    backgroundColor: 'rgba(122, 77, 19, 0.12)',
    borderColor: 'rgba(122, 77, 19, 0.32)',
  },
  boundaryBadgeText: {
    color: '#5f3a00',
    fontWeight: '700',
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
  musicalNumberSummaryBox: {
    gap: 4,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ecdcc5',
    backgroundColor: 'rgba(255,255,255,0.82)',
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
  rangeEntryList: {
    gap: 10,
  },
  rangeEntryRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#edd6b2',
    backgroundColor: '#fff',
  },
  rangeEntryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  rangeEntryBadgeSong: {
    backgroundColor: 'rgba(122, 77, 19, 0.12)',
    borderColor: 'rgba(122, 77, 19, 0.28)',
  },
  rangeEntryBadgeDialogue: {
    backgroundColor: 'rgba(24, 78, 119, 0.1)',
    borderColor: 'rgba(24, 78, 119, 0.24)',
  },
  rangeEntryBadgeText: {
    color: '#5f3a00',
    fontWeight: '700',
  },
  rangeEntryText: {
    flex: 1,
    gap: 4,
  },
  rangeEntryTitle: {
    color: '#432818',
    fontWeight: '700',
  },
  rangeEntryMeta: {
    color: '#6b5b49',
    lineHeight: 20,
  },
  boundaryActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  boundaryActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4d1b3',
    backgroundColor: '#f5ede3',
    alignItems: 'center',
  },
  boundaryActionButtonActive: {
    backgroundColor: '#7a4d13',
    borderColor: '#7a4d13',
  },
  boundaryActionText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  boundaryActionTextActive: {
    color: '#fff',
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
  audioPauseButton: {
    backgroundColor: '#f5ede3',
    borderColor: '#e4d1b3',
  },
  audioPlayText: {
    color: '#184e77',
    fontWeight: '700',
  },
  audioPauseText: {
    color: '#6f4c19',
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
