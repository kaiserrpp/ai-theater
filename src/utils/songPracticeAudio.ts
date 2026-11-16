import { primeRehearsalAudioPlayer } from './rehearsalCalibrationAudio';

// A silent PCM WAV unlocks the shared media element inside the original tap.
// The existing primer checks source ownership before any asynchronous cleanup.
export const primeSongPracticeAudio = (audio: HTMLAudioElement) => {
  const sampleRate = 16000, dataBytes = 3840;
  const bytes = new Uint8Array(44 + dataBytes), view = new DataView(bytes.buffer);
  const word = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE');
  word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, dataBytes, true);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  void primeRehearsalAudioPlayer(audio, url, async () => {}).finally(() => URL.revokeObjectURL(url));
};
