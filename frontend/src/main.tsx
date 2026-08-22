import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { assertSplitDeploymentEnv } from './config/splitDeployment';
import ClerkApiSessionBridge from './components/auth/ClerkApiSessionBridge';

assertSplitDeploymentEnv();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 2,
    },
  },
});

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

// The hard failure for a missing or development-instance Clerk key lives in
// `vite.config.ts`, at BUILD time, and only for a real production deploy.
//
// It used to throw here instead. Module scope runs before `createRoot`, so the
// throw did not fail the build — it rendered nothing at all, on every route,
// including the marketing pages that never touch Clerk. It surfaced as a build
// failure only because the prerender step notices an empty `#root`, which broke
// every preview deploy (where a test key is the correct choice) and would have
// white-screened production had prerendering ever been removed.
//
// What is left here is diagnosis, not enforcement: loud in the console, fatal
// to nothing.
if (import.meta.env.PROD && !String(clerkPublishableKey).trim()) {
  console.error(
    '[ResearchOne] VITE_CLERK_PUBLISHABLE_KEY is unset in this production build. ' +
      'Sign-in will not work. Set it in the Vercel project and redeploy.'
  );
} else if (import.meta.env.PROD && String(clerkPublishableKey).trim().startsWith('pk_test_')) {
  console.info(
    '[ResearchOne] Auth is served by a Clerk development instance (pk_test_*). ' +
      'This is the current, deliberate configuration while on Clerk’s free plan.'
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ClerkApiSessionBridge>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary><App /></ErrorBoundary>
        </QueryClientProvider>
      </ClerkApiSessionBridge>
    </ClerkProvider>
  </React.StrictMode>
);
