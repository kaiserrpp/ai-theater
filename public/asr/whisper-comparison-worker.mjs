import { transcribeWhisperAudio } from './whisper-runtime.mjs';

self.onmessage = async ({ data }) => {
  try {
    const result = await transcribeWhisperAudio(data.audio, { language: data.language, context: data.context,
      onProcessing: () => self.postMessage({ type: 'processing' }),
      onProgress: (progress) => self.postMessage({ type: 'progress', file: progress.file,
        progress: progress.progress, status: progress.status }),
    });
    self.postMessage({ type: 'result', ...result });
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || String(error) });
  }
};
