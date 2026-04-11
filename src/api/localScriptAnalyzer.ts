import { SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER, ScriptData } from '../types/script';
import { extractPdfLines } from './pdfTextExtractor';
import type { PdfExtractionCallbacks } from './pdfTextExtractor';

const DEFAULT_SCENE_TITLE = 'OBRA COMPLETA';
const TITLE_SCAN_LIMIT = 20;
const MAX_SPEAKER_WORDS = 2;
const MAX_SPEAKER_LENGTH = 40;
const TITLE_IGNORE_PATTERNS = [
  /^PRESENTA$/iu,
  /^FULL VERSION$/iu,
  /^LIBRETO$/iu,
  /^M(?:U|\u00DA)SICA$/iu,
  /^LETRA$/iu,
  /^ADAPTACI(?:O|\u00D3)N LIBRE\b/iu,
];

type LocalAnalysisCallbacks = PdfExtractionCallbacks;

interface LocalAnalysisOptions {
  callbacks?: LocalAnalysisCallbacks;
  documentName?: string | null;
}

interface ParsedSpeakerLine {
  speaker: string;
  text: string;
  stageDirection: string;
}

interface ParsedDialogueLine {
  p: string;
  t: string;
  a?: string;
  k?: 'song';
  songTitle?: string;
}

const GENERIC_SECTION_PATTERN =
  /^(CUADRO|JORNADA|PR(?:\u00D3|O)LOGO|EP(?:\u00CD|I)LOGO|INTERMEDIO|ENTREMES|ACTE)\b(.*)$/iu;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeLine = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/\u00ad/g, '')
      .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u0060\u00B4]/g, "'")
  );

const joinSegments = (currentText: string, nextText: string) => {
  if (!currentText) {
    return nextText;
  }

  if (!nextText) {
    return currentText;
  }

  return currentText.endsWith('-')
    ? `${currentText.slice(0, -1)}${nextText}`
    : `${currentText} ${nextText}`;
};

const mergeNotes = (...values: (string | undefined)[]) =>
  normalizeWhitespace(values.filter(Boolean).join(' | '));

const stripWrappingBrackets = (value: string) => value.replace(/^\s*[\[(]\s*|\s*[\])]\s*$/g, '').trim();

const isMostlyUppercase = (value: string) => {
  const letters = Array.from(value).filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) {
    return false;
  }

  const uppercaseLetters = letters.filter((character) => character === character.toUpperCase());
  return uppercaseLetters.length / letters.length >= 0.8;
};

const countBracketBalance = (value: string) => {
  const openCount = (value.match(/[\[(]/g) ?? []).length;
  const closeCount = (value.match(/[\])]/g) ?? []).length;
  return openCount - closeCount;
};

const parseActHeading = (line: string) => {
  const match = line.match(/^\s*-?\s*ACT(?:O)?\s+([A-Z0-9IVX ]+?)\s*-?\s*$/iu);
  if (!match) {
    return null;
  }

  return normalizeWhitespace(`ACT ${match[1]}`);
};

const parseSceneHeading = (line: string, currentAct: string) => {
  const sceneMatch = line.match(/^(SCENE|ESCENA)\s+(\d+)\s*[:.]?\s*(.*)$/iu);
  if (sceneMatch) {
    const [, label, number, title] = sceneMatch;
    const sceneLabel = normalizeWhitespace(`${label.toUpperCase()} ${number}${title ? `: ${title}` : ''}`);
    return currentAct ? `${currentAct} - ${sceneLabel}` : sceneLabel;
  }

  const genericMatch = line.match(GENERIC_SECTION_PATTERN);
  if (genericMatch) {
    const sceneLabel = normalizeWhitespace(line.toUpperCase());
    return currentAct ? `${currentAct} - ${sceneLabel}` : sceneLabel;
  }

  return null;
};

const isSceneHeading = (line: string, currentAct = '') => Boolean(parseSceneHeading(line, currentAct));

const isSongHeading = (line: string) => /^\d{1,2}\)\s+.+$/.test(line);
const getSongTitle = (line: string) => normalizeWhitespace(line.replace(/^\d{1,2}\)\s*/, ''));

const isStandaloneStageDirection = (line: string) =>
  (/^\(.*\)$/.test(line) || /^\[.*\]$/.test(line)) && line.length > 2;

const extractLeadingStageDirection = (text: string) => {
  const match = text.match(/^([\[(][^\])]+[\])])\s*(.*)$/);
  if (!match) {
    return { stageDirection: '', remainder: text };
  }

  return {
    stageDirection: stripWrappingBrackets(match[1]),
    remainder: match[2].trim(),
  };
};

const sanitizeSpeakerName = (value: string) =>
  normalizeWhitespace(value.replace(/[.:]+$/g, '').replace(/\s+/g, ' ')).toUpperCase();

const isValidSpeakerName = (candidate: string) => {
  if (!candidate || candidate.length > MAX_SPEAKER_LENGTH) {
    return false;
  }

  if (candidate.split(/\s+/).length > MAX_SPEAKER_WORDS) {
    return false;
  }

  if (!isMostlyUppercase(candidate)) {
    return false;
  }

  if (!/^[A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D10-9 .,'-]+$/u.test(candidate)) {
    return false;
  }

  if (isSongHeading(candidate) || parseActHeading(candidate)) {
    return false;
  }

  return !isSceneHeading(candidate);
};

const parseSpeakerLine = (line: string): ParsedSpeakerLine | null => {
  const inlineMatch = line.match(
    /^([A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D1][A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D10-9 .,'-]{0,40})\s*:\s*(.*)$/u
  );
  if (inlineMatch) {
    const speaker = sanitizeSpeakerName(inlineMatch[1]);
    if (!isValidSpeakerName(speaker)) {
      return null;
    }

    const { stageDirection, remainder } = extractLeadingStageDirection(inlineMatch[2].trim());
    return { speaker, text: remainder, stageDirection };
  }

  return null;
};

const sanitizeDocumentTitle = (documentName?: string | null) => {
  if (!documentName) {
    return '';
  }

  return normalizeWhitespace(documentName.replace(/\.[^.]+$/u, '').replace(/[_-]+/g, ' '));
};

const detectTitle = (lines: string[], fallbackTitle: string) => {
  if (fallbackTitle) {
    return fallbackTitle;
  }

  const candidates = lines
    .slice(0, TITLE_SCAN_LIMIT)
    .filter((line) => !parseActHeading(line))
    .filter((line) => !isSceneHeading(line))
    .filter((line) => !isSongHeading(line))
    .filter((line) => parseSpeakerLine(line) === null)
    .filter((line) => !isStandaloneStageDirection(line))
    .filter((line) => !TITLE_IGNORE_PATTERNS.some((pattern) => pattern.test(line)));

  return candidates[0] ?? 'Obra sin titulo';
};

const mergeLogicalLines = (rawLines: string[]) => {
  const normalizedLines = rawLines.map(normalizeLine).filter(Boolean);
  const mergedLines: string[] = [];
  let pendingStageDirection = '';
  let bracketBalance = 0;

  for (const line of normalizedLines) {
    if (pendingStageDirection) {
      pendingStageDirection = joinSegments(pendingStageDirection, line);
      bracketBalance += countBracketBalance(line);

      if (bracketBalance <= 0 || /[\])]\s*$/.test(line)) {
        mergedLines.push(pendingStageDirection);
        pendingStageDirection = '';
        bracketBalance = 0;
      }
      continue;
    }

    if (/^[\[(]/.test(line) && !isStandaloneStageDirection(line)) {
      pendingStageDirection = line;
      bracketBalance = countBracketBalance(line);

      if (bracketBalance <= 0) {
        mergedLines.push(pendingStageDirection);
        pendingStageDirection = '';
      }
      continue;
    }

    mergedLines.push(line);
  }

  if (pendingStageDirection) {
    mergedLines.push(pendingStageDirection);
  }

  return mergedLines;
};

const isLikelyLyricLine = (line: string) => {
  if (line.includes(':')) {
    return false;
  }

  if (parseActHeading(line) || isSceneHeading(line) || isSongHeading(line) || isStandaloneStageDirection(line)) {
    return false;
  }

  const letters = Array.from(line).filter((character) => /\p{L}/u.test(character));
  if (letters.length < 5) {
    return false;
  }

  const uppercaseLetters = letters.filter((character) => character === character.toUpperCase());
  return uppercaseLetters.length / letters.length >= 0.9;
};

const buildScriptDataFromLines = (rawLines: string[], fallbackTitle: string): ScriptData => {
  const lines = mergeLogicalLines(rawLines);
  const obra = detectTitle(lines, fallbackTitle);
  const personajes = new Set<string>();
  const guion: ParsedDialogueLine[] = [];

  let currentAct = '';
  let currentScene = '';
  let currentDialogue: ParsedDialogueLine | null = null;
  let currentSong: ParsedDialogueLine | null = null;
  let pendingStageDirection = '';
  let pendingSongTitle = '';

  const flushCurrentDialogue = () => {
    if (!currentDialogue) {
      return;
    }

    currentDialogue.t = normalizeWhitespace(currentDialogue.t);
    currentDialogue.a = normalizeWhitespace(currentDialogue.a ?? '');

    if (currentDialogue.t || currentDialogue.a) {
      guion.push(currentDialogue);
    }

    currentDialogue = null;
  };

  const flushCurrentSong = () => {
    if (!currentSong) {
      return;
    }

    currentSong.t = normalizeWhitespace(currentSong.t);
    currentSong.a = normalizeWhitespace(currentSong.a ?? '');

    if (currentSong.t) {
      guion.push(currentSong);
    }

    currentSong = null;
  };

  const ensureScene = (sceneTitle: string) => {
    const normalizedSceneTitle = normalizeWhitespace(sceneTitle.toUpperCase());
    if (!normalizedSceneTitle || currentScene === normalizedSceneTitle) {
      return;
    }

    flushCurrentSong();
    flushCurrentDialogue();
    guion.push({ p: SCENE_SYSTEM_SPEAKER, t: normalizedSceneTitle, a: '' });
    currentScene = normalizedSceneTitle;
    pendingSongTitle = '';
  };

  const startDialogue = (speaker: string, text: string, stageDirection = '') => {
    flushCurrentSong();
    flushCurrentDialogue();
    currentDialogue = {
      p: speaker,
      t: text,
      a: mergeNotes(pendingStageDirection, stageDirection),
    };
    pendingStageDirection = '';
    pendingSongTitle = '';
  };

  const startSong = (text: string) => {
    flushCurrentDialogue();
    flushCurrentSong();
    currentSong = {
      p: SONG_SYSTEM_SPEAKER,
      t: text,
      a: pendingStageDirection,
      k: 'song',
      songTitle: pendingSongTitle || undefined,
    };
    pendingStageDirection = '';
    pendingSongTitle = '';
  };

  for (const line of lines) {
    const actHeading = parseActHeading(line);
    if (actHeading) {
      currentAct = actHeading;
      continue;
    }

    const sceneHeading = parseSceneHeading(line, currentAct);
    if (sceneHeading) {
      ensureScene(sceneHeading);
      continue;
    }

    if (isSongHeading(line)) {
      flushCurrentDialogue();
      flushCurrentSong();
      pendingSongTitle = getSongTitle(line);
      continue;
    }

    const parsedSpeakerLine = parseSpeakerLine(line);
    if (parsedSpeakerLine) {
      if (!currentScene) {
        ensureScene(currentAct ? `${currentAct} - ${DEFAULT_SCENE_TITLE}` : DEFAULT_SCENE_TITLE);
      }

      startDialogue(parsedSpeakerLine.speaker, parsedSpeakerLine.text, parsedSpeakerLine.stageDirection);
      personajes.add(parsedSpeakerLine.speaker);
      continue;
    }

    if (isStandaloneStageDirection(line)) {
      const stageDirection = stripWrappingBrackets(line);
      if (currentSong) {
        const activeSong = currentSong as ParsedDialogueLine;
        activeSong.a = mergeNotes(activeSong.a ?? '', stageDirection);
        continue;
      }

      if (currentDialogue) {
        const activeDialogue = currentDialogue as ParsedDialogueLine;
        activeDialogue.a = mergeNotes(activeDialogue.a ?? '', stageDirection);
      } else {
        pendingStageDirection = mergeNotes(pendingStageDirection, stageDirection);
      }
      continue;
    }

    if (isLikelyLyricLine(line)) {
      if (!currentAct && !currentScene) {
        continue;
      }

      if (!currentScene) {
        ensureScene(currentAct ? `${currentAct} - ${DEFAULT_SCENE_TITLE}` : DEFAULT_SCENE_TITLE);
      }

      if (currentSong) {
        const activeSong = currentSong as ParsedDialogueLine;
        activeSong.t = joinSegments(activeSong.t, line);
        activeSong.a = mergeNotes(activeSong.a ?? '', pendingStageDirection);
        pendingStageDirection = '';
      } else {
        startSong(line);
      }
      continue;
    }

    if (currentSong) {
      flushCurrentSong();
    }

    if (!currentScene || !currentDialogue) {
      continue;
    }

    const activeDialogue = currentDialogue as ParsedDialogueLine;
    activeDialogue.t = joinSegments(activeDialogue.t, line);
  }

  flushCurrentSong();
  flushCurrentDialogue();

  if (!guion.some((line) => line.p === SCENE_SYSTEM_SPEAKER)) {
    guion.unshift({ p: SCENE_SYSTEM_SPEAKER, t: DEFAULT_SCENE_TITLE, a: '' });
  }

  if (!guion.some((line) => line.p !== SCENE_SYSTEM_SPEAKER && line.t)) {
    throw new Error(
      'No he podido reconstruir dialogos validos. El PDF puede ser una imagen escaneada o tener un formato poco estructurado.'
    );
  }

  return {
    obra,
    personajes: Array.from(personajes).sort(),
    guion,
  };
};

export const analyzeScriptLocally = async (
  localUri: string,
  options?: LocalAnalysisOptions
): Promise<ScriptData> => {
  const { callbacks, documentName } = options ?? {};
  const extractedLines = await extractPdfLines(localUri, callbacks);

  if (extractedLines.length === 0) {
    throw new Error('No he encontrado texto util dentro del PDF.');
  }

  await callbacks?.onStatusChange?.('Interpretando estructura del guion...');

  const scriptData = buildScriptDataFromLines(
    extractedLines.map((line) => line.text),
    sanitizeDocumentTitle(documentName)
  );

  await callbacks?.onStatusChange?.('Completado');
  return scriptData;
};
