/**
 * AUDIT (epistemic): Uses pdf-parse only (no LLM/OCR). Whitespace normalization does not rewrite claims.
 * If vision/OCR LLMs are added later, use withPreambleAndFidelity from constants/prompts.ts for system prompts.
 */

import pdfParse from 'pdf-parse';
import { logger } from '../../utils/logger';

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  info: Record<string, unknown>;
  metadata: {
    pageCount: number;
    pdfVersion?: string;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modDate?: string;
  };
}

/**
 * Extract plain text from a PDF buffer.
 * Normalises whitespace and preserves page breaks as double newlines.
 */
export async function extractPdf(buffer: Buffer): Promise<PdfExtractionResult> {
  const data = await pdfParse(buffer);

  // Normalize whitespace: collapse runs of spaces, preserve paragraph breaks
  const text = data.text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')        // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')     // collapse excessive blank lines
    .trim();

  const info = (data.info ?? {}) as Record<string, unknown>;

  logger.debug(`PDF extracted: ${data.numpages} pages, ${text.length} chars`);

  return {
    text,
    pageCount: data.numpages,
    info,
    metadata: {
      pageCount: data.numpages,
      pdfVersion: String(data.version ?? ''),
      title: typeof info['Title'] === 'string' ? info['Title'] : undefined,
      author: typeof info['Author'] === 'string' ? info['Author'] : undefined,
      subject: typeof info['Subject'] === 'string' ? info['Subject'] : undefined,
      keywords: typeof info['Keywords'] === 'string' ? info['Keywords'] : undefined,
      creator: typeof info['Creator'] === 'string' ? info['Creator'] : undefined,
      producer: typeof info['Producer'] === 'string' ? info['Producer'] : undefined,
      creationDate: typeof info['CreationDate'] === 'string' ? info['CreationDate'] : undefined,
      modDate: typeof info['ModDate'] === 'string' ? info['ModDate'] : undefined,
    },
  };
}
