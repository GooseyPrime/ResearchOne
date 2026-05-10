/**
 * Operational scripts must not Bash-source `backend/.env` — the file is dotenv
 * format (KEY=value), not a shell script. Lines like `restart:` can be
 * misinterpreted as shell commands. Use `dotenv` via `src/bootstrap/loadEnv`
 * (also invoked when importing `src/config`).
 *
 * Call once before reading `process.env` for DATABASE_URL, OPENROUTER_API_KEY, etc.
 * Never print secret values.
 */
import { loadEnv } from '../src/bootstrap/loadEnv';

export function loadBackendEnv(): void {
  loadEnv();
}
