const BLOB_API_URL = 'https://vercel.com/api/blob';
const BLOB_API_VERSION = '12';

export interface SharedSongUploadResult {
  url: string;
  pathname: string;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
}

interface UploadSharedSongAudioInput {
  shareId: string;
  songId: string;
  file: Blob;
  password: string;
  onUploadProgress?: (percentage: number) => void;
}

interface UploadTokenResponse {
  clientToken: string;
}

interface BlobUploadResponse {
  url: string;
  pathname: string;
  contentType: string;
}

const sanitizeFileName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const fetchClientToken = async ({
  pathname,
  password,
  shareId,
  songId,
}: {
  pathname: string;
  password: string;
  shareId: string;
  songId: string;
}) => {
  const response = await fetch('/api/shared-script/song-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-song-admin-password': password,
    },
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        clientPayload: JSON.stringify({ shareId, songId }),
        multipart: false,
      },
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || 'No se pudo preparar la subida del audio.');
  }

  return (await response.json()) as UploadTokenResponse;
};

const uploadBlobWithClientToken = ({
  pathname,
  file,
  clientToken,
  contentType,
  onUploadProgress,
}: {
  pathname: string;
  file: Blob;
  clientToken: string;
  contentType?: string;
  onUploadProgress?: (percentage: number) => void;
}) =>
  new Promise<BlobUploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('PUT', `${BLOB_API_URL}/?pathname=${encodeURIComponent(pathname)}`);
    xhr.responseType = 'json';
    xhr.setRequestHeader('authorization', `Bearer ${clientToken}`);
    xhr.setRequestHeader('x-api-version', BLOB_API_VERSION);
    xhr.setRequestHeader('x-vercel-blob-access', 'public');
    xhr.setRequestHeader('x-content-length', String(file.size));

    if (contentType) {
      xhr.setRequestHeader('x-content-type', contentType);
    }

    if (onUploadProgress) {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }

        onUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
    }

    xhr.onerror = () => reject(new Error('No se pudo subir el audio al almacenamiento.'));
    xhr.onabort = () => reject(new Error('La subida del audio se ha cancelado.'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        const responseText = typeof xhr.responseText === 'string' ? xhr.responseText : '';
        reject(new Error(responseText || `Error ${xhr.status} al subir el audio.`));
        return;
      }

      const payload = xhr.response as BlobUploadResponse | null;
      if (!payload?.url || !payload.pathname) {
        reject(new Error('La respuesta de Blob no incluye el audio subido.'));
        return;
      }

      onUploadProgress?.(100);
      resolve(payload);
    };

    xhr.send(file);
  });

export const uploadSharedSongAudio = async ({
  shareId,
  songId,
  file,
  password,
  onUploadProgress,
}: UploadSharedSongAudioInput): Promise<SharedSongUploadResult> => {
  const namedFile = file as Blob & { name?: string; type?: string; size?: number };
  const originalFileName =
    typeof namedFile.name === 'string' && namedFile.name.trim().length > 0
      ? namedFile.name
      : `audio-${Date.now()}.mp3`;
  const safeFileName = sanitizeFileName(originalFileName) || `audio-${Date.now()}.mp3`;
  const pathname = `shared-scripts/${shareId}/songs/${songId}/${Date.now()}-${safeFileName}`;
  const contentType =
    typeof namedFile.type === 'string' && namedFile.type.trim().length > 0
      ? namedFile.type
      : undefined;
  const fileSize = typeof namedFile.size === 'number' ? namedFile.size : null;

  const { clientToken } = await fetchClientToken({
    pathname,
    password,
    shareId,
    songId,
  });

  const blob = await uploadBlobWithClientToken({
    pathname,
    file,
    clientToken,
    contentType,
    onUploadProgress,
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
    fileName: originalFileName,
    contentType: blob.contentType ?? contentType ?? null,
    size: fileSize,
  };
};
