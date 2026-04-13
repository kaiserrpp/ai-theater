import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { uploadSharedSongAudio } from '../api/sharedSongUploads';
import { registerSharedSongAudio, verifySongAdminPassword } from '../api/sharedScripts';
import {
  SharedScriptManifest,
  SharedSongAsset,
  SharedSongAudioKind,
} from '../types/sharedScript';
import { formatSongAudioKind } from '../utils/sharedSongs';

interface Props {
  sharedScript: SharedScriptManifest | null;
  availableRoles: string[];
  onManifestUpdated: (manifest: SharedScriptManifest) => void;
}

const DEFAULT_UPLOAD_KIND: SharedSongAudioKind = 'karaoke';

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
  onManifestUpdated,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState('');
  const [audioKind, setAudioKind] = useState<SharedSongAudioKind>(DEFAULT_UPLOAD_KIND);
  const [guideRoles, setGuideRoles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);

  useEffect(() => {
    if (!sharedScript?.songs.length) {
      setSelectedSongId(null);
      return;
    }

    setSelectedSongId((previousSongId) =>
      previousSongId && sharedScript.songs.some((song) => song.id === previousSongId)
        ? previousSongId
        : sharedScript.songs[0].id
    );
  }, [sharedScript]);

  const selectedSong = useMemo<SharedSongAsset | null>(() => {
    if (!sharedScript || !selectedSongId) {
      return null;
    }

    return sharedScript.songs.find((song) => song.id === selectedSongId) ?? null;
  }, [selectedSongId, sharedScript]);

  const totalAudioCount = useMemo(
    () => sharedScript?.songs.reduce((count, song) => count + song.audios.length, 0) ?? 0,
    [sharedScript]
  );

  const toggleGuideRole = (role: string) => {
    setGuideRoles((previousRoles) =>
      previousRoles.includes(role)
        ? previousRoles.filter((currentRole) => currentRole !== role)
        : [...previousRoles, role]
    );
  };

  const handleUnlock = async () => {
    if (!password.trim()) {
      setPasswordError('Introduce la password de gestion.');
      return;
    }

    setIsVerifyingPassword(true);
    setPasswordError(null);

    try {
      await verifySongAdminPassword(password.trim());
      setIsUnlocked(true);
      setManagerError(null);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'No se pudo validar la password.');
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleUploadAudio = async () => {
    if (!sharedScript || !selectedSong) {
      return;
    }

    setManagerError(null);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: false,
      });

      if (result.canceled) {
        return;
      }

      const file = await resolveAssetBlob(result.assets[0]);
      const nextLabel = audioLabel.trim() || buildDefaultAudioLabel(audioKind, guideRoles);

      setIsUploading(true);
      setUploadProgress(0);

      const uploadedAudio = await uploadSharedSongAudio({
        shareId: sharedScript.shareId,
        songId: selectedSong.id,
        file,
        password: password.trim(),
        onUploadProgress: (percentage) => setUploadProgress(Math.round(percentage)),
      });

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
      setAudioLabel('');
      setAudioKind(DEFAULT_UPLOAD_KIND);
      setGuideRoles([]);
      setUploadProgress(null);
    } catch (error) {
      setManagerError(error instanceof Error ? error.message : 'No se pudo subir el audio.');
    } finally {
      setIsUploading(false);
    }
  };

  const isDisabled = !sharedScript;

  return (
    <View style={styles.wrapper}>
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

      {!isVisible ? null : (
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

              {Platform.OS !== 'web' ? (
                <Text style={styles.infoText}>
                  La subida de canciones esta disponible en la app web.
                </Text>
              ) : !isUnlocked ? (
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
              ) : (
                <>
                  <Text style={styles.successText}>Sesion de gestion activa.</Text>

                  <View style={styles.songList}>
                    {sharedScript.songs.map((song) => {
                      const isSelected = selectedSong?.id === song.id;

                      return (
                        <TouchableOpacity
                          key={song.id}
                          style={[styles.songRow, isSelected && styles.songRowSelected]}
                          onPress={() => setSelectedSongId(song.id)}
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

                  {selectedSong ? (
                    <View style={styles.songDetailBox}>
                      <Text style={styles.songDetailTitle}>{selectedSong.title}</Text>
                      <Text style={styles.songDetailMeta}>{selectedSong.sceneTitle || 'Sin escena asociada'}</Text>
                      <Text style={styles.songLyrics}>{selectedSong.lyrics}</Text>

                      {selectedSong.audios.length > 0 ? (
                        <View style={styles.audioList}>
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
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.infoText}>Todavia no hay audios para esta cancion.</Text>
                      )}

                      <View style={styles.formSection}>
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

                        <TouchableOpacity
                          style={[styles.primaryAction, isUploading && styles.buttonDisabled]}
                          onPress={() => void handleUploadAudio()}
                          disabled={isUploading}
                        >
                          <Text style={styles.primaryActionText}>
                            {isUploading ? 'Subiendo audio...' : 'Seleccionar audio'}
                          </Text>
                        </TouchableOpacity>
                      </View>
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
  },
  formLabel: {
    fontWeight: '700',
    color: '#432818',
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
  buttonDisabled: {
    opacity: 0.6,
  },
});
