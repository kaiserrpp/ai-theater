const STOP_WORDS = new Set([
  'a',
  'al',
  'an',
  'and',
  'are',
  'as',
  'at',
  'aqui',
  'but',
  'calmate',
  'con',
  'de',
  'deberia',
  'deberiamos',
  'deberian',
  'deberias',
  'del',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'eres',
  'es',
  'ese',
  'esa',
  'esta',
  'este',
  'esto',
  'for',
  'hay',
  'i',
  'in',
  'is',
  'it',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'me',
  'mi',
  'mis',
  'mismo',
  'muy',
  'nada',
  'nosotros',
  'of',
  'on',
  'or',
  'os',
  'que',
  'se',
  'ser',
  'soy',
  'somos',
  'son',
  'te',
  'the',
  'ti',
  'to',
  'tu',
  'tus',
  'un',
  'una',
  'y',
  'yo',
]);

const FILLER_WORDS = new Set([
  'bueno',
  'eh',
  'hey',
  'ok',
  'okay',
  'oye',
  'pues',
  'venga',
  'vamos',
  'whoa',
]);

const NEGATION_WORDS = new Set([
  'aint',
  'cannot',
  'cant',
  'dont',
  'jamás',
  'jamas',
  'never',
  'no',
  'not',
  'nunca',
  'sin',
  'wont',
]);

const NEXT_LINE_COMMANDS = [
  'siguiente',
  'siguiente linea',
  'siguiente línea',
  'pasa linea',
  'pasa línea',
  'pasar linea',
  'pasar línea',
  'continuar',
  'continua',
  'continúa',
  'next line',
  'next',
];

const NUMBER_TOKEN_ALIASES: Record<string, string> = {
  '0': 'cero',
  '1': 'uno',
  '2': 'dos',
  '3': 'tres',
  '4': 'cuatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'siete',
  '8': 'ocho',
  '9': 'nueve',
  '10': 'diez',
  '20': 'veinte',
  '30': 'treinta',
  '40': 'cuarenta',
  '50': 'cincuenta',
  '60': 'sesenta',
  '70': 'setenta',
  '80': 'ochenta',
  '90': 'noventa',
  '100': 'cien',
  '1000': 'mil',
};

const TOKEN_ALIASES: Record<string, string> = {
  apuraos: 'apurense',
  atraparme: 'atrapar',
  atraparmeis: 'atrapar',
  atraparmeos: 'atrapar',
  averiguar: 'averiguarlo',
  cabalga: 'cabalgas',
  cabalgar: 'cabalgas',
  comprobar: 'averiguarlo',
  comprobarlo: 'averiguarlo',
  cratchi: 'crutchie',
  crachi: 'crutchie',
  crazy: 'crutchie',
  cruchi: 'crutchie',
  crutchy: 'crutchie',
  delanci: 'delancey',
  delantzi: 'delancey',
  dici: 'dices',
  fe: 'fe',
  gratis: 'crutchie',
  hicieramos: 'hacer',
  hicieremos: 'hacer',
  hicieremoslo: 'hacer',
  hiciesemos: 'hacer',
  hiciesemoslo: 'hacer',
  hiciésemos: 'hacer',
  hiciéramos: 'hacer',
  newies: 'newsies',
  newsis: 'newsies',
  newsys: 'newsies',
  penthhouse: 'penthouse',
  pena: 'triste',
  quereis: 'quieres',
  querriais: 'pareceria',
  resears: 'research',
  romeo: 'romeo',
  santafe: 'santafe',
  space: 'specs',
  spaces: 'specs',
  specks: 'specs',
  specs: 'specs',
  tanta: 'santa',
  vuelvete: 'volver',
};

const PHRASE_ALIASES: [RegExp, string][] = [
  [/\ba lo mejor\b/g, ' quiza '],
  [/\bcarita de pena\b/g, ' cara triste '],
  [/\bcara de pena\b/g, ' cara triste '],
  [/\bdaos prisa\b/g, ' apurense '],
  [/\bdar pena\b/g, ' triste '],
  [/\bnueva york\b/g, ' ny '],
  [/\bsanta fe\b/g, ' santafe '],
  [/\bsetenta\s+treinta\b/g, ' 70 30 '],
  [/\bsesenta\s+cuarenta\b/g, ' 60 40 '],
];

export const INTELLIGENT_AUTO_ADVANCE_THRESHOLD = 0.86;

export type LineMatchResult = {
  score: number;
  referenceText: string;
  referenceIndex: number;
  coverageScore: number;
  orderScore: number;
  finalScore: number;
  precisionScore: number;
  negationPenaltyApplied: boolean;
};

export const hashLineText = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

const removeStageDirections = (value: string) =>
  value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ');

const normalizeRawSpeechText = (value: string) => {
  let normalized = removeStageDirections(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/(\d+)\s*[-/]\s*(\d+)/g, '$1 $2')
    .replace(/[^a-zA-Z0-9ñÑ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  PHRASE_ALIASES.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized.replace(/\s+/g, ' ').trim();
};

const normalizeToken = (token: string) => {
  const compactedToken = token.replace(/([a-zñ])\1{2,}/g, '$1$1');

  if (/^wo+w$/.test(compactedToken) || /^u+h+$/.test(compactedToken) || /^o+h+$/.test(compactedToken)) {
    return 'reaction';
  }

  const numberNormalizedToken = NUMBER_TOKEN_ALIASES[compactedToken] ?? compactedToken;

  return TOKEN_ALIASES[numberNormalizedToken] ?? numberNormalizedToken;
};

const compactRepeatedTokens = (tokens: string[]) =>
  tokens.filter((token, index) => index === 0 || token !== tokens[index - 1]);

export const normalizeSpeechText = (value: string) =>
  compactRepeatedTokens(
    normalizeRawSpeechText(value)
      .split(' ')
      .map((token) => normalizeToken(token.trim()))
      .filter(Boolean)
  ).join(' ');

const tokenize = (value: string) =>
  normalizeSpeechText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const getContentTokens = (value: string) => {
  const tokens = tokenize(value);
  const contentTokens = tokens.filter(
    (token) =>
      NEGATION_WORDS.has(token) ||
      (!STOP_WORDS.has(token) && !FILLER_WORDS.has(token))
  );

  return contentTokens.length > 0 ? contentTokens : tokens;
};

const getNegationCount = (tokens: string[]) =>
  tokens.filter((token) => NEGATION_WORDS.has(token)).length;

const getLevenshteinDistance = (left: string, right: string) => {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0) as number[]);

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column < columns; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[left.length][right.length];
};

const getTokenSimilarity = (leftToken: string, rightToken: string) => {
  if (leftToken === rightToken) {
    return 1;
  }

  const maxLength = Math.max(leftToken.length, rightToken.length);

  if (maxLength < 4) {
    return 0;
  }

  const distance = getLevenshteinDistance(leftToken, rightToken);
  return 1 - distance / maxLength;
};

const tokensMatch = (leftToken: string, rightToken: string) => {
  const similarity = getTokenSimilarity(leftToken, rightToken);
  const minLength = Math.min(leftToken.length, rightToken.length);
  const threshold = minLength <= 4 ? 0.82 : 0.7;

  return similarity >= threshold;
};

const countCoveredTokens = (expectedTokens: string[], heardTokens: string[]) => {
  const remainingHeardTokens = [...heardTokens];
  let coveredTokens = 0;

  expectedTokens.forEach((expectedToken) => {
    let matchIndex = remainingHeardTokens.indexOf(expectedToken);

    if (matchIndex < 0) {
      matchIndex = remainingHeardTokens.findIndex((heardToken) =>
        tokensMatch(expectedToken, heardToken)
      );
    }

    if (matchIndex >= 0) {
      coveredTokens += 1;
      remainingHeardTokens.splice(matchIndex, 1);
    }
  });

  return coveredTokens;
};

const getLongestCommonSubsequenceLength = (leftTokens: string[], rightTokens: string[]) => {
  const rows = leftTokens.length + 1;
  const columns = rightTokens.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0) as number[]);

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      matrix[row][column] = tokensMatch(leftTokens[row - 1], rightTokens[column - 1])
        ? matrix[row - 1][column - 1] + 1
        : Math.max(matrix[row - 1][column], matrix[row][column - 1]);
    }
  }

  return matrix[leftTokens.length][rightTokens.length];
};

const getEmptyResult = (referenceText: string, referenceIndex: number): LineMatchResult => ({
  score: 0,
  referenceText,
  referenceIndex,
  coverageScore: 0,
  orderScore: 0,
  finalScore: 0,
  precisionScore: 0,
  negationPenaltyApplied: false,
});

const scoreAgainstReference = (
  referenceText: string,
  heardText: string,
  referenceIndex: number
): LineMatchResult => {
  const referenceTokens = getContentTokens(referenceText);
  const heardTokens = getContentTokens(heardText);

  if (!referenceTokens.length || !heardTokens.length) {
    return getEmptyResult(referenceText, referenceIndex);
  }

  const coveredTokens = countCoveredTokens(referenceTokens, heardTokens);
  const lcsLength = getLongestCommonSubsequenceLength(referenceTokens, heardTokens);
  const coverageScore = coveredTokens / referenceTokens.length;
  const orderScore = lcsLength / referenceTokens.length;
  const precisionScore = coveredTokens / heardTokens.length;
  const finalReferenceTokens = referenceTokens.slice(-Math.min(3, referenceTokens.length));
  const finalCoveredTokens = countCoveredTokens(finalReferenceTokens, heardTokens);
  const finalScore = finalReferenceTokens.length > 0 ? finalCoveredTokens / finalReferenceTokens.length : 0;
  const isShortLine = referenceTokens.length <= 2;
  let score = isShortLine
    ? coverageScore * 0.62 + orderScore * 0.18 + finalScore * 0.12 + precisionScore * 0.08
    : coverageScore * 0.46 + orderScore * 0.24 + finalScore * 0.18 + precisionScore * 0.12;

  if (!isShortLine && coverageScore >= 0.82 && finalScore >= 0.67) {
    score += 0.07;
  } else if (!isShortLine && coverageScore >= 0.7 && finalScore >= 0.67 && precisionScore >= 0.55) {
    score += 0.04;
  }

  if (heardTokens.length > referenceTokens.length * 2.4 && coverageScore < 0.95) {
    score = Math.min(score, 0.78);
  }

  const referenceNegationCount = getNegationCount(referenceTokens);
  const heardNegationCount = getNegationCount(heardTokens);
  const negationPenaltyApplied = referenceNegationCount !== heardNegationCount;

  if (negationPenaltyApplied) {
    score = Math.min(score, 0.62);
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    referenceText,
    referenceIndex,
    coverageScore,
    orderScore,
    finalScore,
    precisionScore,
    negationPenaltyApplied,
  };
};

export const scoreLineMatch = (
  expectedText: string,
  heardText: string,
  acceptedVariants: string[] = []
) => {
  const references = [expectedText, ...acceptedVariants.filter((variant) => variant.trim())];

  return references
    .map((referenceText, referenceIndex) =>
      scoreAgainstReference(referenceText, heardText, referenceIndex)
    )
    .sort((leftResult, rightResult) => rightResult.score - leftResult.score)[0];
};

export const isSafeAutomaticLineMatch = (
  expectedText: string,
  heardText: string,
  result: LineMatchResult
) => {
  if (result.score < INTELLIGENT_AUTO_ADVANCE_THRESHOLD || result.negationPenaltyApplied) {
    return false;
  }

  const expectedTokens = getContentTokens(expectedText);
  const heardTokens = getContentTokens(heardText);

  if (!heardTokens.length) {
    return false;
  }

  if (getNegationCount(expectedTokens) !== getNegationCount(heardTokens)) {
    return false;
  }

  if (expectedTokens.length <= 2) {
    return result.coverageScore >= 1 && result.precisionScore >= 0.5;
  }

  return result.coverageScore >= 0.72 && result.finalScore >= 0.55;
};

export const isNextLineCommand = (heardText: string) => {
  const normalizedText = normalizeSpeechText(heardText);
  const tokens = normalizedText.split(' ').filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return NEXT_LINE_COMMANDS.some((command) => normalizeSpeechText(command) === normalizedText);
};

export const inferSpeechRecognitionLanguage = (lineText: string) => {
  const tokens = new Set(tokenize(lineText));
  const englishHints = ['the', 'you', 'and', 'that', 'what', 'where', 'why', 'want', 'dont', 'cant'];
  const spanishHints = ['que', 'como', 'donde', 'quiero', 'porque', 'pero', 'para', 'esta', 'este'];
  const englishScore = englishHints.filter((hint) => tokens.has(hint)).length;
  const spanishScore = spanishHints.filter((hint) => tokens.has(hint)).length;

  return englishScore > spanishScore ? 'en-US' : 'es-ES';
};
