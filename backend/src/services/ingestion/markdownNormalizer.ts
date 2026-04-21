/**
 * Markdown normalizer for ingestion.
 * Converts markdown syntax into clean plain text suitable for chunking
 * while preserving structural metadata about headings.
 * AUDIT (epistemic): No LLM calls — deterministic markdown stripping only. Raw wording is preserved aside from
 * explicit syntax removal (see EPISTEMIC_FIDELITY_DIRECTIVE in constants/prompts.ts if LLM extraction is added later).

 */

export interface MarkdownSection {
  level: number;
  heading: string;
  content: string;
}

export interface MarkdownNormalizationResult {
  text: string;
  sections: MarkdownSection[];
  metadata: {
    headingCount: number;
    codeBlockCount: number;
    linkCount: number;
    imageCount: number;
  };
}

/**
 * Normalise markdown to plain text for chunking.
 * Preserves headings as labelled sections, strips syntax.
 */
export function normalizeMarkdown(raw: string): MarkdownNormalizationResult {
  const lines = raw.split('\n');
  const sections: MarkdownSection[] = [];

  let currentHeading = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let codeBlockCount = 0;
  let inCodeBlock = false;
  let linkCount = 0;
  let imageCount = 0;

  const flushSection = () => {
    if (currentHeading || currentLines.length > 0) {
      sections.push({
        level: currentLevel,
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    // Track fenced code blocks
    if (/^```/.test(line) || /^~~~/.test(line)) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockCount++;
      }
      // Preserve code content as plain text, strip fence markers
      continue;
    }

    if (inCodeBlock) {
      currentLines.push(line);
      continue;
    }

    // ATX headings: # H1, ## H2, etc.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushSection();
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      continue;
    }

    // Setext headings (===, ---)
    const setextEq = /^={3,}\s*$/.test(line);
    const setextDash = /^-{3,}\s*$/.test(line);
    if ((setextEq || setextDash) && currentLines.length > 0) {
      const headingText = currentLines.pop() ?? '';
      flushSection();
      currentLevel = setextEq ? 1 : 2;
      currentHeading = headingText.trim();
      continue;
    }

    // Strip images — count them, extract alt text
    const imgStripped = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => {
      imageCount++;
      return alt ? `[image: ${alt}]` : '';
    });

    // Strip links — count them, keep link text
    const linkStripped = imgStripped.replace(/\[([^\]]+)\]\([^)]+\)/g, (_m, text) => {
      linkCount++;
      return text;
    });

    // Strip inline formatting: bold, italic, code, strikethrough
    const clean = linkStripped
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-*+]\s+/, '')   // unordered list markers
      .replace(/^\d+\.\s+/, '')   // ordered list markers
      .replace(/^>\s?/, '')        // blockquote markers
      .replace(/^---+$/, '')       // horizontal rules
      .replace(/\|/g, ' ')         // table pipes (basic)
      .trim();

    if (clean) currentLines.push(clean);
  }

  flushSection();

  // Build plain text from sections
  const textParts: string[] = [];
  for (const sec of sections) {
    if (sec.heading) textParts.push(sec.heading);
    if (sec.content) textParts.push(sec.content);
  }
  const text = textParts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    sections,
    metadata: {
      headingCount: sections.filter(s => s.heading).length,
      codeBlockCount,
      linkCount,
      imageCount,
    },
  };
}
