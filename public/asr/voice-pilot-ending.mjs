import { getAutomaticLineMatchReason, normalizeSpeechText, scoreLineMatch } from './line-matching.mjs';

export const hasCompleteLiveLine = (expected, heard) => {
  const match = scoreLineMatch(expected, heard);
  if (!getAutomaticLineMatchReason(expected, heard, match) || match.negationPenaltyApplied) return false;
  const words = value => normalizeSpeechText(value).trim().split(/\s+/).filter(Boolean);
  const reference = words(match.referenceText || expected);
  const actual = words(heard);
  if (!reference.length || !actual.length) return false;
  if (actual.length < reference.length && actual.every((word, index) => word === reference[index])) return false;
  const length = Math.min(reference.length, reference.length > 6 ? 3 : 2);
  const ending = reference.slice(-length);
  const last = actual.slice(-length);
  if (last.length !== length) return false;
  if (ending.some((word, index) => word !== last[index])) {
    const tail = scoreLineMatch(ending.join(' '), last.join(' '));
    if (tail.score !== 1 || tail.finalScore !== 1 || tail.negationPenaltyApplied) return false;
  }
  const repeated = reference.slice(0, -length).some((_, index) => ending.every((word, offset) => reference[index + offset] === word));
  return !repeated || match.coverageScore === 1 && actual.length >= reference.length;
};
