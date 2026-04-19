import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

let loadEnvCompleted = false;
let cachedRepoRoot: string | null = null;
let resolvedEnvFilePath: string | null = null;

function findRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'backend', 'package.json');
    if (fs.existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `Could not find ResearchOne repo root (backend/package.json) starting from ${startDir}`
  );
}

export function getRepoRoot(): string {
  if (!cachedRepoRoot) {
    cachedRepoRoot = findRepoRoot(__dirname);
  }
  return cachedRepoRoot;
}

/** Absolute path of the env file that was loaded, or null if none (non-production missing file). */
export function getLoadedEnvFilePath(): string | null {
  return resolvedEnvFilePath;
}

/**
 * Loads dotenv from ENV_FILE or backend/.env (repo-relative). Idempotent.
 * Production: missing file throws. development/test: missing file logs a warning only.
 */
export function loadEnv(): void {
  if (loadEnvCompleted) {
    return;
  }

  const nodeEnv = (process.env.NODE_ENV || 'development').trim();
  const repoRoot = getRepoRoot();

  let envPath: string;
  if (process.env.ENV_FILE) {
    envPath = path.isAbsolute(process.env.ENV_FILE)
      ? process.env.ENV_FILE
      : path.resolve(process.cwd(), process.env.ENV_FILE);
  } else {
    envPath = path.join(repoRoot, 'backend', '.env');
  }

  const exists = fs.existsSync(envPath);

  if (!exists) {
    // NODE_ENV from the process environment (PM2/shell), not from .env — file is missing.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env file for production: ${envPath}`);
    }
    console.warn(`[loadEnv] Env file not found (${nodeEnv}); continuing without dotenv: ${envPath}`);
    resolvedEnvFilePath = null;
    loadEnvCompleted = true;
    return;
  }

  dotenv.config({ path: envPath });
  resolvedEnvFilePath = path.resolve(envPath);
  loadEnvCompleted = true;
  console.info(`[loadEnv] Loaded environment from ${resolvedEnvFilePath}`);
}
