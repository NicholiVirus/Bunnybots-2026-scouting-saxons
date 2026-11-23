'use client';
/**
 * Second lock on the Admin page: the device must enter the team passcode once
 * per app session. This only hides the screen — the real protection is the
 * account role checked by Supabase Row-Level Security on every write.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button, Field, PageTitle, inputCls } from '@/components/ui';

/** SHA-256 of the passcode (uppercase). Change both together to rotate it. */
const PASSCODE_SHA256 = 'c750ae35005d3181ddf3f2a6763c1189a934b5884539f46c630e1ca02019c903';
export const ADMIN_UNLOCK_KEY = 'hh:admin-unlocked';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === PASSCODE_SHA256;
  } catch {
    return false;
  }
}

export function PasscodeGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- read sessionStorage after hydration
  useEffect(() => setUnlocked(isUnlocked()), []);

  if (unlocked === null) return null;
  if (unlocked) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const hash = await sha256Hex(code.trim().toUpperCase());
      if (hash === PASSCODE_SHA256) {
        try {
          sessionStorage.setItem(ADMIN_UNLOCK_KEY, hash);
        } catch {
          /* private mode: unlock for this page view only */
        }
        setUnlocked(true);
      } else {
        setError('Wrong passcode. Ask the scouting lead for it.');
      }
    } catch {
      setError('This browser cannot check the passcode. Open the app over https.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm py-8">
      <PageTitle sub="Enter the team passcode to open admin tools.">
        <span className="inline-flex items-center gap-2">
          <Lock size={22} /> Admin locked
        </span>
      </PageTitle>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Passcode">
          <input
            id="admin-passcode"
            className={inputCls}
            type="password"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="admin-passcode"
            autoFocus
          />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <Button variant="primary" className="w-full" type="submit" disabled={busy || !code}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
