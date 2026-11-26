'use client';
import { useState } from 'react';
import brand from '@/generated/brand.json';
import { signInWithMagicLink, signInWithPassword, signUpWithPassword } from '@/sync/auth';
import { Button, Field, Segmented, inputCls } from './ui';

export function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: 'good', text });
    } catch (e) {
      setMsg({ tone: 'bad', text: (e as Error).message || 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm py-6">
      <div className="mb-6 flex flex-col items-center text-center">
        { }
        <img src={brand.still ?? '/icons/icon-192.png'} alt="" className="mb-3 h-20 w-20" />
        <h1 className="text-2xl font-bold">Saxon Scout</h1>
        <p className="text-sm text-muted">FRC 611 + 526 · Blair BunnyBots 2026</p>
      </div>
      <Segmented
        className="mb-4 w-full [&>button]:flex-1"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
          { value: 'magic', label: 'Email link' },
        ]}
      />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'signin') void run(() => signInWithPassword(email, password));
          else if (mode === 'signup')
            void run(async () => {
              const r = await signUpWithPassword(email, password, name);
              return r.needsConfirmation ? 'Check your e-mail to confirm, then sign in.' : 'Account created.';
            });
          else
            void run(async () => {
              await signInWithMagicLink(email);
              return 'Link sent — open it on THIS device/browser.';
            });
        }}
      >
        {mode === 'signup' && (
          <Field label="Your name (shown on the leaderboard)">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </Field>
        )}
        <Field label="E-mail">
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        {mode !== 'magic' && (
          <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </Field>
        )}
        <Button variant="primary" className="w-full" type="submit" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send sign-in link'}
        </Button>
      </form>
      {msg && <p className={`mt-4 rounded-lg p-3 text-sm ${msg.tone === 'good' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>{msg.text}</p>}
      <p className="mt-6 text-xs text-muted">
        New accounts start as <b>Viewer</b>; an admin promotes scouts and strategists. Leads with the admin passcode can make themselves Admin under <b>Admin</b>. Installed on your home screen? Use e-mail + password (email links open in
        the browser, not the installed app).
      </p>
    </div>
  );
}
