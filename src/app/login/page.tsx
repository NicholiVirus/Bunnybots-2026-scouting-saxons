'use client';
import Link from 'next/link';
import { LoginScreen } from '@/components/LoginScreen';
import { useAuth } from '@/sync/auth';
import { Button } from '@/components/ui';

export default function LoginPage() {
  const auth = useAuth();
  if (auth.status === 'signed_in')
    return (
      <div className="mx-auto max-w-sm py-10 text-center">
        <p className="mb-4">You are signed in as {auth.profile?.display_name || auth.email}.</p>
        <Link href="/">
          <Button variant="primary">Go to the app</Button>
        </Link>
      </div>
    );
  if (auth.status === 'local')
    return (
      <div className="mx-auto max-w-md py-10 text-center text-muted">
        <p>This build runs in local-only mode (no Supabase project configured), so there is nothing to sign in to.</p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="primary">Open the app</Button>
        </Link>
      </div>
    );
  return <LoginScreen />;
}
