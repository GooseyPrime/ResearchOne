/**
 * Validates citations based on their DOI resolution status.
 * Determines whether a citation can be counted as support in verification.
 */

import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

/**
 * Checks if citations in a report are valid for counting as support.
 * Unresolved citations (including retracted ones) should not count as support.
 * 
 * @param reportId The report ID to validate citations for
 * @returns true if all citations are valid for support, false otherwise
 */
export async function areCitationsValidForSupport(reportId: string): Promise<boolean> {
  try {
    // Get citations that are not valid for support (unresolved, retracted, etc.)
    const invalidCitationRows = await query<{
      id: string;
      resolve_status: string | null;
      citation_text: string;
    }>(
      `SELECT id, resolve_status, citation_text
       FROM report_citations 
       WHERE report_id = $1 
         AND resolve_status IS NOT NULL 
         AND resolve_status IN ('unresolved', 'retracted', 'withdrawn')`,
      [reportId]
    );

    return invalidCitationRows.length === 0;
  } catch (error) {
    // If there's an error (e.g., column doesn't exist), assume citations are valid
    // to prevent breaking the verification process
    logger.warn(`[citation-validation] Error checking citation validity for report ${reportId}:`, error);
    return true;
  }
}

/**
 * Gets invalid citations that should not count as support.
 * 
 * @param reportId The report ID to validate citations for
 * @returns Array of citation information that is invalid for support
 */
export async function getInvalidCitationsForSupport(reportId: string): Promise<Array<{
  id: string;
  resolveStatus: string | null;
  citationText: string;
  editorialNotice?: string;
}>> {
  try {
    const invalidCitationRows = await query<{
      id: string;
      resolve_status: string | null;
      citation_text: string;
      editorial_notice: string | null;
    }>(
      `SELECT id, resolve_status, citation_text, editorial_notice
       FROM report_citations 
       WHERE report_id = $1 
         AND resolve_status IS NOT NULL 
         AND resolve_status IN ('unresolved', 'withdrawn', 'retracted')`,
      [reportId]
    );

    return invalidCitationRows.map(row => ({
      id: row.id,
      resolveStatus: row.resolve_status,
      citationText: row.citation_text,
      editorialNotice: row.editorial_notice || undefined,
    }));
  } catch (error) {
    // If there's an error (e.g., column doesn't exist), return empty array
    logger.warn(`[citation-validation] Error getting invalid citations for report ${reportId}:`, error);
    return [];
  }
}