import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSilenceAdvance } from '../hooks/useSilenceAdvance';
import { Dialogue } from '../types/script';
import { SharedSongAsset } from '../types/sharedScript';
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
    startListening,
    stopListening,
  } = useSilenceAdvance({
    enabledForCurrentLine:
      !isFinished &&
      Boolean(currentLine) &&
      !isSceneMarker(currentLine) &&
      !isSongCue(currentLine) &&
      isMyTurn &&
      speakableLineText.length > 0,
    lineKey: currentDialogueKey,
    onSilenceDetected: advanceLine,
  });

  const stopSongAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setPlayingAudioId(null);
  }, []);

  const goBackLine = useCallback(() => {
    Speech.stop();
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
    Speech.stop();
    stopSongAudio();

    if (isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine) || isMyTurn) {
      return () => {
        void Speech.stop();
        stopSongAudio();
      };
    }

    if (!speakableLineText) {
      setTimeout(advanceLine, 200);
      return () => {
        void Speech.stop();
        stopSongAudio();
      };
    }

    Speech.speak(speakableLineText, {
      language: 'es-ES',
      onDone: () => {
        setTimeout(advanceLine, 500);
      },
      onError: () => advanceLine(),
    });

    return () => {
      void Speech.stop();
      stopSongAudio();
    };
  }, [advanceLine, currentLine, isFinished, isMyTurn, speakableLineText, stopSongAudio]);

  useEffect(() => () => {
    stopSongAudio();
  }, [stopSongAudio]);

  const handleExit = () => {
    Speech.stop();
    stopSongAudio();
    stopListening();
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
              if (isListeningActive) {
                stopListening();
                return;
              }

              void startListening();
            }}
          >
            <Text style={[styles.listenLink, isListeningActive && styles.listenLinkActive]}>
              {listeningStatus === 'requesting'
                ? 'Pidiendo micro...'
                : isListeningActive
                  ? 'Escucha activa'
                  : 'Activar escucha'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.headerStatus}>
        <Text style={styles.sceneName}>{title}</Text>
        {isListeningActive ? <Text style={styles.listenStatus}>Autoavance por silencio activo</Text> : null}
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
            {isMyTurn && <Text style={styles.myTurnHint}>Tu turno: lee y pulsa siguiente</Text>}
            {isMyTurn && listeningStatus === 'error' && listeningError ? (
              <Text style={styles.listenError}>{listeningError}</Text>
            ) : null}
            {isMyTurn && isListeningSupported && !isListeningActive ? (
              <Text style={styles.listenHint}>
                Activa la escucha una vez para que la app avance sola tras 1 segundo de silencio.
              </Text>
            ) : null}
            {isMyTurn && isListeningActive ? (
              <Text style={styles.listenHint}>
                La escucha esta activa: cuando termines y guardes silencio, pasaremos a la siguiente linea.
              </Text>
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
  },
  blue: { color: '#007AFF', fontWeight: 'bold' },
  backLink: { color: '#007AFF', fontWeight: '600' },
  backLinkDisabled: { color: '#9fb9d3' },
  listenLink: { color: '#8a5a00', fontWeight: '700' },
  listenLinkActive: { color: '#2b9348' },
  sceneName: { fontSize: 12, color: '#666' },
  listenStatus: { fontSize: 12, color: '#2b9348', fontWeight: '600' },
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
  footer: { backgroundColor: '#007AFF', padding: 25, alignItems: 'center' },
  footerActive: { backgroundColor: 'red' },
  songFooter: { backgroundColor: '#d98a00' },
  btnNext: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  btnBack: { backgroundColor: '#333', padding: 15, borderRadius: 10, marginTop: 20 },
});
