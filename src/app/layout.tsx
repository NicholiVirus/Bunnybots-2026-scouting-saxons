import type { Metadata, Viewport } from 'next';
import './globals.css';
import brand from '@/generated/brand.json';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: { default: 'Saxon Scout — Harvest Havoc', template: '%s · Saxon Scout' },
  description: 'Offline-first scouting + strategy for Saxon Robotics (FRC 611 + 526) at Blair BunnyBots 2026.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Saxon Scout',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Saxon Scout',
    statusBarStyle: 'black-translucent',
    startupImage: brand.splash.map((s) => ({
      url: s.url,
      media: `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`,
    })),
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0b3c32',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark light',
};

// Applies the saved theme before first paint (dark is the default).
const themeScript = `try{var p=JSON.parse(localStorage.getItem('hh:prefs:v1')||'{}');if(p.theme==='light'){document.documentElement.classList.remove('dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
