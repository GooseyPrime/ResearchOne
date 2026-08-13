/**
 * Markdown-table parsing and spreadsheet export helpers (WO-AB).
 *
 * Kept out of `ReportMarkdown.tsx` so that file exports only components
 * (react-refresh/only-export-components).
 *
 * CSV and TSV are deliberate export targets: both import natively into Excel
 * and Google Sheets, so no additional runtime dependency is required.
 */

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Pull plain text out of arbitrary React children (cells may contain marks/links). */
export function nodeText(node: unknown): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return nodeText(props?.children);
  }
  return '';
}

function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(value) ? `"${escaped}"` : escaped;
}

export function toCsv(table: ParsedTable): string {
  return [table.headers, ...table.rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function toTsv(table: ParsedTable): string {
  // Tab-separated content pastes into Sheets/Excel with columns preserved.
  const clean = (v: string) => v.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return [table.headers, ...table.rows].map((row) => row.map(clean).join('\t')).join('\n');
}

export function downloadCsv(table: ParsedTable, filename: string): void {
  // BOM so Excel detects UTF-8 and renders accented characters correctly.
  const blob = new Blob([`﻿${toCsv(table)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convert a rendered markdown `<table>` subtree into structured rows. */
export function parseTableNode(children: unknown): ParsedTable | null {
  const headers: string[] = [];
  const rows: string[][] = [];

  const walk = (node: unknown, inHead: boolean): void => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, inHead));
      return;
    }
    const el = node as { type?: unknown; props?: { children?: unknown } };
    const tag = typeof el.type === 'string' ? el.type : '';
    if (tag === 'thead') {
      walk(el.props?.children, true);
      return;
    }
    if (tag === 'tbody') {
      walk(el.props?.children, false);
      return;
    }
    if (tag === 'tr') {
      const cells: string[] = [];
      const collect = (n: unknown): void => {
        if (Array.isArray(n)) {
          n.forEach(collect);
          return;
        }
        if (n && typeof n === 'object') {
          const child = n as { type?: unknown; props?: { children?: unknown } };
          const childTag = typeof child.type === 'string' ? child.type : '';
          if (childTag === 'th' || childTag === 'td') {
            cells.push(nodeText(child.props?.children).trim());
            return;
          }
          collect(child.props?.children);
        }
      };
      collect(el.props?.children);
      if (inHead && headers.length === 0) headers.push(...cells);
      else rows.push(cells);
      return;
    }
    walk(el.props?.children, inHead);
  };

  walk(children, false);
  if (headers.length === 0 && rows.length > 0) {
    headers.push(...(rows.shift() ?? []));
  }
  if (headers.length === 0) return null;
  return { headers, rows };
}
