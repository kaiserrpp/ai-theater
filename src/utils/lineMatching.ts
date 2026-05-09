const STOP_WORDS = new Set([
  'a',
  'al',
  'an',
  'and',
  'are',
  'as',
  'at',
  'but',
  'de',
  'del',
  'el',
  'en',
  'for',
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
  'of',
  'on',
  'or',
  'que',
  'se',
  'the',
  'to',
  'un',
  'una',
  'y',
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

export type LineMatchResult = {
  score: number;
  referenceText: string;
  referenceIndex: number;
  coverageScore: number;
  orderScore: number;
  finalScore: number;
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

export const normalizeSpeechText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9ñÑ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const tokenize = (value: string) =>
  normalizeSpeechText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const getContentTokens = (value: string) =>
  tokenize(value).filter((token) => !STOP_WORDS.has(token) || NEGATION_WORDS.has(token));

const getNegationCount = (tokens: string[]) =>
  tokens.filter((token) => NEGATION_WORDS.has(token)).length;

const countCoveredTokens = (expectedTokens: string[], heardTokens: string[]) => {
  const remainingHeardTokens = [...heardTokens];
  let coveredTokens = 0;

  expectedTokens.forEach((expectedToken) => {
    const matchIndex = remainingHeardTokens.indexOf(expectedToken);

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
      matrix[row][column] =
        leftTokens[row - 1] === rightTokens[column - 1]
          ? matrix[row - 1][column - 1] + 1
          : Math.max(matrix[row - 1][column], matrix[row][column - 1]);
    }
  }

  return matrix[leftTokens.length][rightTokens.length];
};

const scoreAgainstReference = (
  referenceText: string,
  heardText: string,
  referenceIndex: number
): LineMatchResult => {
  const referenceTokens = getContentTokens(referenceText);
  const heardTokens = getContentTokens(heardText);

  if (!referenceTokens.length || !heardTokens.length) {
    return {
      score: 0,
      referenceText,
      referenceIndex,
      coverageScore: 0,
      orderScore: 0,
      finalScore: 0,
      negationPenaltyApplied: false,
    };
  }

  const coveredTokens = countCoveredTokens(referenceTokens, heardTokens);
  const lcsLength = getLongestCommonSubsequenceLength(referenceTokens, heardTokens);
  const coverageScore = coveredTokens / referenceTokens.length;
  const orderScore = lcsLength / referenceTokens.length;
  const finalReferenceTokens = referenceTokens.slice(-Math.min(3, referenceTokens.length));
  const finalCoveredTokens = countCoveredTokens(finalReferenceTokens, heardTokens);
  const finalScore = finalReferenceTokens.length > 0 ? finalCoveredTokens / finalReferenceTokens.length : 0;
  let score = coverageScore * 0.56 + orderScore * 0.32 + finalScore * 0.12;

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
