/**
 * ResearchOne Export Links Builder
 * Delegates to resolveExportUrl from the authenticated API utilities.
 */

import { resolveExportUrl } from '@/utils/api';

export type ExportFileType = 'pdf' | 'json' | 'md' | 'html';

export interface ExportLinkOptions {
  filename: string;
  type?: ExportFileType;
  download?: boolean;
}

export function buildExportUrl(filename: string): string {
  if (!filename) return '';
  return resolveExportUrl(filename);
}

export function buildExportLink(options: ExportLinkOptions): string {
  const { filename, download } = options;
  let url = buildExportUrl(filename);
  if (download && url) {
    url += url.includes('?') ? '&download=1' : '?download=1';
  }
  return url;
}

export function getExportFilename(reportId: string, type: ExportFileType): string {
  return `report-${reportId}.${type}`;
}

export function buildReportExportLinks(reportId: string): Record<ExportFileType, string> {
  const types: ExportFileType[] = ['pdf', 'json', 'md', 'html'];
  return types.reduce(
    (acc, type) => {
      acc[type] = buildExportUrl(getExportFilename(reportId, type));
      return acc;
    },
    {} as Record<ExportFileType, string>,
  );
}

export function isExportsConfigured(): boolean {
  return Boolean(import.meta.env.VITE_EXPORTS_BASE_URL);
}

export function getExportsBaseUrl(): string {
  return import.meta.env.VITE_EXPORTS_BASE_URL || '(not configured - using relative paths)';
}

export default {
  buildExportUrl,
  buildExportLink,
  buildReportExportLinks,
  getExportFilename,
  isExportsConfigured,
  getExportsBaseUrl,
};
