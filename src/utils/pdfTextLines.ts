import type { ExtractedPdfLine } from '../api/pdfTextExtractor';

const EDGE_LINE_COUNT = 2;
const normalizeForComparison = (value: string) => value.replace(/\s+/g, ' ').trim()
  .toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ');

const isCastMemberName = (value: string) => value.length <= 40 && value.trim().split(/\s+/u).length <= 2 &&
  /^[\p{Lu}\p{M}][\p{Lu}\p{M}\p{N} .'’\-]*$/u.test(value);

// Never remove edge lines which are also body text or declared character names.
// Otherwise a cue can disappear at a page boundary and its text go to the wrong actor.
export const filterPdfPageLines = (pages: string[][]): ExtractedPdfLine[] => {
  const edgePages = new Map<string, Set<number>>();
  const bodyLines = new Set<string>();
  const declaredSpeakers = new Set<string>();
  for (const line of pages.flat()) {
    const names = line.split(/,\s*|\.\s+|\s+(?:Y|E|AND|&)\s+/u).map((name) => name.trim());
    if (names.length >= 2 && names.every(isCastMemberName)) names.forEach((name) => declaredSpeakers.add(normalizeForComparison(name)));
  }
  pages.forEach((lines, page) => {
    lines.forEach((line, index) => {
      const normalized = normalizeForComparison(line);
      if (!normalized) return;
      const atEdge = index < EDGE_LINE_COUNT || index >= lines.length - EDGE_LINE_COUNT;
      if (atEdge) {
        const occurrences = edgePages.get(normalized) ?? new Set<number>();
        occurrences.add(page);
        edgePages.set(normalized, occurrences);
      } else bodyLines.add(normalized);
    });
  });
  return pages.flatMap((lines, page) => lines.filter((line, index) => {
    if (/^[\-\u2013\u2014]?\s*\d+\s*[\-\u2013\u2014]?$/.test(line)) return false;
    const normalized = normalizeForComparison(line);
    const cueName = normalizeForComparison(line.replace(/\s*[\[(].*[\])]\s*$/u, ''));
    const atEdge = index < EDGE_LINE_COUNT || index >= lines.length - EDGE_LINE_COUNT;
    return !atEdge || bodyLines.has(normalized) || declaredSpeakers.has(cueName) || (edgePages.get(normalized)?.size ?? 0) < 2;
  }).map((text) => ({ pageNumber: page + 1, text })));
};
