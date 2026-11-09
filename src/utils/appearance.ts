export type RGB = [number, number, number];
export type BackgroundPreference = { uri: string; name: string; average: RGB };

export const defaultPalette = {
  bg: '#faf9f7', surface: '#ffffff', ink: '#20232c', sub: '#606572', rule: '#e4e3e7',
  plum: '#713d59', soft: '#f2eaf0', green: '#2d6a50', button: '#713d59',
  onButton: '#ffffff', chip: '#eeedf0', error: '#a32330', overlay: 'transparent',
};
export type PracticePalette = typeof defaultPalette;

export const relativeLuminance = (rgb: RGB) => rgb.reduce((sum, value, index) => {
  const channel = value / 255;
  return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
}, 0);
export const contrastRatio = (a: RGB, b: RGB) => {
  const values = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const hex = (rgb: RGB) => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

export const paletteForBackground = (average: RGB | null): PracticePalette => {
  if (!average) return defaultPalette;
  const dark = relativeLuminance(average) < 0.3;
  // A solid scrim bounds contrast even when the photograph has mixed light and dark areas.
  const worstBackground: RGB = dark ? [56, 56, 56] : [209, 209, 209];
  let accent = average.map((channel, index) => Math.round(channel * 0.45 + [113, 61, 89][index] * 0.55)) as RGB;
  while (contrastRatio(accent, worstBackground) < 4.5) {
    accent = accent.map((channel) => dark ? Math.min(255, channel + 5) : Math.max(0, channel - 5)) as RGB;
  }
  let button = [...accent] as RGB;
  while (contrastRatio(button, [255, 255, 255]) < 4.5) button = button.map((channel) => Math.max(0, channel - 5)) as RGB;
  return {
    bg: dark ? '#17171d' : '#faf9f7', surface: dark ? '#24242c' : '#ffffff',
    ink: dark ? '#ffffff' : '#20232c', sub: dark ? '#dedee8' : '#363942',
    rule: dark ? '#656571' : '#c0bcc3', plum: hex(accent),
    soft: dark ? '#34343d' : '#f2eaf0', green: dark ? '#a5ebc5' : '#22523d',
    button: hex(button), onButton: '#ffffff', chip: dark ? '#34343d' : '#eeedf0',
    error: dark ? '#ffb9c2' : '#8c1725',
    overlay: dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.82)',
  };
};

export const parseBackgroundPreference = (stored: string | null): BackgroundPreference | null => {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored);
    if (typeof value?.uri !== 'string' || !/^(data:image\/(jpeg|png|webp);base64,|file:\/\/)/i.test(value.uri)
      || typeof value.name !== 'string' || !Array.isArray(value.average) || value.average.length !== 3
      || !value.average.every((channel: unknown) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255)) return null;
    return { uri: value.uri, name: value.name, average: value.average };
  } catch { return null; }
};

// The DC component in a BlurHash stores the image's average sRGB color.
export const averageFromBlurhash = (hash: string): RGB => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
  if (hash.length < 6) throw new Error('No se pudo analizar la imagen.');
  let value = 0;
  for (const character of hash.slice(2, 6)) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('No se pudo analizar la imagen.');
    value = value * 83 + digit;
  }
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
