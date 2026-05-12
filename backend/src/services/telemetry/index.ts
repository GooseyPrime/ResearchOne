/**
 * Cost telemetry sidecar — public surface.
 *
 * See:
 *   .cursor/rules/25-cost-sidecar-and-unit-economics.mdc
 *   docs/COST_SIDECAR_DESIGN.md
 *   docs/ResearchOne - Work Order U.md
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
