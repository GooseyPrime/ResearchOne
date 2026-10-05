/**
 * DOI resolver for existing citations in report_citations table.
 * Updates resolve_status and editorial_notice for citations that have DOIs.
 */

import { query, withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';
import { resolveDois, fetchCrossrefMetadata, doiResolveEnabled } from './doiResolve';

/**
 * Updates DOI resolution status for citations in a report.
 * This should be called after citations are initially mapped to check DOI availability.
 */
export async function updateCitationDoiStatus(reportId: string): Promise<void> {
  if (!doiResolveEnabled()) {
    logger.debug(`[doi-resolve] DOI resolution is disabled, skipping for report ${reportId}`);
    return;
  }

  try {
    // Get all citations for the report that have source URLs
    const citationRows = await query<{
      id: string;
      source_id: string | null;
      chunk_id: string;
    }>(
      `SELECT id, source_id, chunk_id 
       FROM report_citations 
       WHERE report_id = $1`,
      [reportId]
    );

    if (citationRows.length === 0) {
      logger.debug(`[doi-resolve] No citations found for report ${reportId}`);
      return;
    }

    // Get source URLs for the citations
    const chunkIds = citationRows.map(row => row.chunk_id);
    const chunkRows = await query<{
      id: string;
      source_url: string | null;
    }>(
      `SELECT id, source_url 
       FROM chunks 
       WHERE id = ANY($1::uuid[])`,
      [chunkIds]
    );

    const chunkByUrl = new Map(chunkRows.map(row => [row.id, row.source_url]));

    // Extract DOIs from source URLs
    const doiToCitationIds = new Map<string, string[]>();
    for (const row of citationRows) {
      const sourceUrl = chunkByUrl.get(row.chunk_id);
      if (sourceUrl) {
        const doiMatch = sourceUrl.match(/https?:\/\/doi\.org\/(10\.[^\/]+\/[^\s]+)/i);
        if (doiMatch) {
          const doi = decodeURIComponent(doiMatch[1]); // Decode in case of encoded characters
          if (!doiToCitationIds.has(doi)) {
            doiToCitationIds.set(doi, []);
          }
          doiToCitationIds.get(doi)?.push(row.id);
        }
      }
    }

    if (doiToCitationIds.size === 0) {
      logger.debug(`[doi-resolve] No DOIs found in citations for report ${reportId}`);
      return;
    }

    // Resolve all DOIs
    const dois = Array.from(doiToCitationIds.keys());
    logger.info(`[doi-resolve] Resolving ${dois.length} DOIs for report ${reportId}`);
    
    const resolutionResults = await resolveDois(dois);

    // Update citation statuses based on DOI resolution
    await withTransaction(async (client) => {
      for (let i = 0; i < dois.length; i++) {
        const doi = dois[i];
        const resolutionResult = resolutionResults[i];
        const citationIds = doiToCitationIds.get(doi) || [];

        // Get more detailed metadata from Crossref if DOI is resolved
        let detailedStatus = resolutionResult;
        if (resolutionResult.resolveStatus === 'resolved') {
          const crossrefMeta = await fetchCrossrefMetadata(doi);
          
          if (crossrefMeta.retracted) {
            detailedStatus = {
              ...resolutionResult,
              resolveStatus: 'retracted',
              editorialNotice: crossrefMeta.retractionNotice || 'Source has been retracted',
            };
          } else if (crossrefMeta.corrected) {
            detailedStatus = {
              ...resolutionResult,
              resolveStatus: 'corrected',
              editorialNotice: crossrefMeta.correctionNotice || 'Source has been corrected',
            };
          } else if (crossrefMeta.withdrawn) {
            detailedStatus = {
              ...resolutionResult,
              resolveStatus: 'withdrawn',
              editorialNotice: crossrefMeta.withdrawalNotice || 'Source has been withdrawn',
            };
          }
        }

        // Update all citations with this DOI
        for (const citationId of citationIds) {
          try {
            await client.query(
              `UPDATE report_citations 
               SET resolve_status = $1, editorial_notice = $2
               WHERE id = $3`,
              [
                detailedStatus.resolveStatus,
                detailedStatus.editorialNotice || null,
                citationId
              ]
            );
          } catch (updateErr) {
            const code = (updateErr as { code?: string })?.code;
            if (code === '42703') {
              // Column doesn't exist, log and continue
              logger.warn(`[doi-resolve] Columns resolve_status/editorial_notice don't exist, skipping update for citation ${citationId}`);
              continue;
            } else {
              throw updateErr;
            }
          }
        }
      }
    });

    logger.info(`[doi-resolve] Updated DOI status for ${citationRows.length} citations in report ${reportId}`);
  } catch (error) {
    logger.warn(`[doi-resolve] Failed to update DOI status for report ${reportId}:`, error);
    // Don't throw - this shouldn't fail the entire research run
  }
}