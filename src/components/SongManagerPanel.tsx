import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { uploadSharedSongAudio } from '../api/sharedSongUploads';
import {
  deleteSharedSongAudio,
  registerSharedSongAudio,
  updateSharedSongAudio,
  verifySongAdminPassword,
} from '../api/sharedScripts';
import {
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
let cachedSongAdminPassword: string | null = null;

const buildDefaultAudioLabel = (kind: SharedSongAudioKind, guideRoles: string[]) => {
  if (kind === 'vocal_guide') {
    return guideRoles.length > 0 ? `Vocal guide - ${guideRoles.join(' + ')}` : 'Vocal guide';
  }

  return 'Karaoke';
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
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
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
  const [playingPreviewAudioId, setPlayingPreviewAudioId] = useState<string | null>(null);
  const [previewAudioError, setPreviewAudioError] = useState<string | null>(null);
  const [previewAudioElement] = useState<HTMLAudioElement | null>(
    typeof Audio === 'undefined' ? null : new Audio()
  );
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
    setAudioLabel('');
    setAudioKind(DEFAULT_UPLOAD_KIND);
    setGuideRoles([]);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
  }, [selectedSongId]);

  const selectedSong = useMemo<SharedSongAsset | null>(() => {
    if (!selectedSongId) {
      return null;
    }

    return songsForCurrentView.find((song) => song.id === selectedSongId) ?? null;
  }, [selectedSongId, songsForCurrentView]);

  const editingAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!selectedSong || !editingAudioId) {
      return null;
    }

    return selectedSong.audios.find((audio) => audio.id === editingAudioId) ?? null;
  }, [editingAudioId, selectedSong]);

  const toggleGuideRole = (role: string) => {
    setGuideRoles((previousRoles) =>
      previousRoles.includes(role)
        ? previousRoles.filter((currentRole) => currentRole !== role)
        : [...previousRoles, role]
    );
  };

  const stopPreviewAudio = useCallback(() => {
    if (!previewAudioElement) {
      return;
    }

    previewAudioElement.pause();
    previewAudioElement.currentTime = 0;
    previewAudioElement.onended = null;
    previewAudioElement.onerror = null;
    setPlayingPreviewAudioId(null);
  }, [previewAudioElement]);

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
      stopPreviewAudio();

      previewAudioElement.src = audio.audioUrl;
      previewAudioElement.load();
      previewAudioElement.onended = () => {
        setPlayingPreviewAudioId(null);
      };
      previewAudioElement.onerror = () => {
        setPlayingPreviewAudioId(null);
        setPreviewAudioError('No se pudo reproducir este audio.');
      };

      try {
        setPlayingPreviewAudioId(audio.id);
        await previewAudioElement.play();
      } catch {
        setPlayingPreviewAudioId(null);
        setPreviewAudioError('No se pudo reproducir este audio.');
      }
    },
    [playingPreviewAudioId, previewAudioElement, stopPreviewAudio]
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

  const resetAudioForm = () => {
    setAudioLabel('');
    setAudioKind(DEFAULT_UPLOAD_KIND);
    setGuideRoles([]);
    setUploadProgress(null);
    setManagerError(null);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
  };

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
      songId: selectedSong.id,
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

  const isDisabled = !sharedScript;
  const isPanelVisible = standalone || isVisible;
  const canManageSongs = Platform.OS === 'web';

  const resetManagerPanels = useCallback(() => {
    setIsSongPickerVisible(false);
    setIsUploadFormVisible(false);
    setEditingAudioId(null);
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

  const renderSongList = (songs: SharedSongAsset[]) => (
    <View style={styles.songList}>
      {songs.map((song) => {
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
  );

  const renderSongPracticeDetail = () => {
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

                  {songsForCurrentView.length > 0 ? (
                    <>
                      {renderSongList(songsForCurrentView)}
                      {renderSongPracticeDetail()}
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
  selectionSummary: {
    textAlign: 'center',
    color: '#6b5b49',
    lineHeight: 20,
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
  songRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eadfca',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  songRowSelected: {
    borderColor: '#c29557',
    backgroundColor: '#fff8ef',
  },
  songRowText: {
    gap: 4,
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
