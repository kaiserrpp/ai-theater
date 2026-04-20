import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSilenceAdvance } from '../hooks/useSilenceAdvance';
import {
  LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
} from '../store/storageKeys';
import { Dialogue } from '../types/script';
import { SharedMusicalNumberAsset, SharedSongAsset, SharedSongAudioAsset } from '../types/sharedScript';
import { speakRehearsalSpeech, stopRehearsalSpeech } from '../utils/rehearsalSpeech';
import { filterScriptByScenes, isSceneMarker, isSongCue, lineMatchesRoles } from '../utils/scriptScenes';
import { findSharedSongForLine, formatSongAudioKind } from '../utils/sharedSongs';

interface Props {
  guion: Dialogue[];
  myRoles: string[];
  filterScenes: string[];
  sharedSongs?: SharedSongAsset[];
  musicalNumbers?: SharedMusicalNumberAsset[];
  initialIndex?: number;
  onProgressChange?: (lineIndex: number, totalLines: number) => void;
  onExit: () => void;
}

type RehearsalPreflightPhase = 'auto-initial' | 'manual-check' | 'auto-final' | null;
type RehearsalListenModeSelection = 'pending' | 'auto' | 'manual';

const createWavObjectUrl = ({
  frequencyHz = 0,
  durationMs = 120,
  volume = 0,
}: {
  frequencyHz?: number;
  durationMs?: number;
  volume?: number;
}) => {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return null;
  }

  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const sampleValue =
      frequencyHz > 0
        ? Math.sin(2 * Math.PI * frequencyHz * time) * Math.max(0, Math.min(volume, 1))
        : 0;
    view.setInt16(offset, Math.round(sampleValue * 32767), true);
    offset += 2;
  }

  return URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' }));
};

const createSilentWavObjectUrl = () => createWavObjectUrl({ durationMs: 120 });

const createProbeToneObjectUrl = () =>
  createWavObjectUrl({ frequencyHz: 660, durationMs: 380, volume: 0.28 });

const formatPlaybackProbeError = (error: unknown) => {
  const errorName =
    error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const errorMessage =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const normalizedMessage = [errorName, errorMessage].filter(Boolean).join(': ');

  return normalizedMessage || 'error-desconocido';
};

export const RehearsalView: React.FC<Props> = ({
  guion,
  myRoles,
  filterScenes,
  sharedSongs = [],
  musicalNumbers = [],
  initialIndex = 0,
  onProgressChange,
  onExit,
}) => {
  const filteredGuion = useMemo(() => filterScriptByScenes(guion, filterScenes), [filterScenes, guion]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [autoListenEnabled, setAutoListenEnabled] = useState(true);
  const [listenModeSelection, setListenModeSelection] =
    useState<RehearsalListenModeSelection>('pending');
  const [temporarilySuspendingAutoListen, setTemporarilySuspendingAutoListen] = useState(false);
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [compatibilityMessage, setCompatibilityMessage] = useState<string | null>(null);
  const [showCompatibilityInfo, setShowCompatibilityInfo] = useState(false);
  const [isRehearsalMediaReady, setIsRehearsalMediaReady] = useState(true);
  const [isPreparingRehearsalMedia, setIsPreparingRehearsalMedia] = useState(false);
  const [rehearsalMediaStatus, setRehearsalMediaStatus] = useState<string | null>(null);
  const [hasPreparedRehearsalMedia, setHasPreparedRehearsalMedia] = useState(false);
  const [hasCompletedRehearsalPreflight, setHasCompletedRehearsalPreflight] = useState(false);
  const [rehearsalPreflightPhase, setRehearsalPreflightPhase] = useState<RehearsalPreflightPhase>(null);
  const [isSongPlaybackUnlocked, setIsSongPlaybackUnlocked] = useState(false);
  const [songPlaybackProbeStatus, setSongPlaybackProbeStatus] = useState<string | null>(null);
  const [blockedAutoplayAudio, setBlockedAutoplayAudio] = useState<{
    audioId: string;
    audioUrl: string;
    playbackKind?: 'song' | 'musical-number';
    ownerId?: string | null;
    advanceOnEnd?: boolean;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoStartedSongKeyRef = useRef<string | null>(null);
  const autoStartedMusicalNumberKeyRef = useRef<string | null>(null);
  const activeAudioPlaybackRef = useRef<{
    kind: 'song' | 'musical-number';
    ownerId: string | null;
  } | null>(null);
  const selectedMusicalNumberAudioIdsRef = useRef<Record<string, string>>({});

  const currentLine = filteredGuion[currentIndex];
  const currentLineIndexInScript = useMemo(
    () => (currentLine ? guion.indexOf(currentLine) : -1),
    [currentLine, guion]
  );
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
  const currentMusicalNumber = useMemo(
    () =>
      currentLineIndexInScript < 0
        ? null
        : musicalNumbers.find(
            (musicalNumber) =>
              currentLineIndexInScript >= musicalNumber.startLineIndex &&
              currentLineIndexInScript <= musicalNumber.endLineIndex
          ) ?? null,
    [currentLineIndexInScript, musicalNumbers]
  );
  const preferredMusicalNumberAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!currentMusicalNumber?.audios.length) {
      return null;
    }

    const rememberedAudioId = selectedMusicalNumberAudioIdsRef.current[currentMusicalNumber.id];
    if (rememberedAudioId) {
      const rememberedAudio = currentMusicalNumber.audios.find((audio) => audio.id === rememberedAudioId);
      if (rememberedAudio) {
        return rememberedAudio;
      }
    }

    if (currentMusicalNumber.audios.length === 1) {
      return currentMusicalNumber.audios[0];
    }

    const karaokeAudios = currentMusicalNumber.audios.filter((audio) => audio.kind === 'karaoke');
    if (karaokeAudios.length === 1) {
      return karaokeAudios[0];
    }

    const matchingRoleAudios = currentMusicalNumber.audios.filter((audio) =>
      audio.guideRoles.some((role) => myRoles.includes(role))
    );
    if (matchingRoleAudios.length === 1) {
      return matchingRoleAudios[0];
    }

    return null;
  }, [currentMusicalNumber, myRoles]);
  const currentRehearsalAudioOptions = useMemo(
    () =>
      currentMusicalNumber?.audios.length
        ? currentMusicalNumber.audios
        : currentSongAsset?.audios ?? [],
    [currentMusicalNumber, currentSongAsset]
  );
  const currentSongKey = isSongCue(currentLine)
    ? `${currentIndex}:${currentSongAsset?.id ?? currentLine?.songTitle ?? 'song'}`
    : null;
  const currentMusicalNumberKey = currentMusicalNumber
    ? `${currentMusicalNumber.id}:${currentMusicalNumber.updatedAt}`
    : null;
  const currentDialogueKey =
    !isFinished && currentLine ? `${currentIndex}:${currentLine.p}:${currentLine.t}` : null;
  const effectiveAutoListenEnabled = autoListenEnabled && !temporarilySuspendingAutoListen;
  const shouldArmListeningForCurrentLine =
    effectiveAutoListenEnabled &&
    isRehearsalMediaReady &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isSongCue(currentLine) &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldKeepListeningWarmDuringSong =
    effectiveAutoListenEnabled &&
    isRehearsalMediaReady &&
    Boolean(currentLine) &&
    isSongCue(currentLine);

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
    releaseListening,
  } = useSilenceAdvance({
    enabledForCurrentLine: shouldArmListeningForCurrentLine,
    lineKey: currentDialogueKey,
    onSilenceDetected: advanceLine,
  });

  const disableAutoListenForDevice = useCallback(
    async (reasonMessage: string, storedValue = 'manual-disabled') => {
      setAutoListenEnabled(false);
      setListenModeSelection('manual');
      setTemporarilySuspendingAutoListen(false);
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      setCompatibilityMessage(reasonMessage);
      setShowCompatibilityInfo(false);
      await releaseListening();

      try {
        await AsyncStorage.setItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY, storedValue);
      } catch (error) {
        console.error('Error guardando compatibilidad de audio', error);
      }
    },
    [releaseListening]
  );

  const enableAutoListenForDevice = useCallback(async () => {
    setListenModeSelection('auto');
    setAutoListenEnabled(true);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase('auto-initial');
    setRehearsalMediaStatus('Antes de empezar, vamos a preparar micro y voz.');
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

  useEffect(() => {
    if (!isListeningSupported) {
      setListenModeSelection('manual');
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (listenModeSelection === 'pending') {
      setIsRehearsalMediaReady(false);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(false);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (!autoListenEnabled && rehearsalPreflightPhase !== 'manual-check') {
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (hasCompletedRehearsalPreflight) {
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      return;
    }

    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    if (!rehearsalPreflightPhase) {
      setRehearsalPreflightPhase('auto-initial');
    }
    setRehearsalMediaStatus((previousStatus) => previousStatus ?? 'Antes de empezar, vamos a preparar micro y voz.');
  }, [
    autoListenEnabled,
    hasCompletedRehearsalPreflight,
    isListeningSupported,
    listenModeSelection,
    rehearsalPreflightPhase,
  ]);

  const stopSongAudio = useCallback(() => {
    const player = audioRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
    }

    setPlayingAudioId(null);
    activeAudioPlaybackRef.current = null;
  }, []);

  const disposeSongAudio = useCallback(() => {
    const player = audioRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.removeAttribute('src');
      player.load();
      audioRef.current = null;
    }

    setPlayingAudioId(null);
    activeAudioPlaybackRef.current = null;
  }, []);

  const stopStandaloneSongAudio = useCallback(() => {
    if (activeAudioPlaybackRef.current?.kind === 'song') {
      stopSongAudio();
    }
  }, [stopSongAudio]);

  const getSongAudioPlayer = useCallback(() => {
    if (typeof Audio === 'undefined') {
      return null;
    }

    if (!audioRef.current) {
      const nextPlayer = new Audio();
      nextPlayer.preload = 'auto';
      nextPlayer.crossOrigin = 'anonymous';
      nextPlayer.setAttribute('playsinline', 'true');
      audioRef.current = nextPlayer;
    }

    return audioRef.current;
  }, []);

  const setSongAudioVolume = useCallback((nextVolume: number) => {
    const player = audioRef.current;
    if (!player) {
      return;
    }

    player.volume = Math.max(0, Math.min(nextVolume, 1));
  }, []);

  const primeSongPlayback = useCallback(async () => {
    const player = getSongAudioPlayer();
    if (!player) {
      return false;
    }

    const silentObjectUrl = createSilentWavObjectUrl();
    if (!silentObjectUrl) {
      return false;
    }

    try {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.muted = true;
      player.src = silentObjectUrl;
      player.load();
      await player.play();
      player.pause();
      player.currentTime = 0;
      player.removeAttribute('src');
      player.load();
      player.muted = false;
      setIsSongPlaybackUnlocked(true);
      return true;
    } catch {
      player.muted = false;
      return false;
    } finally {
      URL.revokeObjectURL(silentObjectUrl);
    }
  }, [getSongAudioPlayer]);

  const probeSongPlayback = useCallback(async () => {
    const player = getSongAudioPlayer();
    if (!player) {
      return 'No hay reproductor web para probar las canciones.';
    }

    const toneObjectUrl = createProbeToneObjectUrl();
    if (!toneObjectUrl) {
      return 'No se pudo generar el audio de prueba.';
    }

    const playToneOnce = async (attemptLabel: string) => {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.muted = false;
      player.src = toneObjectUrl;
      player.load();

      try {
        await player.play();
      } catch (error) {
        throw new Error(`${attemptLabel}:${formatPlaybackProbeError(error)}`);
      }

      await new Promise<void>((resolve) => {
        let isResolved = false;

        const finish = () => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          player.onended = null;
          player.onerror = null;
          resolve();
        };

        player.onended = finish;
        player.onerror = finish;
        setTimeout(finish, 900);
      });
    };

    try {
      setSongPlaybackProbeStatus('Prueba de canciones 1/2: reproduciendo el audio con tu aprobacion...');
      await playToneOnce('primer-intento');
      setSongPlaybackProbeStatus('Prueba de canciones 2/2: relanzando el mismo audio automaticamente...');
      await playToneOnce('segundo-intento');
      setIsSongPlaybackUnlocked(true);
      return 'Canciones: la primera y la segunda reproduccion de prueba han arrancado bien.';
    } catch (error) {
      return `Canciones: la segunda reproduccion automatica se ha bloqueado (${error instanceof Error ? error.message : 'error-desconocido'}).`;
    } finally {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(toneObjectUrl);
    }
  }, [getSongAudioPlayer]);

  const goBackLine = useCallback(() => {
    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    setCurrentIndex((previousIndex) => Math.max(0, previousIndex - 1));
  }, [stopStandaloneSongAudio]);

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
  }, [currentMusicalNumberKey, currentSongKey]);

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

    if (shouldKeepListeningWarmDuringSong) {
      return;
    }

    if (isListeningActive) {
      void stopListening();
    }
  }, [
    effectiveAutoListenEnabled,
    isListeningActive,
    listeningStatus,
    shouldKeepListeningWarmDuringSong,
    shouldArmListeningForCurrentLine,
    startListening,
    stopListening,
  ]);

  useEffect(() => {
    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    let isCancelled = false;
    let advanceTimeout: ReturnType<typeof setTimeout> | null = null;
    let speechStartTimeout: ReturnType<typeof setTimeout> | null = null;

    if (isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine) || isMyTurn) {
      return () => {
        stopRehearsalSpeech();
        stopStandaloneSongAudio();
      };
    }

    if (!speakableLineText) {
      advanceTimeout = setTimeout(advanceLine, 200);
      return () => {
        if (advanceTimeout) {
          clearTimeout(advanceTimeout);
        }
        stopRehearsalSpeech();
        stopStandaloneSongAudio();
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
      stopStandaloneSongAudio();
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
    stopStandaloneSongAudio,
  ]);

  useEffect(() => () => {
    disposeSongAudio();
  }, [disposeSongAudio]);

  const handleExit = () => {
    stopRehearsalSpeech();
    disposeSongAudio();
    void releaseListening();
    onExit();
  };

  const currentAudioModeLabel = currentMusicalNumber ? 'numero musical' : 'cancion';
  const shouldShowCurrentAudioOptions = currentRehearsalAudioOptions.length > 0;

  const prepareRehearsalMedia = useCallback(async (phase = rehearsalPreflightPhase ?? 'auto-initial') => {
    const shouldUseAutoListen = phase !== 'manual-check';
    const primeSongPlaybackPromise = primeSongPlayback();
    setIsPreparingRehearsalMedia(true);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setSongPlaybackProbeStatus(null);
    setRehearsalPreflightPhase(phase);
    setAutoListenEnabled(shouldUseAutoListen);
    setTemporarilySuspendingAutoListen(false);

    if (phase === 'manual-check') {
      setRehearsalMediaStatus('Probando la voz con el micro desactivado...');
    } else if (phase === 'auto-final') {
      setRehearsalMediaStatus('Reactivando el micro para una comprobacion final...');
    } else {
      setRehearsalMediaStatus('Abriendo el micro de prueba...');
    }

    try {
      if (shouldUseAutoListen) {
        await startListening();
        await new Promise((resolve) => setTimeout(resolve, 450));
      }

      setRehearsalMediaStatus('Liberando el micro para probar la voz...');
      await stopListening();
      await new Promise((resolve) => setTimeout(resolve, 220));

      setRehearsalMediaStatus('Escucha la frase de prueba de Siri.');

      await new Promise<void>((resolve) => {
        let isResolved = false;

        speakRehearsalSpeech('Prueba de audio lista. Vamos a ensayar.', {
          onStart: () => {
            setRehearsalMediaStatus('Reproduciendo frase de prueba...');
          },
          onDone: () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            resolve();
          },
          onError: () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            resolve();
          },
        });

        setTimeout(() => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          resolve();
        }, 2600);
      });

      await primeSongPlaybackPromise;
      const songProbeResult = await probeSongPlayback();
      setHasPreparedRehearsalMedia(true);
      setSongPlaybackProbeStatus(songProbeResult);
      setRehearsalMediaStatus(
        phase === 'manual-check'
          ? 'Si ahora has oido la frase, volveremos a activar el micro y haremos una comprobacion final.'
          : phase === 'auto-final'
            ? 'Si has oido esta ultima frase, empezaremos el ensayo con micro automatico.'
            : 'Si has oido la frase, ya podemos empezar el ensayo.'
      );
    } catch {
      setRehearsalMediaStatus('No se pudo preparar el micro. Puedes volver a intentarlo.');
    } finally {
      setIsPreparingRehearsalMedia(false);
    }
  }, [primeSongPlayback, probeSongPlayback, rehearsalPreflightPhase, startListening, stopListening]);

  const handlePreflightHeardVoice = useCallback(() => {
    if (rehearsalPreflightPhase === 'manual-check') {
      void prepareRehearsalMedia('auto-final');
      return;
    }

    void primeSongPlayback();
    setIsRehearsalMediaReady(true);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(true);
    setRehearsalPreflightPhase(null);
    setRehearsalMediaStatus(null);
  }, [prepareRehearsalMedia, primeSongPlayback, rehearsalPreflightPhase]);

  const handleChooseAutomaticListen = useCallback(() => {
    void enableAutoListenForDevice();
  }, [enableAutoListenForDevice]);

  const handleChooseManualListen = useCallback(async () => {
    setListenModeSelection('manual');
    setAutoListenEnabled(false);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(true);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(true);
    setRehearsalPreflightPhase(null);
    setRehearsalMediaStatus(null);
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);
    await releaseListening();
  }, [releaseListening]);

  const handlePreflightMissedVoice = useCallback(() => {
    if (rehearsalPreflightPhase === 'auto-initial') {
      void prepareRehearsalMedia('manual-check');
      return;
    }

    if (rehearsalPreflightPhase === 'manual-check') {
      void disableAutoListenForDevice(
        'La voz de prueba no se escuchaba bien con la escucha automatica. Empezamos el ensayo en modo manual.'
      ).then(() => {
        setIsRehearsalMediaReady(true);
        setHasCompletedRehearsalPreflight(true);
        setRehearsalPreflightPhase(null);
      });
      return;
    }

    void disableAutoListenForDevice(
      'La voz solo funcionaba bien sin escucha automatica. Empezamos el ensayo en modo manual.'
    ).then(() => {
      setIsRehearsalMediaReady(true);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
    });
  }, [disableAutoListenForDevice, prepareRehearsalMedia, rehearsalPreflightPhase]);

  const handlePlaySongAudio = useCallback((
    audioUrl: string,
    audioId: string,
    options?: {
      advanceOnEnd?: boolean;
      autoStart?: boolean;
      playbackKind?: 'song' | 'musical-number';
      ownerId?: string | null;
      rememberForMusicalNumberId?: string | null;
    }
  ) => {
    const player = getSongAudioPlayer();
    if (!player) {
      setAudioError('La reproduccion de audio solo esta disponible en la app web.');
      return;
    }

    if (playingAudioId === audioId && !player.paused) {
      stopSongAudio();
      return;
    }

    setAudioError(null);
    setBlockedAutoplayAudio(null);
    stopSongAudio();
    if (options?.rememberForMusicalNumberId) {
      selectedMusicalNumberAudioIdsRef.current[options.rememberForMusicalNumberId] = audioId;
    }

    player.onended = () => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      if (options?.advanceOnEnd) {
        advanceLine();
      }
    };
    player.onerror = () => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      setAudioError('No se pudo reproducir este audio.');
    };

    player.src = audioUrl;
    player.load();
    player.volume = 1;
    setPlayingAudioId(audioId);
    activeAudioPlaybackRef.current = {
      kind: options?.playbackKind ?? 'song',
      ownerId: options?.ownerId ?? null,
    };

    void player.play().catch((error: unknown) => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      if (options?.autoStart && isAutoplayBlockedError(error)) {
        setBlockedAutoplayAudio({
          audioId,
          audioUrl,
          playbackKind: options?.playbackKind,
          ownerId: options?.ownerId ?? null,
          advanceOnEnd: options?.advanceOnEnd,
        });
        setAudioError(
          isSongPlaybackUnlocked
            ? 'Safari ha vuelto a bloquear el audio automatico de esta cancion.'
            : 'Safari o iPhone necesita que actives el audio manualmente para esta cancion.'
        );
        return;
      }

      setAudioError('No se pudo reproducir este audio.');
    });
  }, [
    advanceLine,
    getSongAudioPlayer,
    isAutoplayBlockedError,
    isSongPlaybackUnlocked,
    playingAudioId,
    stopSongAudio,
  ]);

  useEffect(() => {
    if (!currentMusicalNumber) {
      autoStartedMusicalNumberKeyRef.current = null;
      if (activeAudioPlaybackRef.current?.kind === 'musical-number') {
        stopSongAudio();
      }
      return;
    }

    const activePlayback = activeAudioPlaybackRef.current;
    const isCurrentMusicalNumberPlaying =
      activePlayback?.kind === 'musical-number' &&
      activePlayback.ownerId === currentMusicalNumber.id &&
      playingAudioId !== null;

    if (
      activePlayback?.kind === 'musical-number' &&
      activePlayback.ownerId !== currentMusicalNumber.id
    ) {
      stopSongAudio();
    }

    if (!preferredMusicalNumberAudio) {
      return;
    }

    if (isCurrentMusicalNumberPlaying) {
      return;
    }

    if (autoStartedMusicalNumberKeyRef.current === currentMusicalNumberKey) {
      return;
    }

    autoStartedMusicalNumberKeyRef.current = currentMusicalNumberKey;
    handlePlaySongAudio(preferredMusicalNumberAudio.audioUrl, preferredMusicalNumberAudio.id, {
      autoStart: true,
      playbackKind: 'musical-number',
      ownerId: currentMusicalNumber.id,
      rememberForMusicalNumberId: currentMusicalNumber.id,
    });
  }, [
    currentMusicalNumber,
    currentMusicalNumberKey,
    handlePlaySongAudio,
    playingAudioId,
    preferredMusicalNumberAudio,
    stopSongAudio,
  ]);

  useEffect(() => {
    const activePlayback = activeAudioPlaybackRef.current;
    if (
      activePlayback?.kind !== 'musical-number' ||
      activePlayback.ownerId !== currentMusicalNumber?.id
    ) {
      return;
    }

    if (isSongCue(currentLine)) {
      setSongAudioVolume(1);
      return;
    }

    if (isMyTurn) {
      setSongAudioVolume(0.18);
      return;
    }

    setSongAudioVolume(0.34);
  }, [currentLine, currentMusicalNumber?.id, isMyTurn, setSongAudioVolume]);

  useEffect(() => {
    if (!currentSongKey) {
      autoStartedSongKeyRef.current = null;
      return;
    }

    if (currentMusicalNumber) {
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
  }, [currentMusicalNumber, currentSongAsset, currentSongKey, handlePlaySongAudio]);

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <TouchableOpacity onPress={handleExit}>
          <Text style={styles.blue}>Cerrar ensayo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goBackLine} disabled={!canGoBack}>
          <Text style={[styles.backLink, !canGoBack && styles.backLinkDisabled]}>{'<'} Linea anterior</Text>
        </TouchableOpacity>
        {isListeningSupported && listenModeSelection !== 'pending' ? (
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
        {listenModeSelection === 'auto' && autoListenEnabled ? (
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

  if (isListeningSupported && listenModeSelection === 'pending') {
    return (
      <View style={styles.container}>
        {renderHeader('Configurar ensayo')}
        <View style={styles.intro}>
          <View style={styles.preflightCard}>
            <Text style={styles.preflightTitle}>Como quieres ensayar?</Text>
            <Text style={styles.preflightText}>
              Puedes activar el micro para que detectemos cuando terminas tus replicas o empezar sin
              micro y avanzar manualmente.
            </Text>
            <Text style={styles.preflightStatus}>
              Selecciona Ensayar sin micro si todavia no estas confiado con tus frases y necesitas
              leerlas con calma.
            </Text>
            <View style={styles.preflightActions}>
              <TouchableOpacity
                style={[styles.preflightActionButton, styles.preflightConfirmButton]}
                onPress={handleChooseAutomaticListen}
              >
                <Text style={styles.preflightConfirmText}>Usar micro automatico</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.preflightActionButton, styles.preflightManualButton]}
                onPress={() => void handleChooseManualListen()}
              >
                <Text style={styles.preflightManualText}>Ensayar sin micro</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const renderCurrentAudioPanel = () => {
    if (!currentLine || !shouldShowCurrentAudioOptions) {
      return null;
    }

    return (
      <View style={styles.songAudioList}>
        <Text style={styles.songSectionTitle}>
          {currentMusicalNumber ? `Numero musical: ${currentMusicalNumber.title}` : 'Audios disponibles'}
        </Text>
        {currentMusicalNumber ? (
          <Text style={styles.songHint}>
            El audio seguira sonando entre el inicio y el final del numero musical, bajando volumen en el dialogo.
          </Text>
        ) : null}
        {blockedAutoplayAudio ? (
          <View style={styles.songActivationCard}>
            <Text style={styles.songActivationText}>
              Safari ha bloqueado el arranque automatico de este {currentAudioModeLabel}.
            </Text>
            <TouchableOpacity
              style={styles.songActivationButton}
              onPress={() =>
                handlePlaySongAudio(blockedAutoplayAudio.audioUrl, blockedAutoplayAudio.audioId, {
                  advanceOnEnd: blockedAutoplayAudio.advanceOnEnd,
                  playbackKind: blockedAutoplayAudio.playbackKind,
                  ownerId: blockedAutoplayAudio.ownerId,
                  rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
                })
              }
            >
              <Text style={styles.songActivationButtonText}>Activar audio y reproducir</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {currentRehearsalAudioOptions.map((audio) => {
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
                onPress={() =>
                  handlePlaySongAudio(audio.audioUrl, audio.id, {
                    advanceOnEnd: currentMusicalNumber ? false : true,
                    playbackKind: currentMusicalNumber ? 'musical-number' : 'song',
                    ownerId: currentMusicalNumber?.id ?? currentSongAsset?.id ?? null,
                    rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
                  })
                }
              >
                <Text style={styles.songAudioButtonText}>{isPlaying ? 'Detener' : 'Reproducir'}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };
  if (!isRehearsalMediaReady) {
    return (
      <View style={styles.container}>
        {renderHeader('Preparando audio y micro')}
        <View style={styles.intro}>
          <View style={styles.preflightCard}>
            <Text style={styles.preflightTitle}>Preparar ensayo</Text>
            <Text style={styles.preflightText}>
              Vamos a reproducir una frase corta antes de empezar. Si no se oye a la primera, probaremos automaticamente la combinacion auto, manual y auto otra vez.
            </Text>
            {rehearsalMediaStatus ? (
              <Text style={styles.preflightStatus}>{rehearsalMediaStatus}</Text>
            ) : null}
            {songPlaybackProbeStatus ? (
              <Text style={styles.preflightStatusSecondary}>{songPlaybackProbeStatus}</Text>
            ) : null}
            {!hasPreparedRehearsalMedia ? (
              <TouchableOpacity
                style={[styles.btnNext, isPreparingRehearsalMedia && styles.buttonDisabled]}
                onPress={() => void prepareRehearsalMedia()}
                disabled={isPreparingRehearsalMedia}
              >
                <Text style={styles.btnText}>{isPreparingRehearsalMedia ? 'Preparando...' : 'Preparar audio y micro'}</Text>
              </TouchableOpacity>
            ) : null}
            {hasPreparedRehearsalMedia ? (
              <View style={styles.preflightActions}>
                <TouchableOpacity
                  style={[styles.preflightActionButton, styles.preflightConfirmButton]}
                  onPress={handlePreflightHeardVoice}
                >
                  <Text style={styles.preflightConfirmText}>
                    {rehearsalPreflightPhase === 'manual-check'
                      ? 'Ahora si la oigo'
                      : rehearsalPreflightPhase === 'auto-final'
                        ? 'Perfecto, se oye'
                        : 'Si, la oigo'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.preflightActionButton, styles.preflightFallbackButton]}
                  onPress={handlePreflightMissedVoice}
                >
                  <Text style={styles.preflightFallbackText}>
                    {rehearsalPreflightPhase === 'manual-check'
                      ? 'Sigue sin oirse'
                      : rehearsalPreflightPhase === 'auto-final'
                        ? 'No se oye con micro'
                        : 'No la oigo'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

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

            {currentMusicalNumber && shouldShowCurrentAudioOptions ? (
              renderCurrentAudioPanel()
            ) : currentSongAsset?.audios.length ? (
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
                          advanceOnEnd: blockedAutoplayAudio.advanceOnEnd,
                          playbackKind: blockedAutoplayAudio.playbackKind,
                          ownerId: blockedAutoplayAudio.ownerId,
                          rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
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
                        onPress={() =>
                          handlePlaySongAudio(audio.audioUrl, audio.id, {
                            advanceOnEnd: currentMusicalNumber ? false : true,
                            playbackKind: currentMusicalNumber ? 'musical-number' : 'song',
                            ownerId: currentMusicalNumber?.id ?? currentSongAsset?.id ?? null,
                            rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
                          })
                        }
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
              {currentMusicalNumber
                ? 'Este bloque forma parte de un numero musical. Si activas su audio, seguira vivo durante el dialogo intermedio.'
                : currentSongAsset?.audios.length === 1
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
            {currentMusicalNumber ? renderCurrentAudioPanel() : null}
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
  preflightCard: {
    width: '100%',
    maxWidth: 540,
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#f8fbff',
    borderWidth: 1,
    borderColor: '#d7e6f5',
    gap: 16,
  },
  preflightTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    color: '#17324c',
  },
  preflightText: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#47604f',
  },
  preflightStatus: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#1e6091',
    fontWeight: '600',
  },
  preflightStatusSecondary: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#7a4d00',
    fontWeight: '600',
  },
  preflightActions: {
    gap: 10,
    marginTop: 4,
  },
  preflightActionButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  preflightConfirmButton: {
    backgroundColor: 'rgba(43, 147, 72, 0.84)',
    borderColor: 'rgba(43, 147, 72, 0.95)',
  },
  preflightManualButton: {
    backgroundColor: '#f5ede3',
    borderColor: '#e4d1b3',
  },
  preflightFallbackButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#f1c8c8',
  },
  preflightConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },
  preflightFallbackText: {
    color: '#c62828',
    fontWeight: '700',
  },
  preflightManualText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
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
