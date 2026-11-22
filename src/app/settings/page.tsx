'use client';
import { useState } from 'react';
import { Download, LogOut, Smartphone } from 'lucide-react';
import { Badge, Button, Card, Field, PageTitle, Segmented, Toggle, inputCls } from '@/components/ui';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { useAuth, signOut, refreshProfile } from '@/sync/auth';
import { putRow } from '@/data/repo';
import { pwaStore } from '@/lib/pwa';
import { isSupabaseConfigured } from '@/sync/supabase';
import { APP_VERSION } from '@/config/defaults';
import { db } from '@/data/db';

export default function SettingsPage() {
  const prefs = usePrefs();
  const auth = useAuth();
  const pwa = pwaStore.use();
  const [name, setName] = useState(auth.profile?.display_name ?? prefs.scoutName);
  const [sbUrl, setSbUrl] = useState(prefs.supabaseUrl);
  const [sbKey, setSbKey] = useState(prefs.supabaseAnonKey);

  const saveName = async () => {
    setPrefs({ scoutName: name });
    if (auth.status === 'signed_in' && auth.profile) {
      await putRow('profiles', { ...auth.profile, display_name: name });
      await refreshProfile();
    }
  };

  const toggleDemo = (on: boolean) => {
    if (on && !confirm('Open the DEMO sandbox? It uses a separate local database with 449’s simulated event. Real data is untouched.')) return;
    setPrefs({ demo: on });
    window.location.href = '/';
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle sub={`Version ${APP_VERSION}`}>Settings</PageTitle>

      <Card title="Account">
        {auth.status === 'signed_in' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{auth.profile?.display_name || auth.email}</div>
                <div className="text-sm text-muted">{auth.email}</div>
              </div>
              <Badge tone="saxon">{auth.role}</Badge>
            </div>
            <Button size="sm" onClick={() => void signOut()}>
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {auth.status === 'local' ? (
              <>
                Local-only mode (no server). Role on this device: <b className="text-fg">{prefs.localRole}</b>.
              </>
            ) : (
              'Not signed in.'
            )}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <input className={inputCls} placeholder="Display name / initials" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={() => void saveName()}>Save</Button>
        </div>
        {auth.status === 'local' && (
          <div className="mt-4">
            <Field label="Local role (preview the app as…)">
              <Segmented
                value={prefs.localRole}
                onChange={(v) => {
                  setPrefs({ localRole: v });
                  window.location.reload();
                }}
                options={[
                  { value: 'admin', label: 'Admin' },
                  { value: 'strategist', label: 'Strat' },
                  { value: 'scout', label: 'Scout' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
              />
            </Field>
          </div>
        )}
      </Card>

      <Card title="This device">
        <div className="space-y-2">
          <Toggle checked={prefs.splashEnabled} onChange={(v) => setPrefs({ splashEnabled: v })} label="Launch logo animation" />
          <Toggle checked={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} label="Haptic feedback on taps" />
          <Toggle checked={prefs.theme === 'dark'} onChange={(v) => setPrefs({ theme: v ? 'dark' : 'light' })} label="Dark mode" />
          <Toggle checked={prefs.demo} onChange={toggleDemo} label="Demo sandbox (449's simulated event)" />
        </div>
      </Card>

      <Card title="Install on this device">
        {pwa.standalone ? (
          <p className="text-sm text-good">Installed — running as an app. Works with no connection.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {pwa.installPrompt && (
              <Button variant="primary" onClick={() => void pwa.installPrompt?.prompt()}>
                <Download size={16} /> Install app
              </Button>
            )}
            <p>
              <Smartphone size={14} className="mr-1 inline" />
              <b>iPhone/iPad (Safari):</b> Share button → <i>Add to Home Screen</i>.
            </p>
            <p>
              <b>Android (Chrome):</b> ⋮ menu → <i>Install app</i> (or <i>Add to Home screen</i>).
            </p>
            <p className="text-muted">Open it once while online so everything is cached; after that it runs in airplane mode.</p>
          </div>
        )}
      </Card>

      <Card title="Advanced: server connection">
        <p className="mb-3 text-sm text-muted">
          {isSupabaseConfigured() ? 'Connected to a Supabase project.' : 'No Supabase project configured.'} Override only if your admin asks you to (e.g.
          the build was deployed without keys).
        </p>
        <div className="space-y-2">
          <input className={inputCls} placeholder="https://xxxx.supabase.co" value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} />
          <input className={inputCls} placeholder="anon public key" value={sbKey} onChange={(e) => setSbKey(e.target.value)} />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setPrefs({ supabaseUrl: sbUrl.trim(), supabaseAnonKey: sbKey.trim() });
                window.location.reload();
              }}
            >
              Save & reload
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPrefs({ supabaseUrl: '', supabaseAnonKey: '' });
                window.location.reload();
              }}
            >
              Use build default
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Danger zone">
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            const pending = await db.outbox.where('status').equals('pending').count();
            if (pending && !confirm(`${pending} changes have NOT reached the server yet and will be lost. Continue?`)) return;
            if (!confirm('Erase all local data on this device?')) return;
            await db.delete();
            window.location.href = '/';
          }}
        >
          Erase local data on this device
        </Button>
      </Card>
    </div>
  );
}
