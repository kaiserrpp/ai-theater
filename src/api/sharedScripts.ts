import type {
  SharedMusicalNumberAudioDeleteInput,
  SharedMusicalNumberAudioRegistrationInput,
  SharedMusicalNumberAudioUpdateInput,
  SharedMusicalNumberCreateInput,
  SharedMusicalNumberDeleteInput,
  SharedMusicalNumberUpdateInput,
  SharedSongAudioDeleteInput,
  SharedSongAudioRegistrationInput,
  SharedSongAudioUpdateInput,
  SharedScriptListItem,
  SharedScriptManifest,
  SharedScriptPublishInput,
} from '../types/sharedScript';

const SHARED_SCRIPT_API_URL = '/api/shared-script';

const buildProtectedApiUrl = (
  path = '',
  searchParams?: Record<string, string | number | null | undefined>
) => {
  const baseUrl =
    typeof window !== 'undefined'
      ? new URL(`${SHARED_SCRIPT_API_URL}${path}`, window.location.origin)
      : new URL(`http://localhost${SHARED_SCRIPT_API_URL}${path}`);

  if (typeof window !== 'undefined') {
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach((value, key) => {
      if (!baseUrl.searchParams.has(key)) {
        baseUrl.searchParams.append(key, value);
      }
    });
  }

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') {
        return;
      }

      baseUrl.searchParams.set(key, String(value));
    });
  }

  return typeof window !== 'undefined'
    ? `${baseUrl.pathname}${baseUrl.search}`
    : `${SHARED_SCRIPT_API_URL}${path}${baseUrl.search}`;
};

const parseErrorMessage = async (response: Response) => {
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

export const verifySongAdminPassword = async (password: string) => {
  const response = await fetch(buildProtectedApiUrl('/song-auth'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as { ok: true };
};

export const registerSharedSongAudio = async (input: SharedSongAudioRegistrationInput) => {
  const response = await fetch(buildProtectedApiUrl('/song-audio'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
