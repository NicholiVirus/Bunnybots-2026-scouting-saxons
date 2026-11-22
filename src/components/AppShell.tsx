'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ClipboardPen,
  Eye,
  GitCompare,
  Home,
  ListOrdered,
  Medal,
  Menu,
  QrCode,
  Settings,
  Shield,
  Swords,
  Trophy,
  Users,
  Wrench,
} from 'lucide-react';
import brand from '@/generated/brand.json';
import { useAuth, atLeast } from '@/sync/auth';
import type { Role } from '@/data/types';
import { usePrefs } from '@/lib/prefs';
import { pwaStore, applyUpdate } from '@/lib/pwa';
import { Badge, Button, Modal, Spinner, cx } from './ui';
import { SyncBadge } from './SyncBadge';
import { OurTeamSwitch } from './OurTeamSwitch';
import { LoginScreen } from './LoginScreen';
import { InstallBanner } from './InstallBanner';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  mobile?: boolean;
  min?: Role;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: Home, mobile: true },
  { href: '/scout/', label: 'Scout', icon: ClipboardPen, mobile: true, min: 'scout' },
  { href: '/matches/', label: 'Matches', icon: Swords, mobile: true },
  { href: '/teams/', label: 'Teams', icon: Users, mobile: true },
  { href: '/selection/', label: 'Picks', icon: ListOrdered, mobile: true },
  { href: '/preview/', label: 'Match preview', icon: Eye },
  { href: '/rankings/', label: 'Rankings', icon: Trophy },
  { href: '/compare/', label: 'Compare teams', icon: GitCompare },
  { href: '/pit/', label: 'Pit scouting', icon: Wrench, min: 'scout' },
  { href: '/transfer/', label: 'QR transfer', icon: QrCode },
  { href: '/leaderboard/', label: 'Scout leaderboard', icon: Medal },
  { href: '/admin/', label: 'Admin', icon: Shield, min: 'strategist' },
  { href: '/settings/', label: 'Settings', icon: Settings },
];

/** Routes that render without signing in (public board, auth flow). */
const PUBLIC_PATHS = ['/board/', '/login/', '/auth/callback/'];

function isActive(path: string, href: string) {
  if (href === '/') return path === '/';
  return path.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() || '/';
  const auth = useAuth();
  const prefs = usePrefs();
  const pwa = pwaStore.use();
  const [menu, setMenu] = useState(false);
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const items = NAV.filter((n) => !n.min || atLeast(auth.role, n.min));

  // The public board and auth callback get a bare layout.
  if (path.startsWith('/board/') || path.startsWith('/auth/callback/')) return <>{children}</>;

  let body: ReactNode = children;
  if (!isPublic) {
    if (auth.status === 'loading')
      body = (
        <div className="flex h-[60vh] items-center justify-center text-muted">
          <Spinner className="mr-2" /> Loading…
        </div>
      );
    else if (auth.status === 'signed_out') body = <LoginScreen />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2">
          { }
          <img src={brand.still ?? '/icons/icon-192.png'} alt="" className="h-9 w-9" />
          <div className="leading-tight">
            <div className="font-bold">Saxon Scout</div>
            <div className="text-xs text-muted">611 · 526 · Harvest Havoc</div>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium',
                isActive(path, n.href) ? 'bg-saxon text-saxon-ink' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <n.icon size={18} /> {n.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-3">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              { }
              <img src={brand.still ?? '/icons/icon-192.png'} alt="" className="h-8 w-8" />
              <span className="hidden font-bold sm:inline">Saxon Scout</span>
            </Link>
            {prefs.demo && <Badge tone="warn">DEMO</Badge>}
            <div className="flex-1" />
            <OurTeamSwitch />
            <SyncBadge />
            <button className="tap rounded-xl text-muted hover:text-fg lg:hidden" onClick={() => setMenu(true)} aria-label="Menu">
              <Menu className="mx-auto" />
            </button>
          </div>
          {pwa.updateReady && (
            <div className="flex items-center justify-between gap-2 bg-saxon px-3 py-2 text-sm text-saxon-ink">
              <span>A new version is ready.</span>
              <Button size="sm" variant="secondary" onClick={applyUpdate}>
                Update now
              </Button>
            </div>
          )}
        </header>

        <InstallBanner />
        <main className="flex-1 px-3 pb-28 pt-4 sm:px-4 lg:pb-8">{body}</main>

        {/* Mobile bottom tabs */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-xl">
            {items
              .filter((n) => n.mobile)
              .map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cx(
                    'flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                    isActive(path, n.href) ? 'text-saxon' : 'text-muted',
                  )}
                >
                  <n.icon size={22} />
                  {n.label}
                </Link>
              ))}
          </div>
        </nav>
      </div>

      <Modal open={menu} onClose={() => setMenu(false)} title="Menu">
        <div className="grid grid-cols-2 gap-2">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setMenu(false)}
              className={cx(
                'flex h-14 items-center gap-3 rounded-xl border border-line px-3 text-sm font-medium',
                isActive(path, n.href) ? 'bg-saxon text-saxon-ink' : 'bg-surface-2',
              )}
            >
              <n.icon size={18} /> {n.label}
            </Link>
          ))}
        </div>
      </Modal>
    </div>
  );
}
