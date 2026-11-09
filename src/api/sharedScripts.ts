import type {
  MusicalAuditionDetailsInput,
  SharedAuditionSceneInput,
  SharedMusicalNumberAudioDeleteInput,
  SharedMusicalNumberAudioRegistrationInput,
  SharedMusicalNumberAudioUpdateInput,
  SharedMusicalNumberCreateInput,
  SharedMusicalNumberDeleteInput,
  SharedMusicalNumberUpdateInput,
  SharedSongAudioDeleteInput,
  SharedSongAudioRegistrationInput,
  SharedSongAudioUpdateInput,
  IntelligentLineFeedbackSessionInput,
  SharedScriptListItem,
  SharedScriptManifest,
  SharedScriptPublishInput,
} from '../types/sharedScript';

import { buildSharedApiUrl } from './sharedApiUrl';
import { invalidateAdminSession } from '../store/adminSession';

const buildProtectedApiUrl = (path = '', searchParams?: Record<string, string | number | null | undefined>) =>
  buildSharedApiUrl(`/api/shared-script${path}`, searchParams);

const parseErrorMessage = async (response: Response) => {
  if (response.status === 401) { invalidateAdminSession(); return 'El acceso de administración ha caducado. Introduce la clave para continuar.'; }
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `Error ${response.status}`;
  } catch {
    return `Error ${response.status}`;
  }
};

export const getSharedScriptIdFromUrl = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get('share');
};

export const replaceSharedScriptIdInUrl = (shareId: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  const nextUrl = new URL(window.location.href);

  if (shareId) {
    nextUrl.searchParams.set('share', shareId);
  } else {
    nextUrl.searchParams.delete('share');
  }

  window.history.replaceState({}, '', nextUrl.toString());
};

export const fetchSharedScript = async (shareId: string) => {
  const response = await fetch(buildProtectedApiUrl('', { shareId, ts: Date.now() }), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const publishSharedScript = async (input: SharedScriptPublishInput) => {
  const response = await fetch(buildProtectedApiUrl('/publish'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as {
    manifest: SharedScriptManifest;
    shareUrl: string;
  };
};

export const fetchSharedScriptList = async () => {
  const response = await fetch(buildProtectedApiUrl('/list', { ts: Date.now() }), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptListItem[];
};

export const saveSharedAuditionScene = async (input: SharedAuditionSceneInput) => {
  const response = await fetch(buildProtectedApiUrl('/audition-scene'), {
    method: input.sceneId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedAuditionScene = async (input: { shareId: string; sceneId: string; revision: number; password?: string }) => {
  const response = await fetch(buildProtectedApiUrl('/audition-scene'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return (await response.json()) as SharedScriptManifest;
};

const mutateMusicalAudition = async (method: string, input: object) => {
  const response = await fetch(buildProtectedApiUrl('/audition-scene', { auditionType: 'music' }), {
    method, credentials: 'include', headers: { 'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response));
  return (await response.json()) as SharedScriptManifest;
};
export const saveMusicalAudition = (input: MusicalAuditionDetailsInput) =>
  mutateMusicalAudition(input.revision == null ? 'POST' : 'PATCH', input);
export const saveMusicalAuditionAudio = (input: { shareId: string; password?: string; auditionId: string; revision: number; kind: 'vocal_guide' | 'karaoke'; audio: {
  audioUrl: string; audioFileName: string | null; contentType: string | null; size: number | null;
} }) => mutateMusicalAudition('PATCH', { ...input, operation: 'audio' });
export const removeMusicalAuditionAudio = (input: { shareId: string; password?: string; auditionId: string; revision: number; kind: 'vocal_guide' | 'karaoke' }) =>
  mutateMusicalAudition('PATCH', { ...input, operation: 'remove-audio' });
export const deleteMusicalAudition = (input: { shareId: string; password?: string; auditionId: string; revision: number }) =>
  mutateMusicalAudition('DELETE', input);

export const registerSharedSongAudio = async (input: SharedSongAudioRegistrationInput) => {
  const response = await fetch(buildProtectedApiUrl('/song-audio'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedSongAudio = async (input: SharedSongAudioUpdateInput) => {
  const response = await fetch(buildProtectedApiUrl('/song-audio'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedSongAudio = async (input: SharedSongAudioDeleteInput) => {
  const response = await fetch(buildProtectedApiUrl('/song-audio'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const createSharedMusicalNumber = async (input: SharedMusicalNumberCreateInput) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedMusicalNumber = async (input: SharedMusicalNumberUpdateInput) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedMusicalNumber = async (input: SharedMusicalNumberDeleteInput) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const registerSharedMusicalNumberAudio = async (
  input: SharedMusicalNumberAudioRegistrationInput
) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number-audio'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedMusicalNumberAudio = async (input: SharedMusicalNumberAudioUpdateInput) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number-audio'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedMusicalNumberAudio = async (input: SharedMusicalNumberAudioDeleteInput) => {
  const response = await fetch(buildProtectedApiUrl('/musical-number-audio'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const submitIntelligentLineFeedback = async (
  input: IntelligentLineFeedbackSessionInput
) => {
  const response = await fetch(buildProtectedApiUrl('/intelligent-feedback'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Theatre-Admin': '1',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as { ok: true; url: string; entryCount: number };
};
