const inTheHeightsSongs = new Map([
  ['musical-number-1d1dc3ec88d9', '2326991'], // Blackout
  ['musical-number-c0b61f4653e9', '211728'], // 96,000
  ['musical-number-f58c1a4764f7', '2326303'], // When the Sun Goes Down
  ['musical-number-acce17dcd78a', '141424'], // In the Heights
  ['musical-number-d04864b4-e02e-4c19-b470-16fdbe2457fb', '2327052'], // Carnaval del Barrio
]);

export const getGeniusSongId = (shareId: string, musicalNumberId: string) =>
  shareId === 'd92b33981047' ? inTheHeightsSongs.get(musicalNumberId) : undefined;
