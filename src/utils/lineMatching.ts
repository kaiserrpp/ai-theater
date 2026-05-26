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
  'eso',
  'esta',
  'estas',
  'este',
  'esto',
  'entonces',
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
  'usted',
  'ustedes',
  'vosotras',
  'vosotros',
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

const GOOD_LINE_COMMANDS = [
  'linea buena',
  'lÃ­nea buena',
  'linea valida',
  'lÃ­nea valida',
  'linea correcta',
  'lÃ­nea correcta',
  'la linea es buena',
  'la lÃ­nea es buena',
  'aceptar linea',
  'aceptar lÃ­nea',
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
  artista: 'estrella',
  atraparme: 'atrapar',
  atraparmeis: 'atrapar',
  atraparmeos: 'atrapar',
  autentico: 'verdadero',
  averiguar: 'averiguarlo',
  bocaza: 'bocota',
  cabalga: 'cabalgas',
  cabalgar: 'cabalgas',
  chist: 'reaction',
  claro: 'bien',
  conocido: 'conocidos',
  comprobar: 'averiguarlo',
  comprobarlo: 'averiguarlo',
  cratchi: 'crutchie',
  crachi: 'crutchie',
  croati: 'crutchie',
  crazy: 'crutchie',
  cruchi: 'crutchie',
  crutchy: 'crutchie',
  delanci: 'delancey',
  delantzi: 'delancey',
  dici: 'dices',
  david: 'davey',
  davy: 'davey',
  baby: 'davey',
  che: 'reaction',
  dellornar: 'journal',
  dellornal: 'journal',
  delyornar: 'journal',
  entienda: 'sentido',
  entiendo: 'sentido',
  fe: 'fe',
  gratis: 'crutchie',
  haceis: 'hacen',
  haceos: 'hacer',
  hagan: 'hacer',
  haganse: 'hacer',
  hicieramos: 'hacer',
  hicieremos: 'hacer',
  hicieremoslo: 'hacer',
  hiciesemos: 'hacer',
  hiciesemoslo: 'hacer',
  journal: 'journal',
  jackeline: 'jackkelly',
  jacqueline: 'jackkelly',
  lado: 'lugar',
  mantened: 'mantener',
  manteneros: 'mantener',
  mantenganse: 'mantener',
  meda: 'medda',
  medalla: 'medda',
  hiciésemos: 'hacer',
  hiciéramos: 'hacer',
  news: 'newsies',
  newies: 'newsies',
  newsis: 'newsies',
  newsys: 'newsies',
  ninos: 'chicos',
  ninas: 'chicas',
  niucis: 'newsies',
  niusis: 'newsies',
  oigan: 'oye',
  pasad: 'pasar',
  pasen: 'pasar',
  penthhouse: 'penthouse',
  pena: 'triste',
  punado: 'monton',
  quereis: 'quieres',
  querriais: 'pareceria',
  quizas: 'quiza',
  lamento: 'triste',
  resears: 'research',
  romeo: 'romeo',
  santafe: 'santafe',
  space: 'specs',
  spacex: 'specs',
  spaces: 'specs',
  specks: 'specs',
  specs: 'specs',
  snider: 'snyder',
  sneider: 'snyder',
  schneider: 'snyder',
  sitio: 'lugar',
  distinta: 'diferente',
  distinto: 'diferente',
  tanta: 'santa',
  teneis: 'tienen',
  todavia: 'aun',
  tranquilas: 'tranquilo',
  tranquilos: 'tranquilo',
  vale: 'bien',
  venid: 'vengan',
  voces: 'voz',
  vuelvete: 'volver',
  wisel: 'weasel',
};

const PHRASE_ALIASES: [RegExp, string][] = [
  [/\ba lo mejor\b/g, ' quiza '],
  [/\bcarita de pena\b/g, ' cara triste '],
  [/\bcara de pena\b/g, ' cara triste '],
  [/\bde broma\b/g, ' bromeando '],
  [/\bdaos prisa\b/g, ' apurense '],
  [/\bdar pena\b/g, ' triste '],
  [/\bde acuerdo\b/g, ' bien '],
  [/\bdebe\s+tratarse\b/g, ' tiene ser '],
  [/\bhabla\s+mas\s+bajo\b/g, ' baja voz '],
  [/\bhas\s+echado\s+la\s+llave\b/g, ' cierras puerta llave '],
  [/\bjack\s+kelly\b/g, ' jackkelly '],
  [/\ble\s+importa\s+si\b/g, ' podriamos '],
  [/\bme\s+da\s+larkin\b/g, ' medda larkin '],
  [/\blamento\s+mucho\s+lo\s+de\b/g, ' triste '],
  [/\bnew\s+seis\b/g, ' newsies '],
  [/\bno\s+hubiera\s+ocurrido\s+nunca\b/g, ' nunca hubiera pasado '],
  [/\bnos\s+vamos\s+a\b/g, ' iremos '],
  [/\bnueva york\b/g, ' ny '],
  [/\bpor\s+que\s+no\s+nos\b/g, ' propuesta nos '],
  [/\bque\s+tal\s+(le|te)\s+fue\b/g, ' como te fue '],
  [/\bque\s+os\s+parece\s+si\b/g, ' propuesta '],
  [/\bque\s+tal\s+si\b/g, ' propuesta '],
  [/\bsanta fe\b/g, ' santafe '],
  [/\bsenorita\s+me\s+da\b/g, ' senorita medda '],
  [/\bse\s+me\s+ocurre\s+un\s+problema\b/g, ' hay problema '],
  [/\bsetenta\s+treinta\b/g, ' 70 30 '],
  [/\bsesenta\s+cuarenta\b/g, ' 60 40 '],
  [/\bsi\s+asi\s+es\b/g, ' bien '],
  [/\bsi\s+claro\b/g, ' bien '],
  [/\bsi\s+claro\s+tiene\s+sentido\b/g, ' sentido '],
  [/\btal\s+vez\b/g, ' quiza '],
  [/\bno\s+esta\s+mal\b/g, ' suena bien '],
  [/\bvamos\s+a\s+la\s+huelga\b/g, ' hacemos huelga '],
  [/\bun\s+vete\s+a\s+dormir\b/g, ' vuelve dormir '],
  [/\bvete\s+a\s+dormir\b/g, ' vuelve dormir '],
];

export const INTELLIGENT_AUTO_ADVANCE_THRESHOLD = 0.86;
const FLUENT_FINAL_WORD_COUNT = 5;
const FLUENT_FINAL_HEARD_EXTRA_WORDS = 4;
const FLUENT_FINAL_MIN_CONTENT_TOKENS = 6;

export type AutomaticLineMatchReason =
  | 'global_score'
  | 'high_final_confidence'
  | 'replica_closure'
  | 'fluent_final'
  | 'short_flexible'
  | 'strong_coverage';

export type LineMatchResult = {
  score: number;
  referenceText: string;
  referenceIndex: number;
  coverageScore: number;
  orderScore: number;
  finalScore: number;
  finalPhraseScore: number;
  finalPhraseWordCount: number;
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

  if (
    /^wo+w$/.test(compactedToken) ||
    /^u+h+$/.test(compactedToken) ||
    /^o+h+$/.test(compactedToken) ||
    /^s+h+$/.test(compactedToken)
  ) {
    return 'reaction';
  }

  const numberNormalizedToken = NUMBER_TOKEN_ALIASES[compactedToken] ?? compactedToken;

  return TOKEN_ALIASES[numberNormalizedToken] ?? numberNormalizedToken;
};

const compactRepeatedTokens = (tokens: string[]) =>
  tokens.filter((token, index) => index === 0 || token !== tokens[index - 1]);

const commandMatches = (normalizedText: string, commands: string[]) =>
  commands.some((command) => normalizeSpeechText(command) === normalizedText);

const splitTrailingCommand = (heardText: string, commands: string[]) => {
  const normalizedText = normalizeSpeechText(heardText);
  const normalizedTokens = normalizedText.split(' ').filter(Boolean);

  if (!normalizedTokens.length) {
    return null;
  }

  for (const command of commands) {
    const commandTokens = normalizeSpeechText(command).split(' ').filter(Boolean);

    if (!commandTokens.length || commandTokens.length > normalizedTokens.length) {
      continue;
    }

    const commandStartIndex = normalizedTokens.length - commandTokens.length;
    const hasCommandAtEnd = commandTokens.every(
      (token, index) => normalizedTokens[commandStartIndex + index] === token
    );

    if (hasCommandAtEnd) {
      return normalizedTokens.slice(0, commandStartIndex).join(' ');
    }
  }

  return null;
};

export const normalizeSpeechText = (value: string) =>
  compactRepeatedTokens(
    normalizeRawSpeechText(value)
      .split(' ')
      .map((token) => normalizeToken(token.trim()))
      .filter(Boolean)
  ).join(' ');

const EQUIVALENT_LINE_REFERENCES: {
  expectedPattern: RegExp;
  references: string[];
}[] = [
  {
    expectedPattern: /\btengo.*spot.*impresionado.*verdad\b/,
    references: ['La verdad que quedo bastante impresionado verdad'],
  },
  {
    expectedPattern: /\bnewsies\s+ataquenlos\b/,
    references: ['Music, a por ellos', 'Newsies, a por ellos'],
  },
  {
    expectedPattern: /^crutchie$/,
    references: ['Croati'],
  },
  {
    expectedPattern: /\bquieres\s+ver\s+lugar.*newsies\s+exprimidos.*bocota.*fallado/,
    references: [
      'Quieres ver lo que yo veo. Que te parece esto. Newsies exprimidos. Todo por mi bocaza, les he fallado a todos.',
    ],
  },
  {
    expectedPattern: /\bpoco\s+diferente.*donde.*creciste\b/,
    references: ['Un lugar muy distinto donde tu creciste'],
  },
  {
    expectedPattern: /\byo\s+no\s+dije\s+nada\s+sobre\b/,
    references: ['No quise decir nada sobre'],
  },
  {
    expectedPattern: /\bno\s+pense.*tenia.*hacerlo.*tratando.*traidora\b/,
    references: [
      'Nunca pense que tenia que habertelo preguntado, quizas si hubiera sabido que estaba tratando con una traidora',
    ],
  },
  {
    expectedPattern: /\bsolo\s+hay\s+problema.*no\s+tenemos\s+forma\s+imprimirlo\b/,
    references: ['Solo se me ocurre un problema. No tenemos como imprimirlo'],
  },
  {
    expectedPattern: /\bde\s+que\s+va\s+esto.*me\s+estoy\s+enganando.*hay\s+algo\b/,
    references: [
      'Espera. Para. De que va esto. Me estoy enganando a mi mismo o es que realmente hay algo',
    ],
  },
  {
    expectedPattern: /\bno\s+pero\s+si.*bastante\s+miedo\b/,
    references: ['Pero si, bastante miedo tu'],
  },
  {
    expectedPattern: /\bsin\s+problema\s+gobernador.*huelga\s+resuelta.*ponga\s+camino\b/,
    references: [
      'Espera, tranquilo senor Gobernador. Una vez terminada la huelga es probable que me ponga en camino',
    ],
  },
  {
    expectedPattern: /\bahorra\s+aliento.*inutil\b/,
    references: ['Ahorrate el aliento. Es inutil'],
  },
  {
    expectedPattern: /\bdave.*cabeza.*paliza.*pulitzer.*poli.*matones\b/,
    references: ['Ellos nos dieron la paliza. Llamo a la poli y matones'],
  },
];

const getEquivalentLineReferences = (expectedText: string) => {
  const normalizedExpectedText = normalizeSpeechText(expectedText);

  return EQUIVALENT_LINE_REFERENCES.flatMap(({ expectedPattern, references }) =>
    expectedPattern.test(normalizedExpectedText) ? references : []
  );
};

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

const getTailTokens = (tokens: string[], wordCount: number) =>
  tokens.slice(-Math.min(wordCount, tokens.length));

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

const getFinalPhraseScore = (referenceText: string, heardText: string) => {
  const referenceTokens = tokenize(referenceText);
  const heardTokens = tokenize(heardText);
  const finalReferenceTokens = getTailTokens(referenceTokens, FLUENT_FINAL_WORD_COUNT);
  const heardTailTokens = getTailTokens(
    heardTokens,
    finalReferenceTokens.length + FLUENT_FINAL_HEARD_EXTRA_WORDS
  );

  if (!finalReferenceTokens.length || !heardTailTokens.length) {
    return {
      finalPhraseScore: 0,
      finalPhraseWordCount: finalReferenceTokens.length,
    };
  }

  return {
    finalPhraseScore:
      getLongestCommonSubsequenceLength(finalReferenceTokens, heardTailTokens) /
      finalReferenceTokens.length,
    finalPhraseWordCount: finalReferenceTokens.length,
  };
};

const finalPhraseAppearsBeforeEnding = (referenceText: string) => {
  const referenceTokens = tokenize(referenceText);
  const finalReferenceTokens = getTailTokens(referenceTokens, FLUENT_FINAL_WORD_COUNT);
  const finalStartIndex = referenceTokens.length - finalReferenceTokens.length;

  if (finalReferenceTokens.length < 4 || finalStartIndex <= 0) {
    return false;
  }

  for (let startIndex = 0; startIndex < finalStartIndex; startIndex += 1) {
    const hasSameSequence = finalReferenceTokens.every((token, offset) =>
      tokensMatch(referenceTokens[startIndex + offset], token)
    );

    if (hasSameSequence) {
      return true;
    }
  }

  return false;
};

const getEmptyResult = (referenceText: string, referenceIndex: number): LineMatchResult => ({
  score: 0,
  referenceText,
  referenceIndex,
  coverageScore: 0,
  orderScore: 0,
  finalScore: 0,
  finalPhraseScore: 0,
  finalPhraseWordCount: 0,
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
  const { finalPhraseScore, finalPhraseWordCount } = getFinalPhraseScore(referenceText, heardText);
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
    finalPhraseScore,
    finalPhraseWordCount,
    precisionScore,
    negationPenaltyApplied,
  };
};

export const scoreLineMatch = (
  expectedText: string,
  heardText: string,
  acceptedVariants: string[] = []
) => {
  const references = [
    expectedText,
    ...getEquivalentLineReferences(expectedText),
    ...acceptedVariants.filter((variant) => variant.trim()),
  ];

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
) => Boolean(getAutomaticLineMatchReason(expectedText, heardText, result));

export const getAutomaticLineMatchReason = (
  expectedText: string,
  heardText: string,
  result: LineMatchResult
): AutomaticLineMatchReason | null => {
  const expectedTokens = getContentTokens(result.referenceText || expectedText);
  const heardTokens = getContentTokens(heardText);

  if (!heardTokens.length) {
    return null;
  }

  const hasNegationMismatch = getNegationCount(expectedTokens) !== getNegationCount(heardTokens);

  if (expectedTokens.length <= 2) {
    return !hasNegationMismatch && result.coverageScore >= 1 && result.precisionScore >= 0.5
      ? 'global_score'
      : null;
  }

  const passesMainThreshold =
    !hasNegationMismatch &&
    result.score >= INTELLIGENT_AUTO_ADVANCE_THRESHOLD &&
    result.coverageScore >= 0.72 &&
    result.finalScore >= 0.55;

  if (passesMainThreshold) {
    return 'global_score';
  }

  const passesHighFinalConfidence =
    !hasNegationMismatch &&
    result.score >= 0.82 &&
    result.coverageScore >= 0.75 &&
    result.finalScore >= 1 &&
    result.precisionScore >= 0.65;

  if (passesHighFinalConfidence) {
    return 'high_final_confidence';
  }

  const passesStrongCoverage =
    !hasNegationMismatch &&
    result.score >= 0.84 &&
    result.coverageScore >= 0.85 &&
    result.precisionScore >= 0.75 &&
    result.orderScore >= 0.8;

  if (passesStrongCoverage) {
    return 'strong_coverage';
  }

  const passesShortFlexible =
    expectedTokens.length >= 3 &&
    expectedTokens.length <= 5 &&
    result.precisionScore >= 0.45 &&
    result.orderScore >= 0.4 &&
    (
      (result.finalPhraseScore >= 0.8 && result.coverageScore >= 0.6) ||
      (
        result.score >= 0.78 &&
        result.coverageScore >= 0.8 &&
        result.precisionScore >= 0.75 &&
        result.orderScore >= 0.75
      )
    );

  if (passesShortFlexible) {
    return 'short_flexible';
  }

  const hasRepeatedFinalPhrase = finalPhraseAppearsBeforeEnding(
    result.referenceText || expectedText
  );

  const passesFluentFinal =
    expectedTokens.length >= FLUENT_FINAL_MIN_CONTENT_TOKENS &&
    result.finalPhraseWordCount >= 4 &&
    result.finalPhraseScore >= 0.8 &&
    !hasRepeatedFinalPhrase &&
    result.coverageScore >= 0.6 &&
    result.precisionScore >= 0.5 &&
    result.orderScore >= 0.45;

  if (passesFluentFinal) {
    return 'fluent_final';
  }

  const passesReplicaClosure =
    expectedTokens.length >= 4 &&
    result.finalPhraseWordCount >= 4 &&
    result.finalPhraseScore >= 0.8 &&
    !hasRepeatedFinalPhrase &&
    result.precisionScore >= 0.45 &&
    result.orderScore >= 0.25 &&
    (result.coverageScore >= 0.35 || result.finalScore >= 1);

  return passesReplicaClosure ? 'replica_closure' : null;
};

export const isNextLineCommand = (heardText: string) => {
  const normalizedText = normalizeSpeechText(heardText);
  const tokens = normalizedText.split(' ').filter(Boolean);

  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  return NEXT_LINE_COMMANDS.some((command) => normalizeSpeechText(command) === normalizedText);
};

export const getGoodLineCommandAcceptedText = (heardText: string) => {
  const normalizedText = normalizeSpeechText(heardText);
  const tokens = normalizedText.split(' ').filter(Boolean);

  if (!tokens.length) {
    return null;
  }

  if (tokens.length <= 6 && commandMatches(normalizedText, GOOD_LINE_COMMANDS)) {
    return '';
  }

  if (tokens.length > 120) {
    return null;
  }

  return splitTrailingCommand(heardText, GOOD_LINE_COMMANDS);
};

export const inferSpeechRecognitionLanguage = (lineText: string) => {
  const tokens = tokenize(lineText);
  const uniqueTokens = new Set(tokens);
  const englishHints = [
    'about',
    'after',
    'all',
    'another',
    'and',
    'back',
    'bath',
    'be',
    'because',
    'been',
    'before',
    'cant',
    'come',
    'could',
    'did',
    'do',
    'dont',
    'down',
    'get',
    'go',
    'got',
    'had',
    'has',
    'have',
    'he',
    'her',
    'here',
    'him',
    'his',
    'home',
    'if',
    'just',
    'know',
    'like',
    'look',
    'make',
    'mother',
    'my',
    'never',
    'now',
    'out',
    'over',
    'right',
    'see',
    'she',
    'should',
    'so',
    'steal',
    'surprise',
    'take',
    'tell',
    'that',
    'thats',
    'the',
    'their',
    'them',
    'then',
    'there',
    'this',
    'thought',
    'time',
    'up',
    'was',
    'we',
    'were',
    'want',
    'when',
    'what',
    'where',
    'why',
    'will',
    'with',
    'world',
    'would',
    'youll',
    'you',
    'your',
    'zoo',
  ];
  const spanishHints = [
    'chicos',
    'claro',
    'como',
    'dices',
    'donde',
    'iremos',
    'para',
    'pero',
    'porque',
    'quiero',
    'senorita',
    'tienes',
    'usted',
  ];
  const englishScore = englishHints.filter((hint) => uniqueTokens.has(hint)).length;
  const spanishScore = spanishHints.filter((hint) => uniqueTokens.has(hint)).length;
  const meaningfulTokenCount = tokens.filter(
    (token) => !STOP_WORDS.has(token) && !FILLER_WORDS.has(token)
  ).length;
  const englishRatio = englishScore / Math.max(meaningfulTokenCount, 1);

  return englishScore >= 2 && englishScore > spanishScore && englishRatio >= 0.28
    ? 'en-US'
    : 'es-ES';
};
