import type { PreparedWarmupAudio, WarmupTrack } from '../types/warmup';

type DecodedPiano = { samples: Float32Array; sampleRate: number };
type PreparationIO = {
  read: (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
  decode: (bytes: ArrayBuffer) => Promise<DecodedPiano>;
  createUrl: (bytes: ArrayBuffer, type: string) => string;
  revokeUrl: (url: string) => void;
};

// Preserve every frame and beat. Tiny edge ramps remove discontinuities without
// inserting silence or shortening the musical intervals between patterns.
export const joinPreparedPiano = (clips: DecodedPiano[]): ArrayBuffer => {
  const rate = clips[0]?.sampleRate;
  if (!rate || clips.some(clip => clip.sampleRate !== rate || !clip.samples.length)) throw new Error('Piano incompatible.');
  const frames = clips.reduce((sum, clip) => sum + clip.samples.length, 0);
  if (frames > rate * 120) throw new Error('El tramo de piano es demasiado largo.');
  const bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes);
  const word = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, frames * 2, true);
  let cursor = 44;
  for (const { samples } of clips) {
    const ramp = Math.min(Math.round(rate * .004), Math.floor(samples.length / 2));
    for (let index = 0; index < samples.length; index++) {
      const gain = ramp ? Math.min(1, index / ramp, (samples.length - 1 - index) / ramp) : 1;
      const value = Math.max(-1, Math.min(1, samples[index] * gain));
      view.setInt16(cursor, Math.round(value * (value < 0 ? 32768 : 32767)), true); cursor += 2;
    }
  }
  return bytes;
};

const browserIO = (): PreparationIO => {
  let decoder: OfflineAudioContext | null = null;
  return {
    read: async (url, signal) => { const response = await fetch(url, { signal, cache: 'force-cache' }); if (!response.ok) throw new Error('No se pudo cargar el piano.'); return response.arrayBuffer(); },
    decode: async bytes => {
      const Constructor = window.OfflineAudioContext || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Constructor) throw new Error('offline-decoder-unavailable');
      decoder ??= new Constructor(1, 1, 44100);
      // Decoding only: no output graph, running audio device or microphone.
      const buffer = await decoder.decodeAudioData(bytes.slice(0));
      const samples = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index++) samples[index] += source[index] / buffer.numberOfChannels;
      }
      return { samples, sampleRate: buffer.sampleRate };
    },
    createUrl: (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })),
    revokeUrl: url => URL.revokeObjectURL(url),
  };
};

// Assemble already rendered recordings once for the selected plan. HTMLAudio
// still owns playback, seeking, pausing and the permission obtained by the tap.
export const createWarmupPianoPreparation = (io = browserIO()) => {
  let generation = 0;
  let cached: { key: string; tracks: WarmupTrack[]; urls: string[] } | null = null;
  const clear = () => { generation++; cached?.urls.forEach(io.revokeUrl); cached = null; };
  const prepare = async (tracks: WarmupTrack[], signal?: AbortSignal): Promise<WarmupTrack[]> => {
    const key = JSON.stringify(tracks);
    if (cached?.key === key) return cached.tracks;
    const version = ++generation, urls: string[] = [];
    const check = () => { if (signal?.aborted || version !== generation) throw new Error('warmup-preparation-cancelled'); };
    const raw = new Map<string, ArrayBuffer>(), decoded = new Map<string, DecodedPiano | null>();
    const files = [...new Map(tracks.map(track => [track.audio.audioUrl, track])).values()];
    let cursor = 0;
    const blob = (data: ArrayBuffer, type: string) => { check(); const url = io.createUrl(data, type); urls.push(url); return url; };
    try {
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
        while (cursor < files.length) {
          const track = files[cursor++]; check();
          const bytes = await io.read(track.audio.audioUrl, signal); check(); raw.set(track.audio.audioUrl, bytes);
          if (track.phase === 'piano' && track.audio.pcmFrames && track.audio.pcmSampleRate) {
            try {
              const clip = await io.decode(bytes); check();
              const expected = Math.round(track.audio.pcmFrames * clip.sampleRate / track.audio.pcmSampleRate);
              decoded.set(track.audio.audioUrl, Math.abs(clip.samples.length - expected) <= 2 ? clip : null);
            } catch { check(); decoded.set(track.audio.audioUrl, null); }
          }
        }
      }));
      check(); const result: WarmupTrack[] = [], originalUrls = new Map<string, string>();
      const buffered = (audio: PreparedWarmupAudio) => {
        let url = originalUrls.get(audio.audioUrl);
        if (!url) { url = blob(raw.get(audio.audioUrl)!, 'audio/mpeg'); originalUrls.set(audio.audioUrl, url); }
        return { ...audio, audioUrl: url };
      };
      for (let index = 0; index < tracks.length;) {
        const first = tracks[index];
        if (first.phase !== 'piano') { result.push({ ...first, audio: buffered(first.audio) }); index++; continue; }
        const run: WarmupTrack[] = []; let seconds = 0;
        while (index < tracks.length && tracks[index].phase === 'piano' && seconds + tracks[index].audio.durationSeconds <= 119) {
          seconds += tracks[index].audio.durationSeconds; run.push(tracks[index++]);
        }
        if (!run.length) { result.push({ ...first, audio: buffered(first.audio) }); index++; continue; }
        const clips = run.map(track => decoded.get(track.audio.audioUrl));
        // Older catalogues/unsupported decoders retain the existing MP3 path,
        // with files already buffered so a network request cannot cut a scale.
        if (clips.some(clip => !clip)) { run.forEach(track => result.push({ ...track, audio: buffered(track.audio) })); continue; }
        const piano = clips as DecodedPiano[], wav = joinPreparedPiano(piano);
        result.push({ ...first, key: `${first.key}:continuous:${run.at(-1)!.key}`, title: `${first.title.split(' · ').slice(0, -1).join(' · ')} · Piano continuo`,
          audio: { audioUrl: blob(wav, 'audio/wav'), durationSeconds: piano.reduce((sum, clip) => sum + clip.samples.length / clip.sampleRate, 0) } });
      }
      check(); cached?.urls.forEach(io.revokeUrl); cached = { key, tracks: result, urls }; return result;
    } catch (error) { urls.forEach(io.revokeUrl); throw error; }
  };
  return { prepare, clear };
};
