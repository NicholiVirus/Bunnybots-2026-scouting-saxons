'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/sync/supabase';
import { initAuth, useAuth } from '@/sync/auth';
import { Spinner } from '@/components/ui';

/** OAuth / magic-link landing page. supabase-js exchanges ?code= automatically (PKCE). */
export default function AuthCallback() {
  const router = useRouter();
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initAuth();
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error_description') || params.get('error');
    if (err) setError(err);
    const t = setTimeout(async () => {
      const sb = getSupabase();
      const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
      if (!data.session && !err) setError('Sign-in link expired or opened in a different browser. Please sign in again.');
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (auth.status === 'signed_in') router.replace('/');
  }, [auth.status, router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      {error ? (
        <>
          <p className="text-bad">{error}</p>
          <a className="underline" href="/login/">
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <Spinner className="h-6 w-6" />
          <p className="text-muted">Signing you in…</p>
        </>
      )}
    </div>
  );
}
