import { describe, it, expect } from 'vitest';
import { normalizeMarkdown } from '../services/ingestion/markdownNormalizer';

describe('markdownNormalizer', () => {
  it('strips ATX headings and returns plain text', () => {
    const md = `# Title\n\nSome content here.\n\n## Section\n\nMore content.`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('Title');
    expect(result.text).toContain('Some content here.');
    expect(result.text).toContain('More content.');
    expect(result.text).not.toContain('##');
  });

  it('strips bold and italic formatting', () => {
    const md = `**bold** and *italic* and __underscore__ and _single_`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('bold');
    expect(result.text).toContain('italic');
    expect(result.text).not.toContain('**');
    expect(result.text).not.toContain('__');
  });

  it('strips link syntax and keeps link text', () => {
    const md = `Click [here](https://example.com) for more.`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('here');
    expect(result.text).not.toContain('https://example.com');
    expect(result.metadata.linkCount).toBe(1);
  });

  it('extracts image alt text and counts images', () => {
    const md = `![alt text](image.png)`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('alt text');
    expect(result.metadata.imageCount).toBe(1);
  });

  it('counts headings correctly', () => {
    const md = `# H1\n\nContent.\n\n## H2\n\nMore.\n\n### H3\n\nEven more.`;
    const result = normalizeMarkdown(md);
    expect(result.metadata.headingCount).toBe(3);
    expect(result.sections).toHaveLength(3);
  });

  it('handles fenced code blocks without stripping content', () => {
    const md = `Some text.\n\n\`\`\`python\nprint("hello")\n\`\`\`\n\nAfter code.`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('Some text.');
    expect(result.text).toContain('After code.');
    expect(result.metadata.codeBlockCount).toBe(1);
  });

  it('strips blockquote markers', () => {
    const md = `> This is a blockquote`;
    const result = normalizeMarkdown(md);
    expect(result.text).toContain('This is a blockquote');
    expect(result.text).not.toContain('>');
  });

  it('returns empty text for empty input', () => {
    const result = normalizeMarkdown('');
    expect(result.text).toBe('');
  });

  it('ingestion succeeds for markdown: creates text and sections', () => {
    const md = `# Research Note\n\nThis is a **key finding** about the topic.\n\n## Methods\n\nWe used [standard protocols](https://example.com).`;
    const result = normalizeMarkdown(md);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.metadata.headingCount).toBe(2);
  });
});
