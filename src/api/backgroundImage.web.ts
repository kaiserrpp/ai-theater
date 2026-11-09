import type { DocumentPickerAsset } from 'expo-document-picker';
import type { BackgroundPreference, RGB } from '../utils/appearance';

export const prepareBackgroundImage = async (asset: DocumentPickerAsset): Promise<BackgroundPreference> => {
  const file = asset.file;
  const objectUrl = asset.uri.startsWith('blob:') ? asset.uri : file ? URL.createObjectURL(file) : null;
  try {
    if (!file || !objectUrl || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elige una imagen JPG, PNG o WebP.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Elige una imagen de menos de 20 MB.');
    const image = new window.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo abrir la imagen. Prueba con otra foto.'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la imagen.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const uri = canvas.toDataURL('image/jpeg', 0.78);
    // Sample a small thumbnail; the full photograph never needs a pixel-by-pixel JS scan.
    const sample = document.createElement('canvas');
    sample.width = 32; sample.height = 32;
    const sampleContext = sample.getContext('2d');
    if (!sampleContext) throw new Error('No se pudo analizar la imagen.');
    sampleContext.drawImage(canvas, 0, 0, 32, 32);
    const pixels = sampleContext.getImageData(0, 0, 32, 32).data;
    const average: RGB = [0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
      average[0] += pixels[index]; average[1] += pixels[index + 1]; average[2] += pixels[index + 2];
    }
    return { uri, name: asset.name, average: average.map((channel) => Math.round(channel / 1024)) as RGB };
  } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
};

export const discardBackgroundImage = async (_uri: string) => {};
