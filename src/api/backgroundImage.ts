import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { averageFromBlurhash, type BackgroundPreference } from '../utils/appearance';

export const prepareBackgroundImage = async (asset: DocumentPickerAsset): Promise<BackgroundPreference> => {
  if (!FileSystem.documentDirectory) throw new Error('No se puede guardar una imagen en este dispositivo.');
  const extension = asset.name.split('.').pop()?.toLowerCase();
  if (!extension || !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) throw new Error('Elige una imagen JPG, PNG o WebP.');
  if ((asset.size ?? 0) > 20 * 1024 * 1024) throw new Error('Elige una imagen de menos de 20 MB.');
  const thumbnail = await Image.loadAsync(asset.uri, { maxWidth: 128, maxHeight: 128 });
  let hash: string | null;
  try { hash = await Image.generateBlurhashAsync(thumbnail, [1, 1]); }
  finally { thumbnail.release(); }
  if (!hash) throw new Error('No se pudo analizar la imagen. Prueba con otra foto.');
  const uri = `${FileSystem.documentDirectory}theatre-background-${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: uri });
  return { uri, name: asset.name, average: averageFromBlurhash(hash) };
};

export const discardBackgroundImage = async (uri: string) => {
  if (FileSystem.documentDirectory && uri.startsWith(`${FileSystem.documentDirectory}theatre-background-`)) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
};

export const backgroundImageDataUrl = async (uri: string): Promise<string> => {
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(uri)) return uri;
  const file = await FileSystem.getInfoAsync(uri);
  if (!file.exists || file.isDirectory || file.size > 3 * 1024 * 1024) {
    throw new Error('Elige una imagen de menos de 3 MB para compartirla.');
  }
  const extension = uri.split('.').pop()?.toLowerCase();
  const kind = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension;
  if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') throw new Error('Elige una imagen JPG, PNG o WebP.');
  return `data:image/${kind};base64,${await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })}`;
};
