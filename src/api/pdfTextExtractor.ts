export interface ExtractedPdfLine {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionCallbacks {
  onStatusChange?: (status: string) => void | Promise<void>;
  onPageStart?: (pageIndex: number, totalPages: number) => void | Promise<void>;
  onPagesReady?: (pages: string[]) => void | Promise<void>;
}

export const extractPdfLines = async (
  _localUri: string,
  _callbacks?: PdfExtractionCallbacks
): Promise<ExtractedPdfLine[]> => {
  throw new Error('La extraccion local de PDF solo esta disponible en la version web por ahora.');
};