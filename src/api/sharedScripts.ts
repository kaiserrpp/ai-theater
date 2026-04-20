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
  const response = await fetch(
    `${SHARED_SCRIPT_API_URL}?shareId=${encodeURIComponent(shareId)}&ts=${Date.now()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const publishSharedScript = async (input: SharedScriptPublishInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
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
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/list?ts=${Date.now()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptListItem[];
};

export const verifySongAdminPassword = async (password: string) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/song-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as { ok: true };
};

export const registerSharedSongAudio = async (input: SharedSongAudioRegistrationInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/song-audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedSongAudio = async (input: SharedSongAudioUpdateInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/song-audio`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedSongAudio = async (input: SharedSongAudioDeleteInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/song-audio`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const createSharedMusicalNumber = async (input: SharedMusicalNumberCreateInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedMusicalNumber = async (input: SharedMusicalNumberUpdateInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedMusicalNumber = async (input: SharedMusicalNumberDeleteInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
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
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number-audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const updateSharedMusicalNumberAudio = async (input: SharedMusicalNumberAudioUpdateInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number-audio`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};

export const deleteSharedMusicalNumberAudio = async (input: SharedMusicalNumberAudioDeleteInput) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/musical-number-audio`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptManifest;
};
