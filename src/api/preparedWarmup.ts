import { validateWarmupCatalog } from '../../shared/warmupCatalog';
import type { PreparedWarmupAudio, WarmupCatalog } from '../types/warmup';
import { invalidateAdminSession } from '../store/adminSession';
import { buildSharedApiUrl } from './sharedApiUrl';
import { uploadSharedSongAudio } from './sharedSongUploads';

export const importPreparedWarmup = async (file: File, shareId: string, onProgress: (message: string) => void): Promise<WarmupCatalog> => {
  if (file.size > 50 * 1024 * 1024) throw new Error('El paquete preparado supera los 50 MB. Divide la preparación en paquetes más pequeños.');
  const bundle = JSON.parse(await file.text()) as { catalog: WarmupCatalog; files: Record<string, string> };
  const catalog = bundle.catalog;
  if (!catalog || !Array.isArray(catalog.exercises) || !bundle.files || typeof bundle.files !== 'object') throw new Error('Selecciona el archivo prepared.warmup.json generado con los audios.');
  const takes: PreparedWarmupAudio[] = catalog.exercises.flatMap(exercise => [exercise.explanation, ...Object.values(exercise.piano || {}), ...(exercise.cues || []).map(cue => cue.audio)]);
  const originals = new Map<PreparedWarmupAudio, string>();
  for (const take of takes) {
    if (!take || typeof take.audioUrl !== 'string' || !/^[a-zA-Z0-9-]+\.mp3$/.test(take.audioUrl) || typeof bundle.files[take.audioUrl] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(bundle.files[take.audioUrl])) throw new Error('Falta un audio local válido dentro del paquete preparado.');
    originals.set(take, take.audioUrl);
    take.audioUrl = `https://prepared.invalid/${take.audioUrl}`;
  }
  const invalid = validateWarmupCatalog(catalog);
  if (invalid) throw new Error(invalid);
  const urls = new Map<string, string>();
  const names = [...new Set(originals.values())];
  // Upload through the same authenticated client-token route used by songs.
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    onProgress(`Guardando audio ${index + 1} de ${names.length}…`);
    const bytes = Uint8Array.from(atob(bundle.files[name]), char => char.charCodeAt(0));
    const audioFile = new File([bytes], name, { type: 'audio/mpeg' });
    const uploaded = await uploadSharedSongAudio({ shareId, targetId: catalog.id, targetType: 'warmup', file: audioFile });
    urls.set(name, uploaded.url);
  }
  originals.forEach((name, take) => { take.audioUrl = urls.get(name)!; });
  onProgress('Guardando los ejercicios preparados…');
  const response = await fetch(buildSharedApiUrl('/api/shared-script/warmup-catalog'), {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-AI-Theatre-Admin': '1' }, body: JSON.stringify({ shareId, catalog }),
  });
  if (response.status === 401) invalidateAdminSession();
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'No se pudo guardar el calentamiento.');
  if (validateWarmupCatalog(payload.catalog)) throw new Error('La respuesta del calentamiento está incompleta.');
  // Confirm the public read path before reporting that other devices can use it.
  const read = await fetch(buildSharedApiUrl('/api/shared-script/warmup-catalog', { shareId }), { cache: 'no-store' });
  const saved = await read.json();
  if (!read.ok || saved.catalog?.id !== catalog.id || validateWarmupCatalog(saved.catalog)) throw new Error('Los audios se han subido, pero no se pudo comprobar el catálogo. Reintenta la importación.');
  return saved.catalog;
};
