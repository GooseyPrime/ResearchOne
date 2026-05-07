/**
 * Deployment mode configuration.
 *
 * Two modes:
 * - 'b2c_shared': default multi-tenant B2C deployment
 * - 'sovereign': single-tenant enterprise deployment with InTellMe client excluded
 */

export type DeploymentMode = 'b2c_shared' | 'sovereign';

export const DEPLOYMENT_MODE: DeploymentMode =
  (process.env.DEPLOYMENT_MODE as DeploymentMode) ?? 'b2c_shared';

export const EXCLUDE_INTELLME_CLIENT =
  process.env.EXCLUDE_INTELLME_CLIENT === 'true' ||
  DEPLOYMENT_MODE === 'sovereign';

export const isSovereignDeployment = DEPLOYMENT_MODE === 'sovereign';
