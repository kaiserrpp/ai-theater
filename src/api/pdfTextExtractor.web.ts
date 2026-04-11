import type { ExtractedPdfLine, PdfExtractionCallbacks } from './pdfTextExtractor';

const PDFJS_WORKER_URL = 'https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';
const LINE_VERTICAL_TOLERANCE = 4;
const PAGE_EDGE_LINE_COUNT = 2;

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

const runCallback = async (callback?: () => void | Promise<void>) => {
  if (callback) {
    await callback();
  }
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const normalizeLineForComparison = (value: string) =>
  normalizeWhitespace(value)
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');

const joinItemsIntoLine = (items: PositionedTextItem[]) => {
  const sortedItems = [...items].sort((left, right) => left.x - right.x);
  let result = '';
  let previousEndX = 0;

  for (const [index, item] of sortedItems.entries()) {
    const needsSpace =
      index > 0 &&
      item.x - previousEndX > 1 &&
      !result.endsWith('-') &&
      !/^[,.;:!?)]/.test(item.text);

    result += `${needsSpace ? ' ' : ''}${item.text}`;
    previousEndX = item.x + item.width;
  }

  return normalizeWhitespace(
    result
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([\u00BF\u00A1(\[])\s+/g, '$1')
  );
};

const shouldRemoveRepeatedEdgeLine = (
  normalizedLine: string,
  edgeLineCounts: Map<string, number>,
  totalPages: number
) => normalizedLine.length > 0 && totalPages > 1 && (edgeLineCounts.get(normalizedLine) ?? 0) >= 2;

const groupItemsIntoLines = (items: PositionedTextItem[]) => {
  const groupedLines: { y: number; items: PositionedTextItem[] }[] = [];

  for (const item of items) {
    const existingLine = groupedLines.find((line) => Math.abs(line.y - item.y) <= LINE_VERTICAL_TOLERANCE);

    if (existingLine) {
      existingLine.items.push(item);
      existingLine.y = (existingLine.y + item.y) / 2;
      continue;
    }

    groupedLines.push({ y: item.y, items: [item] });
  }

  return groupedLines
    .sort((left, right) => right.y - left.y)
    .map((line) => joinItemsIntoLine(line.items))
    .filter(Boolean);
};

const isPdfTextItem = (item: unknown): item is PdfTextItem => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  return 'str' in item && 'transform' in item;
};

export const extractPdfLines = async (
  localUri: string,
  callbacks?: PdfExtractionCallbacks
): Promise<ExtractedPdfLine[]> => {
  await runCallback(() => callbacks?.onStatusChange?.('Leyendo PDF localmente...'));

  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc && !pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }

  const response = await fetch(localUri);
  const pdfData = await response.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: pdfData, useSystemFonts: true });
  const pdfDocument = await loadingTask.promise;
  const totalPages = pdfDocument.numPages;

  await runCallback(() =>
    callbacks?.onPagesReady?.(Array.from({ length: totalPages }, (_, index) => `Pagina ${index + 1}`))
  );

  const linesByPage: string[][] = [];

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    await runCallback(() => callbacks?.onPageStart?.(pageIndex - 1, totalPages));
    await runCallback(() => callbacks?.onStatusChange?.(`Extrayendo texto de la pagina ${pageIndex}/${totalPages}...`));

    const page = await pdfDocument.getPage(pageIndex);
    const textContent = await page.getTextContent();

    const textItems = textContent.items.reduce<PositionedTextItem[]>((accumulator, item) => {
      if (!isPdfTextItem(item)) {
        return accumulator;
      }

      if (!item.str.trim()) {
        return accumulator;
      }

      accumulator.push({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width ?? 0,
      });

      return accumulator;
    }, []);

    linesByPage.push(groupItemsIntoLines(textItems));
  }

  const edgeLineCounts = new Map<string, number>();

  for (const lines of linesByPage) {
    const edgeLines = [...lines.slice(0, PAGE_EDGE_LINE_COUNT), ...lines.slice(-PAGE_EDGE_LINE_COUNT)];
    for (const edgeLine of edgeLines) {
      const normalizedLine = normalizeLineForComparison(edgeLine);
      if (!normalizedLine) {
        continue;
      }

      edgeLineCounts.set(normalizedLine, (edgeLineCounts.get(normalizedLine) ?? 0) + 1);
    }
  }

  return linesByPage.flatMap((lines, pageIndex) =>
    lines
      .filter((line, lineIndex) => {
        const normalizedLine = normalizeLineForComparison(line);
        const isStandalonePageNumber = /^[\-\u2013\u2014]?\s*\d+\s*[\-\u2013\u2014]?$/.test(line);
        const isEdgeLine = lineIndex < PAGE_EDGE_LINE_COUNT || lineIndex >= lines.length - PAGE_EDGE_LINE_COUNT;

        if (isStandalonePageNumber) {
          return false;
        }

        if (isEdgeLine && shouldRemoveRepeatedEdgeLine(normalizedLine, edgeLineCounts, totalPages)) {
          return false;
        }

        return true;
      })
      .map((text) => ({
        pageNumber: pageIndex + 1,
        text,
      }))
  );
};
