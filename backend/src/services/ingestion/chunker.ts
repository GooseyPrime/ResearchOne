/**
 * AUDIT (epistemic): Deterministic chunking only — no LLM boundaries or summaries. All sentences retained.
 * If semantic LLM chunking is added, instruct models not to drop "fringe" sentences; consider withPreamble.
 */

export interface ChunkerOptions {
  maxChunkSize: number;  // in characters
  overlap: number;       // overlap in characters
}

/**
 * Splits text into overlapping chunks using sentence-boundary awareness.
 */
export function chunkText(text: string, options: ChunkerOptions): string[] {
  const { maxChunkSize, overlap } = options;
  const chunks: string[] = [];

  // Split on paragraph boundaries first
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If adding this paragraph stays within limit
    if (currentChunk.length + paragraph.length + 2 <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      // Flush current chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxChunkSize) {
        const sentences = splitIntoSentences(paragraph);
        let sentenceChunk = '';

        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length + 1 <= maxChunkSize) {
            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
          } else {
            if (sentenceChunk.trim()) {
              chunks.push(sentenceChunk.trim());
            }
            // Handle very long sentences by hard-splitting
            if (sentence.length > maxChunkSize) {
              const hardChunks = hardSplit(sentence, maxChunkSize);
              chunks.push(...hardChunks);
              sentenceChunk = '';
            } else {
              sentenceChunk = sentence;
            }
          }
        }

        if (sentenceChunk.trim()) {
          currentChunk = sentenceChunk;
        } else {
          currentChunk = '';
        }
      } else {
        // Start new chunk with overlap from previous
        const prevChunk = chunks[chunks.length - 1] ?? '';
        const overlapText = prevChunk.slice(-overlap);
        currentChunk = (overlapText ? overlapText + '\n\n' : '') + paragraph;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 0);
}

function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
}

function hardSplit(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxSize));
    i += maxSize;
  }
  return chunks;
}
