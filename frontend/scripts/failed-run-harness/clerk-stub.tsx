/**
 * Stands in for `@clerk/react` in the harness build only (see README.md): a
 * signed-in session with no network. Never part of the application build.
 */
import type { ReactNode } from 'react';

const auth = {
  isLoaded: true,
  isSignedIn: true,
  userId: 'user_harness',
  orgId: null,
  sessionId: 'session_harness',
  getToken: async () => 'harness-token',
  signOut: async () => {},
};
const user = {
  isLoaded: true,
  isSignedIn: true,
  user: {
    id: 'user_harness',
    fullName: 'Harness',
    firstName: 'Harness',
    primaryEmailAddress: { emailAddress: 'harness@example.com' },
    emailAddresses: [],
    publicMetadata: {},
    unsafeMetadata: {},
  },
};

export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export const useAuth = () => auth;
export const useUser = () => user;
export const SignIn = () => null;
export const SignUp = () => null;
export const UserProfile = () => null;
export const UserButton = () => null;
