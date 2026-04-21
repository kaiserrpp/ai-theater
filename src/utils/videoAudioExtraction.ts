type BlobWithMetadata = Blob & { name?: string; type?: string };

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) {
    return 'tamano-desconocido';
  }

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${size} B`;
};

const getFileExtension = (fileName: string | undefined) => {
  if (!fileName) {
    return 'sin-extension';
  }

  const match = /\.([^.]+)$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? 'sin-extension';
};

const buildDiagnosticsLabel = (videoFile: BlobWithMetadata) => {
  const fileName = videoFile.name?.trim() || 'sin-nombre';
  const mimeType = videoFile.type?.trim() || 'mime-desconocido';
  const extension = getFileExtension(videoFile.name);
  const fileSize = formatFileSize(videoFile.size);

  return `Archivo: ${fileName} · extension: ${extension} · MIME: ${mimeType} · tamano: ${fileSize}`;
};

const formatStepError = (step: string, error: unknown, videoFile: BlobWithMetadata) => {
  const errorName =
    error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const errorMessage =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const details = [errorName, errorMessage].filter(Boolean).join(': ') || 'sin-detalle';
  const baseMessage = `Fallo al ${step}. ${buildDiagnosticsLabel(videoFile)} · detalle: ${details}`;

  const mimeType = videoFile.type?.trim().toLowerCase() || '';
  const extension = getFileExtension(videoFile.name);
  const likelyIPhoneVideo = mimeType === 'video/quicktime' || extension === 'mov';

  if (step === 'decodificar el audio del video' && likelyIPhoneVideo) {
    return `${baseMessage}. Pinta a video de iPhone (.mov / QuickTime) que este navegador reproduce pero no consigue decodificar para extraer audio.`;
  }

  return baseMessage;
};

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithWebkitAudioContext;
  return scopedWindow.AudioContext ?? scopedWindow.webkitAudioContext ?? null;
};

const changeFileExtension = (fileName: string, nextExtension: string) => {
  const trimmedName = fileName.trim();
  if (!trimmedName) {
    return `audio-extraido.${nextExtension}`;
  }

  const nextName = trimmedName.replace(/\.[^.]+$/, '');
  return `${nextName}.${nextExtension}`;
};

const encodeAudioBufferToWavBlob = (audioBuffer: AudioBuffer) => {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  const channelData = Array.from({ length: channelCount }, (_, channelIndex) =>
    audioBuffer.getChannelData(channelIndex)
  );

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channelIndex][frameIndex] ?? 0));
      const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(pcmValue), true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
};

const createFileFromBlob = (blob: Blob, fileName: string) => {
  if (typeof File !== 'undefined') {
    return new File([blob], fileName, {
      type: blob.type || 'audio/wav',
      lastModified: Date.now(),
    });
  }

  const blobWithName = blob as BlobWithMetadata;
  blobWithName.name = fileName;
  return blobWithName;
};

export const isVideoAsset = (file: BlobWithMetadata) =>
  typeof file.type === 'string' && file.type.trim().toLowerCase().startsWith('video/');

export const extractAudioFileFromVideo = async (videoFile: BlobWithMetadata) => {
  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error(
      `Este navegador no permite extraer audio de videos automaticamente. ${buildDiagnosticsLabel(
        videoFile
      )}`
    );
  }

  const audioContext = new AudioContextConstructor();

  try {
    let arrayBuffer: ArrayBuffer;

    try {
      arrayBuffer = await videoFile.arrayBuffer();
    } catch (error) {
      throw new Error(formatStepError('leer el video seleccionado', error, videoFile));
    }

    let decodedAudio: AudioBuffer;
    try {
      decodedAudio = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    } catch (error) {
      throw new Error(formatStepError('decodificar el audio del video', error, videoFile));
    }

    const wavBlob = encodeAudioBufferToWavBlob(decodedAudio);
    const nextFileName = changeFileExtension(videoFile.name ?? 'audio-extraido', 'wav');
    return createFileFromBlob(wavBlob, nextFileName);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : `No se pudo extraer el audio del video. ${buildDiagnosticsLabel(videoFile)}`;
    throw new Error(`${message} Prueba con otro video o conviertelo manualmente a audio.`);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
};
