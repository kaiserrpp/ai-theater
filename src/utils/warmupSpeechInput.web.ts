import { getSharedVoskModel, getLocalSpeechRecognitionConstructor } from './localSpeechRecognition';
import { createLocalSpeechRecognitionConstructor } from './localSpeechRecognitionSession';
import { createWarmupMicrophoneSession } from './warmupMicrophoneSession';

export const createWarmupSpeechInput = () => {
  if (!getLocalSpeechRecognitionConstructor()) return null;
  const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  const input = createWarmupMicrophoneSession({
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } }),
    createAudioContext: () => new AudioContextConstructor(),
  });
  const Constructor = createLocalSpeechRecognitionConstructor({
    loadModel: getSharedVoskModel,
    getUserMedia: input.acquire,
    createAudioContext: input.getAudioContext,
    // The workout owns this context; individual rests only release their graph.
    releaseAudioContext: () => {},
  });
  return { ...input, Constructor };
};
