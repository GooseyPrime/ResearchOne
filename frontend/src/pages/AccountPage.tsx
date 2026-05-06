import { UserProfile } from '@clerk/clerk-react';

export default function AccountPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-r1-bg px-4 py-12">
      <UserProfile path="/account" routing="path" />
    </div>
  );
}
