type Dependencies = {
  getUserMedia: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
};

export const usesWarmupMicrophoneSession = (device: { userAgent?: string; platform?: string; maxTouchPoints?: number } | null, nativeHost: boolean) =>
  !nativeHost && Boolean(device && (/iPhone|iPad|iPod/i.test(device.userAgent || '') ||
    (device.platform === 'MacIntel' && (device.maxTouchPoints || 0) > 1)));

// Keep the permission and unlocked context for this workout, not for the app.
// The root track is always disabled. Each rest owns a separate enabled clone,
// so aborting an old recognizer cannot stop a later rest's input.
export const createWarmupMicrophoneSession = (dependencies: Dependencies) => {
  let epoch = 0;
  let root: MediaStream | null = null;
  let pending: Promise<MediaStream> | null = null;
  let context: AudioContext | null = null;
  let failure: unknown = null;
  const leases = new Set<MediaStream>();
  const stop = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());
  const cancelled = () => new Error('La preparación del micrófono se ha cancelado.');
  const live = () => root?.getAudioTracks().some(track => track.readyState === 'live');

  const prepare = (retry = false): Promise<void> => {
    if (retry) failure = null;
    if (failure) return Promise.reject(failure);
    const version = epoch;
    try {
      context ??= dependencies.createAudioContext();
      // Called synchronously from the start/retry tap, before model downloads.
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
      if (!live() && !pending) {
        pending = dependencies.getUserMedia().then(stream => {
          stream.getTracks().forEach(track => { track.enabled = false; });
          if (epoch !== version) { stop(stream); throw cancelled(); }
          root = stream; pending = null;
          return stream;
        });
      }
      const capture = live() ? Promise.resolve(root!) : pending!;
      return Promise.all([capture, resumed]).then(() => {
        if (epoch !== version) throw cancelled();
      }).catch(error => {
        if (epoch === version) { failure = error; pending = null; }
        throw error;
      });
    } catch (error) {
      failure = error;
      return Promise.reject(error);
    }
  };
  const acquire = async () => {
    const version = epoch;
    await prepare();
    if (epoch !== version || !live()) throw cancelled();
    // Remove ended leases without keeping an ever-growing list of rests.
    for (const stream of leases) if (stream.getTracks().every(track => track.readyState === 'ended')) leases.delete(stream);
    const stream = root!.clone();
    stream.getTracks().forEach(track => { track.enabled = true; });
    leases.add(stream);
    return stream;
  };
  const release = () => {
    epoch++;
    if (root) stop(root);
    root = null; pending = null; failure = null;
    for (const stream of leases) stop(stream);
    leases.clear();
    const previous = context; context = null;
    if (previous) void previous.close().catch(() => undefined);
  };
  return { prepare, acquire, release, getAudioContext: () => {
    if (!context || context.state === 'closed') throw cancelled();
    return context;
  } };
};
