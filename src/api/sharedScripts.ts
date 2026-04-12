import { Platform } from 'react-native';
import type {
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

const getCurrentOrigin = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin;
};

export const buildSharedScriptUrl = (shareId: string) => {
  const origin = getCurrentOrigin();
  const path = `/?share=${encodeURIComponent(shareId)}`;
  return origin ? `${origin}${path}` : path;
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

export const copySharedScriptUrl = async (shareId: string) => {
  const shareUrl = buildSharedScriptUrl(shareId);

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      return shareUrl;
    }
  }

  return shareUrl;
};

export const fetchSharedScript = async (shareId: string) => {
  const response = await fetch(`${SHARED_SCRIPT_API_URL}?shareId=${encodeURIComponent(shareId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

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
  const response = await fetch(`${SHARED_SCRIPT_API_URL}/list`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return (await response.json()) as SharedScriptListItem[];
};
