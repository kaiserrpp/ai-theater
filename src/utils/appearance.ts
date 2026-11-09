export type RGB = [number, number, number];
export type BackgroundPreference = { uri: string; name: string; average: RGB; accent?: RGB };

export const defaultPalette = {
  bg: '#faf9f7', surface: '#ffffff', ink: '#20232c', sub: '#606572', rule: '#e4e3e7',
  plum: '#713d59', soft: '#f2eaf0', green: '#2d6a50', button: '#713d59',
  onButton: '#ffffff', chip: '#eeedf0', error: '#a32330', overlay: 'transparent', isDark: false,
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

const hsl = ([r, g, b]: RGB): [number, number, number] => {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  const lightness = (max + min) / 2;
  if (!delta) return [0, 0, lightness];
  const hue = max === red ? ((green - blue) / delta + 6) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue / 6, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
};
const fromHsl = (hue: number, saturation: number, lightness: number): RGB => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = lightness - chroma / 2;
  const channels = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x]
    : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x];
  return channels.map((channel) => Math.round((channel + m) * 255)) as RGB;
};

export const paletteForBackground = (average: RGB | null, imageAccent: RGB | null = average): PracticePalette => {
  if (!average) return defaultPalette;
  const dark = relativeLuminance(average) < 0.3;
  const [hue, sourceSaturation] = hsl(imageAccent ?? average);
  const saturation = sourceSaturation < 0.08 ? 0 : Math.min(0.75, Math.max(0.35, sourceSaturation));
  const tone = (lightness: number, strength = 1) => fromHsl(hue, saturation * strength, lightness);
  const bg = tone(dark ? 0.09 : 0.96, 0.4);
  const surface = tone(dark ? 0.15 : 0.98, 0.42);
  const soft = tone(dark ? 0.23 : 0.91, 0.48);
  // Less overall shading reveals the photograph. Text still passes contrast on the worst possible crop.
  const worstBackground: RGB = dark ? [102, 102, 102] : [173, 173, 173];
  const backdrops = [worstBackground, bg, surface, soft];
  const readable = (textHue: number, textSaturation: number, start: number, lighter = dark, against = backdrops) => {
    let color: RGB = [0, 0, 0];
    for (let step = 0; step <= 100; step++) {
      color = fromHsl(textHue, textSaturation, Math.max(0, Math.min(1, start + (lighter ? step : -step) / 100)));
      if (against.every((background) => contrastRatio(color, background) >= 4.5)) break;
    }
    return hex(color);
  };
  return {
    bg: hex(bg), surface: hex(surface), ink: readable(hue, saturation * 0.3, dark ? 0.97 : 0.10),
    sub: readable(hue, saturation * 0.35, dark ? 0.87 : 0.17), rule: hex(tone(dark ? 0.48 : 0.57, 0.4)),
    plum: readable(hue, saturation, dark ? 0.79 : 0.27), soft: hex(soft), chip: hex(soft),
    green: readable(0.39, 0.5, dark ? 0.83 : 0.2),
    button: readable(hue, saturation, 0.36, false, [[255, 255, 255]]), onButton: '#ffffff',
    error: readable(0.98, 0.65, dark ? 0.87 : 0.25),
    overlay: dark ? 'rgba(0,0,0,0.60)' : 'rgba(255,255,255,0.68)', isDark: dark,
  };
};

// Favor a prominent colorful region over white margins or black lettering in a poster.
export const imageAccentFromPixels = (pixels: Uint8ClampedArray, fallback: RGB): RGB => {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, rgb: [0, 0, 0] as RGB }));
  for (let index = 0; index < pixels.length; index += 4) {
    const color: RGB = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const [hue, saturation, lightness] = hsl(color);
    if (pixels[index + 3] < 128 || saturation < 0.2 || lightness < 0.08 || lightness > 0.9) continue;
    const weight = saturation * (1 - Math.abs(lightness - 0.5));
    const bin = bins[Math.min(23, Math.floor(hue * 24))];
    bin.weight += weight;
    color.forEach((channel, channelIndex) => { bin.rgb[channelIndex] += channel * weight; });
  }
  const best = bins.reduce((previous, next) => next.weight > previous.weight ? next : previous);
  return best.weight ? best.rgb.map((channel) => Math.round(channel / best.weight)) as RGB : fallback;
};

export const parseBackgroundPreference = (stored: string | null): BackgroundPreference | null => {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored);
    if (typeof value?.uri !== 'string' || !/^(data:image\/(jpeg|png|webp);base64,|file:\/\/)/i.test(value.uri)
      || typeof value.name !== 'string' || !Array.isArray(value.average) || value.average.length !== 3
      || !value.average.every((channel: unknown) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255)) return null;
    const accent = Array.isArray(value.accent) && value.accent.length === 3
      && value.accent.every((channel: unknown) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255) ? value.accent as RGB : undefined;
    return { uri: value.uri, name: value.name, average: value.average, ...(accent ? { accent } : {}) };
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
