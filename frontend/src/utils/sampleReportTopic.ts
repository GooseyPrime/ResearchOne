/** Labels for known `topic=` slugs on the sample report page. */
export const SAMPLE_REPORT_TOPIC_LABELS: Record<string, string> = {
  investigative: 'Investigative mode — narrative and incentive tracing',
  'general-epistemic': 'General Epistemic — contested evidence balance',
  'anomaly-correlation': 'Anomaly Correlation — weak-signal linkage',
  'patent-gap': 'Patent / Technical Gap — prior-art landscape mapping',
};

/** Canonical `topic` slug; accepts legacy `mode=` query for older links. */
export function resolveSampleReportTopic(params: URLSearchParams): string {
  const fromTopic = params.get('topic')?.trim() ?? '';
  if (fromTopic) return fromTopic;
  const mode = (params.get('mode') ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (mode === 'investigative') return 'investigative';
  if (mode === 'anomaly-correlation') return 'anomaly-correlation';
  if (mode === 'patent' || mode === 'patent-gap') return 'patent-gap';
  return '';
}
