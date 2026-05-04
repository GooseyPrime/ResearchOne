/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Vite built-in vars (also declared by vite/client when installed — interface merges cleanly)
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  // App-specific vars
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_EXPORTS_BASE_URL?: string;
}

// Fallback: resolves import.meta.env when vite package is not installed locally.
// Merges with vite/client's declaration when vite IS installed (no conflict).
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// CSS side-effect imports used in main.tsx
declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}

// Minimal fallback for react-dom/client when @types/react-dom is not installed locally.
// Overridden by the real @types/react-dom types in CI.
declare module 'react-dom/client' {
  import * as ReactDOM from 'react-dom';
  export = ReactDOM;
}
