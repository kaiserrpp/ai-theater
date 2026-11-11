import { SAMPLE_RATE, MAX_SAMPLE_SECONDS, resampleAudio } from './comparison-core.mjs';

export const createSampleCapture = ({ getUserMedia, createContext, onLevel = () => {}, onLimit = () => {} }) => {
  let generation = 0, stream = null, context = null, source = null, processor = null, gain = null;
  let chunks = [], sampleCount = 0, rate = SAMPLE_RATE, active = false;
  const release = () => {
    generation++; active = false;
    if (processor) processor.onaudioprocess = null;
    source?.disconnect(); processor?.disconnect(); gain?.disconnect();
    source = processor = gain = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    const previous = context; context = null;
    if (previous) void previous.close().catch(() => {});
  };
  return {
    start: async () => {
      release(); chunks = []; sampleCount = 0;
      const run = generation;
      // Both permission and AudioContext.resume start in the original tap.
      const permission = getUserMedia();
      try {
        context = createContext(); const startingContext = context;
        const resumed = context.resume().then(() => null, (error) => error);
        const granted = await permission;
        if (run !== generation) { granted.getTracks().forEach((track) => track.stop()); return false; }
        stream = granted; const resumeError = await resumed;
        if (resumeError) throw resumeError;
        if (run !== generation) return false;
        rate = startingContext.sampleRate;
        source = startingContext.createMediaStreamSource(stream);
        processor = startingContext.createScriptProcessor(2048, 1, 1);
        gain = startingContext.createGain(); gain.gain.value = 0;
        active = true;
        processor.onaudioprocess = (event) => {
          if (!active || run !== generation) return;
          const input = event.inputBuffer.getChannelData(0);
          const count = Math.min(input.length, MAX_SAMPLE_SECONDS * rate - sampleCount);
          const chunk = input.slice(0, count); chunks.push(chunk); sampleCount += count;
          const rms = Math.sqrt(chunk.reduce((sum, value) => sum + value * value, 0) / Math.max(count, 1));
          onLevel(Math.min(1, rms * 8), sampleCount / rate);
          if (sampleCount >= MAX_SAMPLE_SECONDS * rate) { release(); onLimit(); }
        };
        source.connect(processor); processor.connect(gain); gain.connect(startingContext.destination);
        return true;
      } catch (error) {
        // A synchronous context failure must also release a later permission.
        void permission.then((granted) => { if (granted !== stream) granted.getTracks().forEach((track) => track.stop()); }).catch(() => {});
        if (run === generation) release();
        throw error;
      }
    },
    stop: () => { release(); },
    getSample: () => {
      const raw = new Float32Array(sampleCount); let at = 0;
      chunks.forEach((chunk) => { raw.set(chunk, at); at += chunk.length; });
      return resampleAudio(raw, rate);
    },
  };
};

export const wavBlob = (audio) => {
  const buffer = new ArrayBuffer(44 + audio.length * 2), view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, audio.length * 2, true);
  audio.forEach((value, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, value)) * 32767, true));
  return new Blob([buffer], { type: 'audio/wav' });
};
