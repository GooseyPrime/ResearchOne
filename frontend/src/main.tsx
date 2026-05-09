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
if (import.meta.env.PROD && !String(clerkPublishableKey).trim()) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required for production builds.');
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
