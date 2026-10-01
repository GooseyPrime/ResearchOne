/**
 * Cost telemetry sidecar — public surface.
 *
 * See:
 *   .cursor/rules/25-cost-sidecar-and-unit-economics.mdc
 *   Rule 25
 *   Rule 25
 */
export {
  runScope,
  emitCallTelemetry,
  patchAgentExecutionsReportIdForRun,
  rolePhaseFor,
  type RunScopeContext,
  type EmitOptions,
  type PipelinePhase,
} from './costSidecar';

export {
  getModelPrice,
  computeCostUsd,
  type ModelPrice,
} from './pricingCatalog';
