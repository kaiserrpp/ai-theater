import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSilenceAdvance } from '../hooks/useSilenceAdvance';
import {
  LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
} from '../store/storageKeys';
import { Dialogue } from '../types/script';
import { SharedSongAsset } from '../types/sharedScript';
import { speakRehearsalSpeech, stopRehearsalSpeech } from '../utils/rehearsalSpeech';
import { filterScriptByScenes, isSceneMarker, isSongCue, lineMatchesRoles } from '../utils/scriptScenes';
import { findSharedSongForLine, formatSongAudioKind } from '../utils/sharedSongs';

interface Props {
  guion: Dialogue[];
  myRoles: string[];
  filterScenes: string[];
  sharedSongs?: SharedSongAsset[];
  initialIndex?: number;
  onProgressChange?: (lineIndex: number, totalLines: number) => void;
  onExit: () => void;
}

export const RehearsalView: React.FC<Props> = ({
  guion,
  myRoles,
  filterScenes,
  sharedSongs = [],
  initialIndex = 0,
  onProgressChange,
  onExit,
}) => {
  const filteredGuion = useMemo(() => filterScriptByScenes(guion, filterScenes), [filterScenes, guion]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [autoListenEnabled, setAutoListenEnabled] = useState(true);
  const [temporarilySuspendingAutoListen, setTemporarilySuspendingAutoListen] = useState(false);
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [compatibilityMessage, setCompatibilityMessage] = useState<string | null>(null);
  const [showCompatibilityInfo, setShowCompatibilityInfo] = useState(false);
  const [blockedAutoplayAudio, setBlockedAutoplayAudio] = useState<{
    audioId: string;
    audioUrl: string;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoStartedSongKeyRef = useRef<string | null>(null);

  const currentLine = filteredGuion[currentIndex];
  const speakableLineText = useMemo(
    () =>
      currentLine?.t
        ?.replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ?? '',
    [currentLine]
  );
  const isMyTurn = lineMatchesRoles(currentLine, myRoles);
  const isFinished = currentIndex >= filteredGuion.length;
  const canGoBack = currentIndex > 0;
  const currentSongAsset = useMemo(
    () => findSharedSongForLine(sharedSongs, guion, currentLine),
    [currentLine, guion, sharedSongs]
  );
  const currentSongKey = isSongCue(currentLine)
    ? `${currentIndex}:${currentSongAsset?.id ?? currentLine?.songTitle ?? 'song'}`
    : null;
  const currentDialogueKey =
    !isFinished && currentLine ? `${currentIndex}:${currentLine.p}:${currentLine.t}` : null;
  const effectiveAutoListenEnabled = autoListenEnabled && !temporarilySuspendingAutoListen;
  const shouldArmListeningForCurrentLine =
    effectiveAutoListenEnabled &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isSongCue(currentLine) &&
    isMyTurn &&
    speakableLineText.length > 0;

  const isAutoplayBlockedError = useCallback((error: unknown) => {
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    const errorMessage =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
    const normalizedText = `${errorName} ${errorMessage}`.toLowerCase();

    return (
      normalizedText.includes('notallowed') ||
      normalizedText.includes('not allowed') ||
      normalizedText.includes('user gesture') ||
      normalizedText.includes('gesture')
    );
  }, []);

  const advanceLine = useCallback(() => {
    setCurrentIndex((previousIndex) =>
      previousIndex < filteredGuion.length ? previousIndex + 1 : previousIndex
    );
  }, [filteredGuion.length]);

  const {
    listeningStatus,
    listeningError,
    isListeningActive,
    isListeningSupported,
    signalLevel,
    hasSpeechStarted,
    isSignalAboveThreshold,
    silenceElapsedMs,
    voiceThreshold,
    lineStateLabel,
    startListening,
    stopListening,
  } = useSilenceAdvance({
    enabledForCurrentLine: shouldArmListeningForCurrentLine,
    lineKey: currentDialogueKey,
    onSilenceDetected: advanceLine,
  });

  const disableAutoListenForDevice = useCallback(
    async (reasonMessage: string, storedValue = 'manual-disabled') => {
      setAutoListenEnabled(false);
      setTemporarilySuspendingAutoListen(false);
      setCompatibilityMessage(reasonMessage);
      setShowCompatibilityInfo(false);
      await stopListening();

      try {
        await AsyncStorage.setItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY, storedValue);
      } catch (error) {
        console.error('Error guardando compatibilidad de audio', error);
      }
    },
    [stopListening]
  );

  const enableAutoListenForDevice = useCallback(async () => {
    setAutoListenEnabled(true);
    setTemporarilySuspendingAutoListen(false);
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);

    try {
      await Promise.all([
        AsyncStorage.removeItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
        AsyncStorage.removeItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
      ]);
    } catch (error) {
      console.error('Error reseteando compatibilidad de audio', error);
    }
  }, []);

  const stopSongAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setPlayingAudioId(null);
  }, []);

  const goBackLine = useCallback(() => {
    stopRehearsalSpeech();
    stopSongAudio();
    setCurrentIndex((previousIndex) => Math.max(0, previousIndex - 1));
  }, [stopSongAudio]);

  useEffect(() => {
    const safeInitialIndex = Math.max(0, Math.min(initialIndex, filteredGuion.length));
    setCurrentIndex(safeInitialIndex);
  }, [filteredGuion, initialIndex]);

  useEffect(() => {
    onProgressChange?.(Math.min(currentIndex, filteredGuion.length), filteredGuion.length);
  }, [currentIndex, filteredGuion.length, onProgressChange]);

  useEffect(() => {
    setAudioError(null);
    setBlockedAutoplayAudio(null);
  }, [currentSongKey]);

  useEffect(() => {
    let isMounted = true;

    const loadAudioCompatibility = async () => {
      try {
        const [storedMode, legacyStoredMode] = await Promise.all([
          AsyncStorage.getItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
          AsyncStorage.getItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
        ]);
        if (!isMounted) {
          return;
        }

        if (legacyStoredMode) {
          await AsyncStorage.removeItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY);
        }

        if (storedMode === 'manual-disabled') {
          setAutoListenEnabled(false);
          setTemporarilySuspendingAutoListen(false);
          setCompatibilityMessage(
            'En este dispositivo has desactivado la escucha automatica porque la voz del resto no se escuchaba bien.'
          );
          return;
        }

        setAutoListenEnabled(true);
        setTemporarilySuspendingAutoListen(false);
        setCompatibilityMessage(null);

        if (storedMode === 'disabled' || storedMode === 'enabled') {
          await AsyncStorage.removeItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY);
        }
      } catch (error) {
        console.error('Error cargando compatibilidad de audio', error);
      }
    };

    void loadAudioCompatibility();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isMyTurn || isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine)) {
      setSpeechStatusMessage(null);
      setTemporarilySuspendingAutoListen(false);
    }
  }, [currentLine, isFinished, isMyTurn]);

  useEffect(() => {
    if (!effectiveAutoListenEnabled) {
      if (isListeningActive) {
        void stopListening();
      }
      return;
    }

    if (shouldArmListeningForCurrentLine) {
      if (!isListeningActive && listeningStatus !== 'requesting' && listeningStatus !== 'error') {
        void startListening();
      }
      return;
    }

    if (isListeningActive) {
      void stopListening();
    }
  }, [
    effectiveAutoListenEnabled,
    isListeningActive,
    listeningStatus,
    shouldArmListeningForCurrentLine,
    startListening,
    stopListening,
  ]);

  useEffect(() => {
    stopRehearsalSpeech();
    stopSongAudio();
    let isCancelled = false;
    let advanceTimeout: ReturnType<typeof setTimeout> | null = null;
    let speechStartTimeout: ReturnType<typeof setTimeout> | null = null;

    if (isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine) || isMyTurn) {
      return () => {
        stopRehearsalSpeech();
        stopSongAudio();
      };
    }

    if (!speakableLineText) {
      advanceTimeout = setTimeout(advanceLine, 200);
      return () => {
        if (advanceTimeout) {
          clearTimeout(advanceTimeout);
        }
        stopRehearsalSpeech();
        stopSongAudio();
      };
    }

    if (autoListenEnabled && !temporarilySuspendingAutoListen) {
      setSpeechStatusMessage('Preparando la voz de Siri para la siguiente linea...');
      setTemporarilySuspendingAutoListen(true);
      return;
    }

    if (temporarilySuspendingAutoListen && (isListeningActive || listeningStatus === 'requesting')) {
      setSpeechStatusMessage('Liberando el micro para reproducir la siguiente linea...');
      return;
    }

    const playOtherLine = async () => {
      if (temporarilySuspendingAutoListen) {
        await stopListening();
        if (isCancelled) {
          return;
        }
      }

      const speechDelayMs = temporarilySuspendingAutoListen ? 0 : autoListenEnabled ? 120 : 0;
      setSpeechStatusMessage(
        temporarilySuspendingAutoListen || autoListenEnabled
          ? 'Micro liberado. Preparando la voz de Siri para la siguiente linea...'
          : 'Preparando la voz de Siri para la siguiente linea...'
      );

      speechStartTimeout = setTimeout(() => {
        setSpeechStatusMessage('Lanzando la linea con Siri...');
        speakRehearsalSpeech(speakableLineText, {
          onStart: () => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage('Reproduciendo la linea con Siri...');
          },
          onDone: () => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage('Linea reproducida. Avanzando...');
            advanceTimeout = setTimeout(advanceLine, 500);
          },
          onError: (error) => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage(
              `Siri ha fallado al reproducir esta linea (${error.message}).`
            );
          },
        });
      }, speechDelayMs);
    };

    void playOtherLine();

    return () => {
      isCancelled = true;
      if (advanceTimeout) {
        clearTimeout(advanceTimeout);
      }
      if (speechStartTimeout) {
        clearTimeout(speechStartTimeout);
      }
      void stopListening();
      stopRehearsalSpeech();
      stopSongAudio();
    };
  }, [
    advanceLine,
    autoListenEnabled,
    currentLine,
    temporarilySuspendingAutoListen,
    isFinished,
    isListeningActive,
    listeningStatus,
    isMyTurn,
    speakableLineText,
    stopListening,
    stopSongAudio,
  ]);

  useEffect(() => () => {
    stopSongAudio();
  }, [stopSongAudio]);

  const handleExit = () => {
    stopRehearsalSpeech();
    stopSongAudio();
    void stopListening();
    onExit();
  };

  const handlePlaySongAudio = useCallback((
    audioUrl: string,
    audioId: string,
    options?: { advanceOnEnd?: boolean; autoStart?: boolean }
  ) => {
    if (typeof Audio === 'undefined') {
      setAudioError('La reproduccion de audio solo esta disponible en la app web.');
      return;
    }

    if (playingAudioId === audioId && audioRef.current) {
      stopSongAudio();
      return;
    }

    setAudioError(null);
    setBlockedAutoplayAudio(null);
    stopSongAudio();

    const nextAudio = new Audio(audioUrl);
    nextAudio.onended = () => {
      setPlayingAudioId(null);
      audioRef.current = null;
      if (options?.advanceOnEnd) {
        advanceLine();
      }
    };
    nextAudio.onerror = () => {
      setPlayingAudioId(null);
      audioRef.current = null;
      setAudioError('No se pudo reproducir este audio.');
    };

    audioRef.current = nextAudio;
    setPlayingAudioId(audioId);

    void nextAudio.play().catch((error: unknown) => {
      setPlayingAudioId(null);
      audioRef.current = null;
      if (options?.autoStart && isAutoplayBlockedError(error)) {
        setBlockedAutoplayAudio({ audioId, audioUrl });
        setAudioError('Safari o iPhone necesita que actives el audio manualmente para esta cancion.');
        return;
      }

      setAudioError('No se pudo reproducir este audio.');
    });
  }, [advanceLine, isAutoplayBlockedError, playingAudioId, stopSongAudio]);

  useEffect(() => {
    if (!currentSongKey) {
      autoStartedSongKeyRef.current = null;
      return;
    }

    if (!currentSongAsset || currentSongAsset.audios.length !== 1) {
      return;
    }

    if (autoStartedSongKeyRef.current === currentSongKey) {
      return;
    }

    autoStartedSongKeyRef.current = currentSongKey;
    const [singleAudio] = currentSongAsset.audios;
    handlePlaySongAudio(singleAudio.audioUrl, singleAudio.id, {
      advanceOnEnd: true,
      autoStart: true,
    });
  }, [currentSongAsset, currentSongKey, handlePlaySongAudio]);

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <TouchableOpacity onPress={handleExit}>
          <Text style={styles.blue}>Cerrar ensayo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goBackLine} disabled={!canGoBack}>
          <Text style={[styles.backLink, !canGoBack && styles.backLinkDisabled]}>{'<'} Linea anterior</Text>
        </TouchableOpacity>
        {isListeningSupported ? (
          <TouchableOpacity
            onPress={() => {
              if (!autoListenEnabled) {
                void enableAutoListenForDevice();
              }
            }}
            disabled={autoListenEnabled}
          >
            <Text
              style={[
                styles.listenLink,
                autoListenEnabled && styles.listenLinkActive,
                !autoListenEnabled && styles.listenLinkResettable,
              ]}
            >
              {listeningStatus === 'requesting'
                ? 'Pidiendo micro...'
                : isListeningActive
                  ? 'Escucha activa'
                  : autoListenEnabled
                    ? 'Escucha automatica'
                    : 'Escucha manual'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.headerStatus}>
        <View style={styles.headerStatusTopRow}>
          <Text style={styles.sceneName}>{title}</Text>
          {compatibilityMessage ? (
            <TouchableOpacity
              style={styles.compatibilityDot}
              onPress={() => setShowCompatibilityInfo((previous) => !previous)}
            >
              <Text style={styles.compatibilityDotText}>!</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {autoListenEnabled ? (
          <Text style={styles.listenStatus}>
            {isListeningActive ? 'Micro escuchando tu replica' : 'Escucha lista para tu proxima replica'}
          </Text>
        ) : null}
        {compatibilityMessage && showCompatibilityInfo ? (
          <View style={styles.compatibilityPopover}>
            <Text style={styles.compatibilityPopoverText}>{compatibilityMessage}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (isSceneMarker(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cambio de escena')}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Escena: {currentLine.t}</Text>
          <TouchableOpacity style={styles.btnNext} onPress={advanceLine}>
            <Text style={styles.btnText}>Empezar esta escena</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isSongCue(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cancion dentro de la escena')}

        <ScrollView contentContainerStyle={styles.center}>
          <View style={styles.songBox}>
            <Text style={styles.songBadge}>Cancion</Text>
            <Text style={styles.songTitle}>{currentLine.songTitle || 'Cancion'}</Text>
            {currentLine.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}

            {currentSongAsset?.audios.length ? (
              <View style={styles.songAudioList}>
                <Text style={styles.songSectionTitle}>Audios disponibles</Text>
                {blockedAutoplayAudio ? (
                  <View style={styles.songActivationCard}>
                    <Text style={styles.songActivationText}>
                      Safari ha bloqueado el arranque automatico de esta cancion.
                    </Text>
                    <TouchableOpacity
                      style={styles.songActivationButton}
                      onPress={() =>
                        handlePlaySongAudio(blockedAutoplayAudio.audioUrl, blockedAutoplayAudio.audioId, {
                          advanceOnEnd: true,
                        })
                      }
                    >
                      <Text style={styles.songActivationButtonText}>Activar audio y reproducir</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {currentSongAsset.audios.map((audio) => {
                  const isPlaying = playingAudioId === audio.id;

                  return (
                    <View key={audio.id} style={styles.songAudioCard}>
                      <View style={styles.songAudioText}>
                        <Text style={styles.songAudioTitle}>{audio.label}</Text>
                        <Text style={styles.songAudioMeta}>
                          {formatSongAudioKind(audio.kind)}
                          {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.songAudioButton, isPlaying && styles.songAudioButtonActive]}
                        onPress={() => handlePlaySongAudio(audio.audioUrl, audio.id, { advanceOnEnd: true })}
                      >
                        <Text style={styles.songAudioButtonText}>{isPlaying ? 'Detener' : 'Reproducir'}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.songHint}>Todavia no hay audios cargados para esta cancion.</Text>
            )}

            {audioError ? <Text style={styles.songErrorText}>{audioError}</Text> : null}
            <Text style={styles.songText}>{currentLine.t}</Text>
            <Text style={styles.songHint}>
              {currentSongAsset?.audios.length === 1
                ? 'La cancion se reproduce automaticamente y al terminar pasa a la linea siguiente.'
                : 'La voz se pausa aqui para que podais seguir la letra manualmente.'}
            </Text>
          </View>
        </ScrollView>

        <TouchableOpacity style={[styles.footer, styles.songFooter]} onPress={advanceLine}>
          <Text style={styles.btnText}>Continuar tras la cancion</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader(`Ensayando ${filterScenes.length} escenas`)}

      <ScrollView contentContainerStyle={styles.center}>
        {isFinished ? (
          <View style={styles.finishedBox}>
            <Text style={styles.finishedTitle}>Fin del ensayo</Text>
            <TouchableOpacity onPress={handleExit} style={styles.btnBack}>
              <Text style={styles.btnText}>Volver al inicio</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.box, isMyTurn && styles.myBox]}>
            <Text style={[styles.name, isMyTurn && styles.myName]}>{currentLine?.p}</Text>
            {currentLine?.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}
            <Text style={[styles.text, isMyTurn && styles.myText]}>{currentLine?.t}</Text>
            {isMyTurn && (
              <Text style={styles.myTurnHint}>
                Tu turno: lee y guardaremos silencio para pasar solos, o pulsa siguiente si lo prefieres.
              </Text>
            )}
            {isMyTurn && listeningStatus === 'error' && listeningError ? (
              <Text style={styles.listenError}>{listeningError}</Text>
            ) : null}
            {isMyTurn && autoListenEnabled ? (
              <View style={styles.listenMonitor}>
                <Text style={styles.listenHint}>
                  {isListeningActive
                    ? 'El micro esta abierto en esta replica: cuando termines y guardes silencio, pasaremos solos.'
                    : 'La escucha esta activada para el ensayo y abriremos el micro automaticamente al entrar en tu replica.'}
                </Text>
                <View style={styles.listenMeterTrack}>
                  <View
                    style={[
                      styles.listenMeterFill,
                      {
                        width: `${Math.max(6, Math.round(signalLevel * 100))}%`,
                        backgroundColor: isSignalAboveThreshold ? '#2b9348' : '#d98a00',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.listenDebugText}>
                  Nivel micro: {Math.round(signalLevel * 100)}% · Estado:{' '}
                  {lineStateLabel}
                </Text>
                <Text style={styles.listenDebugText}>
                  Silencio acumulado: {(silenceElapsedMs / 1000).toFixed(1)} s
                </Text>
                <Text style={styles.listenDebugText}>
                  Umbral de voz: {(voiceThreshold * 100).toFixed(1)}%
                </Text>
                <Text style={styles.listenDebugText}>
                  Voz confirmada: {hasSpeechStarted ? 'si' : 'no'} · Sobre umbral:{' '}
                  {isSignalAboveThreshold ? 'si' : 'no'}
                </Text>
              </View>
            ) : null}
            {!isMyTurn && speechStatusMessage ? (
              <View style={styles.speechMonitor}>
                <Text style={styles.speechMonitorText}>{speechStatusMessage}</Text>
                {autoListenEnabled ? (
                  <TouchableOpacity
                    style={styles.speechFallbackButton}
                    onPress={() =>
                      void disableAutoListenForDevice(
                        'Hemos desactivado la escucha automatica en este dispositivo porque has indicado que la voz del resto no se escucha bien.'
                      )
                    }
                  >
                    <Text style={styles.speechFallbackButtonText}>No se escucha la voz</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={styles.speechMonitorTextSmall}>
                  Estado micro: {listeningStatus} · Escucha automatica: si
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {!isFinished && (
        <TouchableOpacity style={[styles.footer, isMyTurn && styles.footerActive]} onPress={advanceLine}>
          <Text style={styles.btnText}>{isMyTurn ? 'Hecho (siguiente)' : 'Saltar linea'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingTop: 60,
    padding: 20,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#eee',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    gap: 8,
  },
  headerStatus: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: '58%',
  },
  headerStatusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  blue: { color: '#007AFF', fontWeight: 'bold' },
  backLink: { color: '#007AFF', fontWeight: '600' },
  backLinkDisabled: { color: '#9fb9d3' },
  listenLink: { color: '#8a5a00', fontWeight: '700' },
  listenLinkActive: { color: '#2b9348' },
  listenLinkResettable: { color: '#c96b00', textDecorationLine: 'underline' },
  sceneName: { fontSize: 12, color: '#666' },
  listenStatus: { fontSize: 12, color: '#2b9348', fontWeight: '600' },
  compatibilityDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#d62828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compatibilityDotText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },
  compatibilityPopover: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(214, 40, 40, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(214, 40, 40, 0.18)',
    maxWidth: 240,
  },
  compatibilityPopoverText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a1f1f',
    textAlign: 'right',
  },
  center: { flexGrow: 1, justifyContent: 'center', padding: 25 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  introTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 30 },
  finishedBox: { alignItems: 'center' },
  finishedTitle: { fontSize: 20, fontWeight: 'bold' },
  box: { padding: 30, borderRadius: 20, backgroundColor: '#f8f9fa', alignItems: 'center' },
  songBox: {
    padding: 28,
    borderRadius: 20,
    backgroundColor: '#fff7e8',
    borderWidth: 1,
    borderColor: '#f1d18a',
    width: '100%',
  },
  songBadge: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0b84a',
    color: '#5f3a00',
    fontWeight: '700',
  },
  songTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 14,
    color: '#5f3a00',
  },
  songText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 34,
    color: '#4d3b16',
  },
  songHint: {
    marginTop: 20,
    textAlign: 'center',
    color: '#7a6332',
    fontSize: 14,
  },
  songSectionTitle: {
    marginTop: 0,
    marginBottom: 10,
    textAlign: 'center',
    color: '#5f3a00',
    fontWeight: '800',
  },
  songAudioList: {
    gap: 10,
  },
  songActivationCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(95, 58, 0, 0.08)',
    borderWidth: 1,
    borderColor: '#d3b26f',
    gap: 10,
  },
  songActivationText: {
    textAlign: 'center',
    color: '#5f3a00',
    lineHeight: 20,
  },
  songActivationButton: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#b06d00',
  },
  songActivationButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  songAudioCard: {
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: '#f0ddb4',
    gap: 12,
  },
  songAudioText: {
    gap: 4,
  },
  songAudioTitle: {
    fontWeight: '700',
    color: '#5f3a00',
    textAlign: 'center',
  },
  songAudioMeta: {
    textAlign: 'center',
    color: '#7a6332',
    lineHeight: 20,
  },
  songAudioButton: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#5f3a00',
  },
  songAudioButtonActive: {
    backgroundColor: '#9c2f24',
  },
  songAudioButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  songErrorText: {
    marginTop: 12,
    color: '#b3261e',
    textAlign: 'center',
    lineHeight: 20,
  },
  myBox: { backgroundColor: '#fff0f0', borderWidth: 2, borderColor: 'red' },
  name: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  myName: { color: 'red' },
  acot: { fontStyle: 'italic', color: '#666', marginBottom: 15 },
  text: { fontSize: 26, textAlign: 'center', lineHeight: 38 },
  myText: { color: '#d32f2f', fontWeight: '500' },
  myTurnHint: { marginTop: 20, fontSize: 14, color: '#d32f2f', fontWeight: 'bold' },
  listenHint: {
    marginTop: 12,
    fontSize: 14,
    color: '#4f6274',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  listenError: {
    marginTop: 12,
    fontSize: 14,
    color: '#b3261e',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  listenMonitor: {
    marginTop: 12,
    width: '100%',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: '#d7e6f5',
  },
  listenMeterTrack: {
    width: '100%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#dfe8ef',
    overflow: 'hidden',
  },
  listenMeterFill: {
    height: '100%',
    borderRadius: 999,
  },
  listenDebugText: {
    fontSize: 13,
    color: '#47604f',
    textAlign: 'center',
    lineHeight: 18,
  },
  speechMonitor: {
    marginTop: 14,
    width: '100%',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(235, 244, 255, 0.92)',
    borderWidth: 1,
    borderColor: '#d4e3f3',
    gap: 6,
  },
  speechMonitorText: {
    color: '#22476b',
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 20,
  },
  speechMonitorTextSmall: {
    color: '#4f6274',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
  },
  speechFallbackButton: {
    alignSelf: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#b06d00',
  },
  speechFallbackButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  footer: { backgroundColor: '#007AFF', padding: 25, alignItems: 'center' },
  footerActive: { backgroundColor: 'red' },
  songFooter: { backgroundColor: '#d98a00' },
  btnNext: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  btnBack: { backgroundColor: '#333', padding: 15, borderRadius: 10, marginTop: 20 },
});
