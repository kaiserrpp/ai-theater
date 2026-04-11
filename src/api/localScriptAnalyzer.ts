import { SCENE_SYSTEM_SPEAKER, ScriptData } from '../types/script';
import { extractPdfLines } from './pdfTextExtractor';
import type { PdfExtractionCallbacks } from './pdfTextExtractor';

const DEFAULT_SCENE_TITLE = 'OBRA COMPLETA';
const TITLE_SCAN_LIMIT = 12;
const MAX_SPEAKER_WORDS = 5;
const MAX_SPEAKER_LENGTH = 40;

type LocalAnalysisCallbacks = PdfExtractionCallbacks;

interface ParsedSpeakerLine {
  speaker: string;
  text: string;
  stageDirection: string;
}

const SCENE_HEADING_PATTERN =
  /^(ACTO|ESCENA|CUADRO|JORNADA|PR(?:\u00D3|O)LOGO|EP(?:\u00CD|I)LOGO|INTERMEDIO|ENTREMES|PRIMER ACTO|SEGUNDO ACTO|TERCER ACTO|ACTE|SCENE)\b/iu;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeLine = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/\u00ad/g, '')
      .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
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

const stripWrappingBrackets = (value: string) => value.replace(/^\s*[\[(]\s*|\s*[\])]\s*$/g, '').trim();

const isMostlyUppercase = (value: string) => {
  const letters = Array.from(value).filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) {
    return false;
  }

  const uppercaseLetters = letters.filter((character) => character === character.toUpperCase());
  return uppercaseLetters.length / letters.length >= 0.8;
};

const isSceneHeading = (line: string) => {
  const compactLine = normalizeWhitespace(line.toUpperCase());
  return SCENE_HEADING_PATTERN.test(compactLine);
};

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

  return !isSceneHeading(candidate);
};

const parseSpeakerLine = (line: string): ParsedSpeakerLine | null => {
  const inlineMatch = line.match(
    /^([A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D1][A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00DC\u00D10-9 .,'-]{0,40})\s*[:.]\s*(.*)$/u
  );
  if (inlineMatch) {
    const speaker = sanitizeSpeakerName(inlineMatch[1]);
    if (!isValidSpeakerName(speaker)) {
      return null;
    }

    const { stageDirection, remainder } = extractLeadingStageDirection(inlineMatch[2].trim());
    return { speaker, text: remainder, stageDirection };
  }

  if (isValidSpeakerName(line)) {
    return { speaker: sanitizeSpeakerName(line), text: '', stageDirection: '' };
  }

  return null;
};

const detectTitle = (lines: string[]) => {
  const candidates = lines
    .map(normalizeLine)
    .filter(Boolean)
    .slice(0, TITLE_SCAN_LIMIT)
    .filter((line) => !isSceneHeading(line))
    .filter((line) => parseSpeakerLine(line) === null)
    .filter((line) => !isStandaloneStageDirection(line));

  return candidates[0] ?? 'Obra sin titulo';
};

const buildScriptDataFromLines = (rawLines: string[]): ScriptData => {
  const lines = rawLines.map(normalizeLine).filter(Boolean);
  const obra = detectTitle(lines);
  const personajes = new Set<string>();
  const guion: ScriptData['guion'] = [];

  let currentScene = '';
  let currentDialogue: ScriptData['guion'][number] | null = null;
  let pendingStageDirection = '';

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

  const ensureScene = (sceneTitle: string) => {
    const normalizedSceneTitle = normalizeWhitespace(sceneTitle.toUpperCase());
    if (!normalizedSceneTitle || currentScene === normalizedSceneTitle) {
      return;
    }

    flushCurrentDialogue();
    guion.push({ p: SCENE_SYSTEM_SPEAKER, t: normalizedSceneTitle, a: '' });
    currentScene = normalizedSceneTitle;
  };

  for (const line of lines) {
    if (isSceneHeading(line)) {
      ensureScene(line);
      continue;
    }

    const parsedSpeakerLine = parseSpeakerLine(line);
    if (parsedSpeakerLine) {
      if (!currentScene) {
        ensureScene(DEFAULT_SCENE_TITLE);
      }

      flushCurrentDialogue();
      personajes.add(parsedSpeakerLine.speaker);

      const mergedStageDirection = normalizeWhitespace(
        [pendingStageDirection, parsedSpeakerLine.stageDirection].filter(Boolean).join(' | ')
      );

      currentDialogue = {
        p: parsedSpeakerLine.speaker,
        t: parsedSpeakerLine.text,
        a: mergedStageDirection,
      };

      pendingStageDirection = '';
      continue;
    }

    if (isStandaloneStageDirection(line)) {
      const stageDirection = stripWrappingBrackets(line);
      if (currentDialogue) {
        currentDialogue.a = normalizeWhitespace(
          [currentDialogue.a ?? '', stageDirection].filter(Boolean).join(' | ')
        );
      } else {
        pendingStageDirection = normalizeWhitespace(
          [pendingStageDirection, stageDirection].filter(Boolean).join(' | ')
        );
      }
      continue;
    }

    if (!currentScene || !currentDialogue) {
      continue;
    }

    currentDialogue.t = joinSegments(currentDialogue.t, line);
  }

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
  callbacks?: LocalAnalysisCallbacks
): Promise<ScriptData> => {
  const extractedLines = await extractPdfLines(localUri, callbacks);

  if (extractedLines.length === 0) {
    throw new Error('No he encontrado texto util dentro del PDF.');
  }

  await callbacks?.onStatusChange?.('Interpretando estructura del guion...');

  const scriptData = buildScriptDataFromLines(extractedLines.map((line) => line.text));

  await callbacks?.onStatusChange?.('Completado');
  return scriptData;
};
