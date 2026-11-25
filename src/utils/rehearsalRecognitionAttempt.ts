import { getAutomaticLineAdvanceDelay, getAutomaticLineMatchReason, normalizeSpeechText, scoreLineMatch } from './lineMatching';

export type RehearsalRecognitionAttemptSource = 'accumulated' | 'latest_utterance' | 'repeated_line';
const words = (value: string) => Array.from(value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu), match => ({
  value: match[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f'’]/g, ''), index: match.index!,
}));
const containsNegation = (value: string) => /\b(aint|cannot|cant|dont|jamas|never|no|not|nunca|sin|wont|tampoco|ni)\b/.test(value);
const sameWords = (left: string[], right: string[]) => left.length === right.length && left.every((word, index) => word === right[index]);

// The raw transcript is never rewritten. Only a complete new attempt can be
// evaluated independently; a continuation during a pause keeps all its words.
export const getRehearsalRecognitionAttempt = (input: {
  expectedText: string; transcript: string; acceptedVariants?: string[]; lineKey: string | null;
  interimTranscript?: string;
  allowRepeatedInterim?: boolean;
  allowLatestInterim?: boolean;
  lastUtterance?: { text: string; isFinal: boolean; lineKey: string | null } | null;
}) => {
  const { expectedText, transcript, acceptedVariants = [], lastUtterance } = input;
  const accumulated = { text: transcript, source: 'accumulated' as RehearsalRecognitionAttemptSource,
    match: scoreLineMatch(expectedText, transcript, acceptedVariants) };
  if (!input.lineKey || getAutomaticLineAdvanceDelay(expectedText, transcript, input.interimTranscript ?? '',
    accumulated.match, input.allowLatestInterim) !== null) return accumulated;
  const references = [expectedText, ...acceptedVariants].map(reference => words(reference).map(word => word.value)).filter(reference => reference.length);
  const prefixHasNegation = (prefix: string) => {
    let tokens = words(prefix).map(word => word.value);
    // Repeating the same complete negative line is not a contradictory "no".
    for (const reference of references) {
      for (let index = 0; index <= tokens.length - reference.length;) {
        if (sameWords(tokens.slice(index, index + reference.length), reference)) tokens.splice(index, reference.length);
        else index++;
      }
    }
    return containsNegation(tokens.join(' '));
  };
  const completeAttempt = (text: string, prefix: string, source: RehearsalRecognitionAttemptSource) => {
    const match = scoreLineMatch(expectedText, text, acceptedVariants);
    const opening = normalizeSpeechText(match.referenceText).split(' ').filter(Boolean).slice(0, 3);
    const heard = normalizeSpeechText(text).split(' ').filter(Boolean);
    if (prefixHasNegation(prefix) || !opening.length || !opening.every((word, index) => word === heard[index]) ||
      match.negationPenaltyApplied || match.score < .95 || match.coverageScore < .95 || match.orderScore < .95 ||
      match.precisionScore < .9 || match.finalScore < 1 ||
      !getAutomaticLineMatchReason(expectedText, text, match)) return null;
    return { text, source, match };
  };
  if (lastUtterance?.lineKey === input.lineKey && lastUtterance.text.trim() &&
      (lastUtterance.isFinal || input.allowLatestInterim && input.interimTranscript?.trim() === lastUtterance.text.trim())) {
    const text = lastUtterance.text.trim(), raw = transcript.trimEnd();
    if (raw.endsWith(` ${text}`)) {
      const selected = completeAttempt(text, raw.slice(0, -text.length), 'latest_utterance');
      if (selected) return selected;
    }
  }
  // A recognizer can put several repetitions in one result. Require two
  // consecutive exact copies at its end, never an arbitrary matching suffix.
  // iPhone continuous hypotheses may remain provisional until we close input.
  if (!input.interimTranscript?.trim() || input.allowRepeatedInterim) {
    const tokens = words(transcript);
    if (tokens.length <= 2000) for (const reference of references) {
      const length = reference.length;
      if (length < 2 || length > 100 || tokens.length < length * 2) continue;
      const end = tokens.map(word => word.value);
      if (!sameWords(end.slice(-length), reference) || !sameWords(end.slice(-length * 2, -length), reference)) continue;
      const at = tokens[tokens.length - length].index;
      const selected = completeAttempt(transcript.slice(at).trim(), transcript.slice(0, at), 'repeated_line');
      if (selected) return selected;
    }
  }
  return accumulated;
};
