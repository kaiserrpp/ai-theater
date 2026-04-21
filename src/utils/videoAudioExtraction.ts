type BlobWithMetadata = Blob & { name?: string; type?: string };

type WindowWithWebkitAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
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
    throw new Error('Este navegador no permite extraer audio de videos automaticamente.');
  }

  const audioContext = new AudioContextConstructor();

  try {
    const arrayBuffer = await videoFile.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const wavBlob = encodeAudioBufferToWavBlob(decodedAudio);
    const nextFileName = changeFileExtension(videoFile.name ?? 'audio-extraido', 'wav');
    return createFileFromBlob(wavBlob, nextFileName);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'No se pudo extraer el audio del video.';
    throw new Error(`${message} Prueba con otro video o conviertelo manualmente a audio.`);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
};
