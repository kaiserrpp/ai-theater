const { del, put } = require('@vercel/blob');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  parseJsonBody,
  getStorageNamespace,
} = require('./_shared');

const execFileAsync = promisify(execFile);

const sanitizeFileName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const ensureConfigured = (response) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return false;
  }

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return false;
  }

  if (!ffmpegPath) {
    response.status(500).json({ error: 'Falta configurar ffmpeg en el servidor.' });
    return false;
  }

  return true;
};

const resolveInputExtension = ({ sourceFileName, sourceContentType, sourcePathname }) => {
  const fileNameCandidate =
    typeof sourceFileName === 'string' && sourceFileName.trim()
      ? sourceFileName.trim()
      : typeof sourcePathname === 'string' && sourcePathname.trim()
        ? sourcePathname.trim().split('/').pop() || ''
        : '';
  const fileNameMatch = /\.([a-zA-Z0-9]+)$/.exec(fileNameCandidate);
  if (fileNameMatch?.[1]) {
    return `.${fileNameMatch[1].toLowerCase()}`;
  }

  const normalizedContentType =
    typeof sourceContentType === 'string' ? sourceContentType.trim().toLowerCase() : '';
  if (normalizedContentType === 'video/quicktime') {
    return '.mov';
  }

  if (normalizedContentType === 'video/mp4') {
    return '.mp4';
  }

  return '.bin';
};

const cleanupFile = async (filePath) => {
  if (!filePath) {
    return;
  }

  await fs.unlink(filePath).catch(() => undefined);
};

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!ensureConfigured(response)) {
    return;
  }

  let tempInputPath = null;
  let tempOutputPath = null;

  try {
    const payload = parseJsonBody(request);
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!isValidSongAdminPassword(password)) {
      response.status(401).json({ error: 'Password incorrecta.' });
      return;
    }

    const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
    const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';
    const targetType = payload.targetType === 'musical-number' ? 'musical-number' : 'song';
    const sourceUrl = typeof payload.sourceUrl === 'string' ? payload.sourceUrl.trim() : '';
    const sourcePathname =
      typeof payload.sourcePathname === 'string' ? payload.sourcePathname.trim() : '';
    const sourceFileName =
      typeof payload.sourceFileName === 'string' ? payload.sourceFileName.trim() : '';
    const sourceContentType =
      typeof payload.sourceContentType === 'string' ? payload.sourceContentType.trim() : '';

    if (!shareId || !targetId || !sourceUrl) {
      response.status(400).json({ error: 'Faltan datos para convertir el video a audio.' });
      return;
    }

    const videoResponse = await fetch(sourceUrl, { cache: 'no-store' });
    if (!videoResponse.ok) {
      response
        .status(400)
        .json({ error: `No se pudo descargar el video origen. Error ${videoResponse.status}.` });
      return;
    }

    const inputBuffer = Buffer.from(await videoResponse.arrayBuffer());
    if (!inputBuffer.length) {
      response.status(400).json({ error: 'El video origen esta vacio.' });
      return;
    }

    const uniqueBase = `teatroia-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    tempInputPath = path.join(
      os.tmpdir(),
      `${uniqueBase}${resolveInputExtension({
        sourceFileName,
        sourceContentType,
        sourcePathname,
      })}`
    );
    tempOutputPath = path.join(os.tmpdir(), `${uniqueBase}.mp3`);

    await fs.writeFile(tempInputPath, inputBuffer);

    try {
      await execFileAsync(
        ffmpegPath,
        ['-y', '-i', tempInputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', tempOutputPath],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (error) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      const stdout =
        error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const details = stderr.trim() || stdout.trim() || 'ffmpeg no pudo convertir el video.';
      response.status(500).json({
        error: `No se pudo convertir el video a audio en servidor. ${details}`,
      });
      return;
    }

    const outputBuffer = await fs.readFile(tempOutputPath);
    const sourceBaseName =
      typeof sourceFileName === 'string' && sourceFileName.trim()
        ? sourceFileName.trim().replace(/\.[^.]+$/, '')
        : 'audio-extraido';
    const safeBaseName =
      sanitizeFileName(sourceBaseName) || `audio-extraido-${Date.now()}`;
    const extractedFileName = `${safeBaseName}.mp3`;
    const targetFolder = targetType === 'musical-number' ? 'musical-numbers' : 'songs';
    const pathname = `shared-scripts/${getStorageNamespace()}/${shareId}/${targetFolder}/${targetId}/${Date.now()}-${extractedFileName}`;

    const blob = await put(pathname, outputBuffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'audio/mpeg',
    });

    if (sourcePathname) {
      await del(sourcePathname).catch(() => undefined);
    }

    response.status(200).json({
      url: blob.url,
      pathname: blob.pathname,
      fileName: extractedFileName,
      contentType: 'audio/mpeg',
      size: outputBuffer.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudo convertir el video a audio.';
    response.status(500).json({ error: message });
  } finally {
    await cleanupFile(tempInputPath);
    await cleanupFile(tempOutputPath);
  }
};
