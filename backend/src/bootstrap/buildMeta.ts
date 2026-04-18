import fs from 'fs';
import path from 'path';
import { getRepoRoot } from './loadEnv';

export type BuildMeta = {
  gitSha?: string;
  builtAt?: string;
  deployedBy?: string;
};

let cached: BuildMeta | null | undefined;
let cachedPackageVersion: string | undefined;

/**
 * Optional build-meta.json next to compiled output (backend/dist/build-meta.json), written at deploy time.
 */
export function getBuildMeta(): BuildMeta | null {
  if (cached !== undefined) {
    return cached;
  }
  const metaPath = path.join(__dirname, '..', 'build-meta.json');
  if (!fs.existsSync(metaPath)) {
    cached = null;
    return null;
  }
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as BuildMeta;
    cached = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Version from backend/package.json (repo layout). */
export function getBackendPackageVersion(): string {
  if (cachedPackageVersion !== undefined) {
    return cachedPackageVersion;
  }
  const pkgPath = path.join(getRepoRoot(), 'backend', 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    cachedPackageVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    cachedPackageVersion = '0.0.0';
  }
  return cachedPackageVersion;
}
