import { normalizeSharedAppearance, type SharedWorkAppearance } from '../../shared/workAppearance';
import { backgroundImageDataUrl } from './backgroundImage';
import { buildSharedApiUrl } from './sharedApiUrl';
import { invalidateAdminSession } from '../store/adminSession';
import type { BackgroundPreference } from '../utils/appearance';

const request = async (shareId: string, background?: BackgroundPreference | null, revision?: number): Promise<SharedWorkAppearance> => {
  const method = background === undefined ? 'GET' : background === null ? 'DELETE' : 'POST';
  const dataUrl = background ? await backgroundImageDataUrl(background.uri) : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(buildSharedApiUrl('/api/shared-script', { resource: 'appearance',
      ...(method === 'GET' ? { shareId, ts: Date.now() } : {}) }), {
      method, credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-AI-Theatre-Admin': '1' },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ shareId, revision,
        ...(background ? { background: { name: background.name, average: background.average, accent: background.accent, dataUrl } } : {}) }) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) invalidateAdminSession();
      throw Object.assign(new Error(payload.error || 'No se pudo guardar el fondo compartido.'), { status: response.status });
    }
    return normalizeSharedAppearance(payload);
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('El fondo está tardando demasiado en responder. Comprueba la conexión y vuelve a intentarlo.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchSharedAppearance = (shareId: string) => request(shareId);
export const saveSharedAppearance = (shareId: string, background: BackgroundPreference | null, revision: number) => request(shareId, background, revision);
