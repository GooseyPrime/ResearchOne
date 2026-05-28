/**
 * SampleReportPage - Public sample report page
 */

import { R1Shell } from '@/components/r1-shell/R1Shell';
import { SampleReportView } from '@/components/r1-reports/SampleReportView';

export default function SampleReportPage() {
  return (
    <R1Shell variant="public">
      <SampleReportView />
    </R1Shell>
  );
}