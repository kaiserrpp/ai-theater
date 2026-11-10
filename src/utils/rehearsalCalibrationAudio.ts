type VoiceOutput = {
  speak: (text: string, callbacks: { onDone: () => void; onError: (error: Error) => void }) => void;
  stop: () => void;
};

export const playCalibrationVoice = (
  text: string,
  output: VoiceOutput,
  timeoutMs = 7000
) => new Promise<void>((resolve, reject) => {
  let finished = false;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (error) {
      output.stop();
      reject(new Error('calibration-voice-unavailable', { cause: error }));
    } else {
      resolve();
    }
  };
  const timeout = setTimeout(() => finish(new Error('speech-timeout')), timeoutMs);
  try {
    // Must execute in the original tap, before requesting microphone access.
    output.speak(text, { onDone: () => finish(), onError: finish });
  } catch (error) {
    finish(error instanceof Error ? error : new Error('speech-error'));
  }
});

export const primeRehearsalAudioPlayer = async (
  player: HTMLAudioElement,
  sourceUrl: string,
  prepareOutput: () => Promise<void>,
  timeoutMs = 5000
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    player.pause();
    player.currentTime = 0;
    player.onended = null;
    player.onerror = null;
    player.muted = false;
    player.src = sourceUrl;
    player.load();
    // Both calls happen inside the tap. Awaiting resume() first loses the
    // gesture in Safari; muted playback does not unlock later audible media.
    const outputReady = prepareOutput();
    const playing = player.play();
    await Promise.race([
      Promise.all([outputReady, playing]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('audio-unlock-timeout')), timeoutMs);
      }),
    ]);
    if (player.src !== sourceUrl) return false;
    player.pause();
    player.currentTime = 0;
    player.removeAttribute('src');
    player.load();
    return true;
  } catch {
    return false;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};

export const playCalibrationBeep = (
  player: HTMLAudioElement,
  sourceUrl: string,
  prepareOutput: () => Promise<void>,
  timeoutMs = 2500
) => new Promise<void>((resolve, reject) => {
  let finished = false;
  const finish = (error?: unknown) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    const ownsPlayer = player.src === sourceUrl;
    if (ownsPlayer) {
      player.onended = null;
      player.onerror = null;
    }
    if (error) {
      if (ownsPlayer) player.pause();
      reject(new Error('calibration-beep-unavailable', { cause: error }));
    } else {
      resolve();
    }
  };
  const timeout = setTimeout(() => finish(new Error('beep-timeout')), timeoutMs);
  try {
    player.pause();
    player.currentTime = 0;
    player.muted = false;
    player.src = sourceUrl;
    player.onended = () => finish();
    player.onerror = () => finish(new Error('beep-playback-error'));
    player.load();
    const outputReady = prepareOutput();
    const playing = player.play();
    void Promise.all([outputReady, playing]).catch(finish);
  } catch (error) {
    finish(error);
  }
});
