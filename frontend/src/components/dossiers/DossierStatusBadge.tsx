import clsx from 'clsx';
import { resolveRunDisplayState, RUN_TONE_CLASSES } from '../../utils/runStatusDisplay';

export default function DossierStatusBadge({
  status,
  gateStatus,
}: {
  status: string;
  gateStatus?: string | null;
}) {
  const display = resolveRunDisplayState({ status, gateStatus });
  const cls = RUN_TONE_CLASSES[display.tone].chip;
  return <span className={clsx('badge border text-[10px]', cls)}>{display.label}</span>;
}
