export interface PlaybackTrack { key: string; audio: { audioUrl: string }; }
export type SongRepeatMode = 'queue' | 'track' | 'off';
export type SongPlaybackMode = 'queue' | 'single';

// Reuse the audio element for every entry, preserving the playback permission
// obtained by the user's tap on iPhone. All async results belong to one cycle.
export const createSongPlayback = <T extends PlaybackTrack>(options: {
  createAudio: () => HTMLAudioElement;
  onTrack: (key: string | null) => void;
  onPlaying: (playing: boolean) => void;
  onPosition: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onQueue: (value: { index: number; total: number }) => void;
  onError: (message: string) => void;
}) => {
  let audio: HTMLAudioElement | null = null;
  let queue: T[] = [];
  let current: T | null = null;
  let repeat: SongRepeatMode = 'queue';
  let mode: SongPlaybackMode = 'queue';
  let rate = 1;
  let cycle = 0;
  const updateQueue = () => options.onQueue({ index: queue.findIndex((track) => track.key === current?.key), total: queue.length });
  const start = (track: T, restart = false) => {
    const token = ++cycle;
    const element = audio || options.createAudio();
    audio = element;
    const changed = current?.key !== track.key || current?.audio.audioUrl !== track.audio.audioUrl;
    current = track;
    options.onError(''); options.onTrack(track.key); updateQueue();
    element.ontimeupdate = () => { if (token === cycle) options.onPosition(element.currentTime); };
    element.onloadedmetadata = element.ondurationchange = () => { if (token === cycle) options.onDuration(Number.isFinite(element.duration) ? element.duration : 0); };
    element.onplay = () => { if (token === cycle) options.onPlaying(true); };
    element.onpause = () => { if (token === cycle) options.onPlaying(false); };
    element.onerror = () => { if (token === cycle) { options.onPlaying(false); options.onError('No se pudo cargar este audio. Vuelve a intentarlo.'); } };
    element.onended = () => {
      if (token !== cycle || !current) return;
      const index = queue.findIndex((entry) => entry.key === current!.key);
      const next = repeat === 'track' || (mode === 'single' && repeat === 'queue') ? current
        : mode === 'single' ? null : queue[index + 1] || (repeat === 'queue' ? queue[0] : null);
      if (next) start(next, true);
      else options.onPlaying(false);
    };
    if (changed) {
      element.pause(); element.src = track.audio.audioUrl;
      options.onPosition(0); options.onDuration(0); element.load();
    } else if (restart || element.ended) {
      element.currentTime = 0; options.onPosition(0);
    }
    element.loop = repeat === 'track' || (mode === 'single' && repeat === 'queue');
    element.preservesPitch = true;
    element.playbackRate = rate;
    void element.play().catch(() => {
      if (token === cycle) { options.onPlaying(false); options.onError('Pulsa reproducir para volver a iniciar el audio.'); }
    });
  };
  const stop = () => {
    ++cycle; audio?.pause(); current = null; queue = [];
    options.onTrack(null); options.onPlaying(false); options.onPosition(0); options.onDuration(0); options.onError(''); updateQueue();
  };
  return {
    play: (track: T, entries: T[], playbackMode: SongPlaybackMode = 'queue') => {
      mode = playbackMode;
      const used = new Set<string>();
      queue = entries.filter((entry) => { if (used.has(entry.key)) return false; used.add(entry.key); return true; });
      if (!queue.some((entry) => entry.key === track.key)) queue.push(track);
      start(track);
    },
    resume: () => { if (current) start(current); },
    navigate: (direction: 'previous' | 'next') => {
      if (!current || queue.length < 2) return;
      const index = queue.findIndex((entry) => entry.key === current!.key);
      const nextIndex = (index + (direction === 'previous' ? -1 : 1) + queue.length) % queue.length;
      start(queue[nextIndex], true);
    },
    pause: () => { audio?.pause(); options.onPlaying(false); },
    stop,
    setRepeat: (value: SongRepeatMode) => { repeat = value; if (audio) audio.loop = value === 'track' || (mode === 'single' && value === 'queue'); },
    setRate: (value: number) => {
      if (!Number.isFinite(value)) return;
      rate = Math.round(Math.max(0.7, Math.min(1, value)) * 100) / 100;
      if (audio) { audio.preservesPitch = true; audio.playbackRate = rate; }
    },
    seek: (seconds: number) => {
      if (!audio) return;
      audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, seconds));
      options.onPosition(audio.currentTime);
    },
    updateTracks: (tracks: T[]) => {
      const lookup = new Map(tracks.map((track) => [track.key, track]));
      queue = queue.flatMap((track) => lookup.has(track.key) ? [lookup.get(track.key)!] : []);
      if (current && !lookup.has(current.key)) stop(); else updateQueue();
    },
    destroy: () => {
      ++cycle;
      if (audio) {
        audio.ontimeupdate = audio.onloadedmetadata = audio.ondurationchange = audio.onplay = audio.onpause = audio.onerror = audio.onended = null;
        audio.pause(); audio = null;
      }
      current = null; queue = [];
    },
  };
};
