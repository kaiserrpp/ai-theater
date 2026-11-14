export interface LevelRecorder {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  getStatus: () => { isRecording: boolean; canRecord: boolean; metering?: number };
  stop: () => Promise<void>;
  release: () => void;
}

// Android MediaRecorder reports a peak amplitude in dBFS, not PCM RMS. Noise
// and voice are measured with this same scale; this never feeds a PCM decoder.
export const peakFromDecibels = (decibels: number) =>
  decibels <= -160 ? 0 : Math.min(1, Math.pow(10, Math.min(0, decibels) / 20));

export const createNativeLevelInput = (deps: {
  createRecorder: () => LevelRecorder;
  deleteRecording: (uri: string) => Promise<void>;
}) => {
  type Capture = { recorder: LevelRecorder; cancelled: boolean; prepared: Promise<void>;
    timer?: ReturnType<typeof setInterval>; stop?: Promise<void> };
  let current: Capture | null = null;
  const close = (capture: Capture): Promise<void> => {
    if (capture.stop) return capture.stop;
    capture.cancelled = true;
    if (capture.timer) clearInterval(capture.timer);
    capture.stop = (async () => {
      await capture.prepared.catch(() => {});
      const uri = capture.recorder.uri;
      try {
        const status = capture.recorder.getStatus();
        if (status.isRecording) await capture.recorder.stop();
      } finally {
        try { capture.recorder.release(); }
        finally {
          try { if (uri) await deps.deleteRecording(uri); }
          finally { if (current === capture) current = null; }
        }
      }
    })();
    return capture.stop;
  };
  return {
    start: async (onLevel: (level: number) => void, onError: (message: string) => void) => {
      if (current) throw new Error('Ya hay una captura de nivel abierta.');
      const recorder = deps.createRecorder();
      const capture: Capture = { recorder, cancelled: false, prepared: Promise.resolve() };
      current = capture;
      capture.prepared = Promise.resolve().then(() => capture.cancelled ? undefined : recorder.prepareToRecordAsync());
      try {
        await capture.prepared;
        if (capture.cancelled) return;
        recorder.record();
        const sample = () => {
          if (capture.cancelled) return;
          const status = recorder.getStatus();
          if (!status.isRecording || typeof status.metering !== 'number' || !Number.isFinite(status.metering)) {
            throw new Error('El grabador nativo no está entregando niveles de audio.');
          }
          onLevel(peakFromDecibels(status.metering));
        };
        sample();
        capture.timer = setInterval(() => {
          try { sample(); }
          catch (cause) {
            if (capture.timer) clearInterval(capture.timer);
            onError(cause instanceof Error ? cause.message : 'Falló la medición de audio nativa.');
          }
        }, 60);
      } catch (cause) {
        await close(capture);
        throw cause;
      }
    },
    stop: () => current ? close(current) : Promise.resolve(),
  };
};
