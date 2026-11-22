import type { ChoirPart } from '../../shared/choirParts';
import { normalizeRoles } from '../../shared/musicalAuditions';
import { isRangeInScene } from '../../shared/musicalNumbers';
import type { Dialogue } from '../types/script';
import type {
  MusicalTimelineCueTargetKind,
  SharedMusicalNumberAsset,
  SharedSongAsset,
  SharedSongAudioAsset,
} from '../types/sharedScript';
import { isSongCue } from './scriptScenes';

export type NumberAudioMode = 'reference' | 'vocal_guide' | 'harmony' | 'karaoke';
export type NumberRehearsalRequest = {
  numberId: string;
  character: string | null;
  audioId: string;
  mode: NumberAudioMode;
};

const roleKey = (role: string) => role.trim().normalize('NFC').toLocaleLowerCase('es');
const hasRole = (roles: string[], role: string) => roles.some((name) => roleKey(name) === roleKey(role));

export const getNumberAudios = (number: SharedMusicalNumberAsset, songs: SharedSongAsset[]) => {
  const ids = new Set<string>();
  const linked = songs.filter((song) => number.songIds.includes(song.id));
  return [...number.audios, ...linked.flatMap((song) => song.audios)].filter((audio) => {
    if (ids.has(audio.id)) return false;
    ids.add(audio.id);
    return true;
  });
};

export const getNumberLyrics = (number: SharedMusicalNumberAsset, songs: SharedSongAsset[]) =>
  number.lyrics || songs.filter((song) => number.songIds.includes(song.id))
    .map((song) => song.lyrics).filter(Boolean).join('\n\n');

export const getNumberRoles = (number: SharedMusicalNumberAsset, audios = number.audios) =>
  number.roles ?? normalizeRoles(audios.filter((audio) => !audio.choirPart)
    .flatMap((audio) => [...audio.guideRoles, ...(audio.audibleRoles ?? [])]));

export const getNumberCharacters = (roles: string[], workRoles: string[]) =>
  workRoles.filter((role) => hasRole(roles, role));

export const getReferenceAudio = (
  number: SharedMusicalNumberAsset, audios = number.audios,
): SharedSongAudioAsset | undefined =>
  audios.find((audio) => audio.id === number.referenceAudioId) ??
  audios.find((audio) => audio.kind === 'vocal_guide' && !audio.choirPart && !audio.guideRoles.length) ??
  audios.find((audio) => audio.choirPart === 'all') ??
  audios.find((audio) => !audio.choirPart) ?? audios[0];

export const getNumberVocalGuides = (audios: SharedSongAudioAsset[], character: string | null) =>
  character ? audios.filter((audio) =>
    audio.kind === 'vocal_guide' && !audio.choirPart && hasRole(audio.guideRoles, character)) : [];

const getAudibleRoles = (audio: SharedSongAudioAsset) => {
  if (audio.audibleRoles !== undefined) return audio.audibleRoles;
  // The previous editor labelled guideRoles as the singers in a vocal guide.
  if (audio.kind === 'vocal_guide') return audio.guideRoles.length ? audio.guideRoles : null;
  return [];
};

export const getNumberKaraoke = (
  audios: SharedSongAudioAsset[], cast: string[], character: string | null, rememberedId?: string,
) => {
  const complete: SharedSongAudioAsset[] = [];
  const partial: SharedSongAudioAsset[] = [];
  const instrumental: SharedSongAudioAsset[] = [];
  if (character && hasRole(cast, character)) {
    const otherRoles = cast.filter((role) => roleKey(role) !== roleKey(character));
    for (const audio of audios) {
      if (audio.choirPart) continue;
      const audible = getAudibleRoles(audio);
      if (!audible || hasRole(audible, character)) continue;
      if (!audible.length) {
        instrumental.push(audio);
      } else if (otherRoles.length && otherRoles.every((role) => hasRole(audible, role))) {
        complete.push(audio);
      } else if (otherRoles.some((role) => hasRole(audible, role))) {
        partial.push(audio);
      }
    }
  }
  const options = [...complete, ...partial, ...instrumental];
  const preferred = complete[0] ?? options.find((audio) => audio.id === rememberedId) ??
    (partial.length ? undefined : instrumental[0]);
  return { complete, partial, instrumental, options, preferred };
};

export const isNumberInstrumental = (audio: SharedSongAudioAsset) =>
  !audio.choirPart && getAudibleRoles(audio)?.length === 0;

export const getNumberHarmonyChoices = (audios: SharedSongAudioAsset[], part: ChoirPart | null) =>
  part ? audios.filter((audio) => audio.choirPart === part || audio.choirPart === part.split('-')[0] ||
    audio.choirPart?.startsWith(`${part}-`)) : [];

export const numberKaraokeKey = (numberId: string, character: string) =>
  JSON.stringify([numberId, roleKey(character)]);

export type NumberBlockRange = {
  kind: MusicalTimelineCueTargetKind;
  startLineIndex: number;
  endLineIndex: number;
};

export const groupNumberBlocks = (entries: { lineIndex: number; kind: MusicalTimelineCueTargetKind }[]) => {
  const blocks: NumberBlockRange[] = [];
  for (const { lineIndex, kind } of entries) {
    const previous = blocks.at(-1);
    if (kind === 'dialogue' && previous?.kind === kind && previous.endLineIndex + 1 === lineIndex) {
      previous.endLineIndex = lineIndex;
    } else {
      blocks.push({ kind, startLineIndex: lineIndex, endLineIndex: lineIndex });
    }
  }
  return blocks;
};

export const getNumberBlocks = (number: SharedMusicalNumberAsset, guion: Dialogue[]) => {
  const start = number.startLineIndex;
  if (!isRangeInScene(guion, number.sceneTitle, start, number.endLineIndex)) return [];
  return groupNumberBlocks(guion.slice(start, number.endLineIndex + 1).map((line, index) => ({
    lineIndex: start + index,
    kind: isSongCue(line) ? 'song' : 'dialogue',
  })));
};

export const getNumberTimingIssue = (blocks: NumberBlockRange[], audio: SharedSongAudioAsset) => {
  if (!blocks.length) return 'Vincula el número con un tramo del guion.';
  if (!blocks.some((block) => block.kind === 'song')) return 'El tramo necesita una entrada de canción.';
  if (audio.timelineNeedsReview) return 'Revisa las marcas de sincronización de esta pista.';
  if (blocks.some((block) => block.kind === 'dialogue')) {
    let lastTime = 0;
    for (const block of blocks.slice(1)) {
      const cue = audio.timelineCues.find((item) =>
        item.targetLineIndex === block.startLineIndex && item.targetKind === block.kind);
      if (!cue || cue.atMs <= lastTime) return 'Marca las entradas de canto y diálogo en esta pista.';
      lastTime = cue.atMs;
    }
  }
  return null;
};
