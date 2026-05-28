import type { ResearchRun } from './api';
import { isDeepResearchEngine } from './researchRunRoutes';

export type ResearchShellMode = 'standard' | 'deep';

export function runNeedsShellModeSwitch(
  run: ResearchRun,
  shellMode: ResearchShellMode
): boolean {
  const runIsDeep = isDeepResearchEngine(run.engine_version);
  return runIsDeep !== (shellMode === 'deep');
}
