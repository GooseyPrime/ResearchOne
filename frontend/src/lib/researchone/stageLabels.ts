/**
 * What a run is doing, in words a reader understands (upgrade plan, slice 5
 * item 8). The pipeline names its stages for itself ("retriever_analysis",
 * "epistemic_persistence"); the live progress view shows these words instead.
 * An unknown stage is "Working", never the raw id. The checking step's name is
 * read from the registry of customer-facing names.
 */
import { DOUBLE_CHECK } from '../../content/customerOptions';

const DOUBLE_CHECK_NAME = DOUBLE_CHECK.name;

const STAGE_WORDS: Record<string, string> = {
  queued: 'Waiting to start',
  started: 'Starting',
  starting: 'Starting',
  plan_generation: 'Planning the research',
  planner: 'Planning the research',
  planning: 'Planning the research',
  plan_pending_confirmation: 'Waiting for your go-ahead',
  sleuth: 'Searching sources',
  discovery: 'Searching sources',
  ingestion: 'Reading sources',
  retriever: 'Gathering passages',
  retrieval: 'Gathering passages',
  retriever_analysis: 'Reading the passages',
  quantitative: 'Checking the figures',
  reasoner: 'Working through the evidence',
  reasoning: 'Working through the evidence',
  double_check: DOUBLE_CHECK_NAME,
  challenge: DOUBLE_CHECK_NAME,
  synthesizer: 'Writing the report',
  synthesis: 'Writing the report',
  verifier: 'Checking the report',
  verification: 'Checking the report',
  plain_language: 'Writing the plain-language version',
  saving: 'Saving the report',
  // A revision of a finished report.
  revision: 'Revising the report',
  attachments: 'Reading the added material',
  intake: 'Reading the revision request',
  location: 'Finding the affected sections',
  rewriting: 'Rewriting the affected sections',
  citation_integrity: 'Checking the citations',
  persistence: 'Saving the revised report',
  epistemic_persistence: 'Saving the findings',
  running: 'Working',
  completed: 'Done',
  // The stage the pipeline emits with its last, 100% event.
  done: 'Done',
  failed: 'Stopped',
  aborted: 'Stopped',
  cancelled: 'Cancelled',
};

export function readerStageLabel(stage: string | null | undefined): string {
  return STAGE_WORDS[(stage ?? '').trim().toLowerCase()] ?? 'Working';
}

/** Every stage id with its reader words, for the test that none shows through raw. */
export const READER_STAGE_WORDS: Readonly<Record<string, string>> = STAGE_WORDS;
