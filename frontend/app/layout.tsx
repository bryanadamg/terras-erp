import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
// terras-ui ships its --terras-* custom properties and the :hover/:focus rules
// its components hang off. Both are required whenever a package component is
// rendered, and both are namespaced (--terras-* / .terras-*), so they add to the
// cascade rather than collide with globals.css. Imported before globals.css so
// an app rule still wins any specificity tie.
import '@bryanadamg/terras-ui/css';
import '@bryanadamg/terras-ui/chrome';
import './globals.css';
import { ToastProvider } from './components/shared/Toast';
import { ConfirmProvider } from './context/ConfirmContext';
import { LanguageProvider } from './context/LanguageContext';
import { Suspense } from 'react';
import { UserProvider } from './context/UserContext';
import { DataProvider } from './context/DataContext';
import { ThemeProvider } from './context/ThemeContext';
import { TimezoneProvider } from './context/TimezoneContext';
import QueryProvider from './components/shared/QueryProvider';
import MainLayout from './components/shared/MainLayout';
import GlobalTooltip from './components/shared/GlobalTooltip';
import SWRegister from './components/shared/SWRegister';
import localFont from 'next/font/local';

// Brand face, used only for the "Terras" wordmark (login screen, docs header).
// Vendored as two woff2 files rather than pulled through `next/font/google`,
// because that fetched from fonts.gstatic.com at *build* time and a single
// ETIMEDOUT there failed the whole Docker image build. Self-hosted either way,
// so a floor client with no internet still gets it; `display: swap` + Next's
// size-adjust fallback metrics keep the wordmark from jumping. Exposed as a CSS
// var rather than applied to <body>: the whole UI stays on the system stack.
//
// Only the *latin* subset is vendored (~26 KB per weight). The JP cut carries
// CJK, which Google splits into ~120 unicode-range chunks per weight — 246
// files for one Latin wordmark. Slicing to latin at vendor time is what the old
// `preload: false` + unicode-range gating bought us at runtime; keeping
// `preload: false` on top just keeps the mark off the critical path of every
// page, since only two screens render it.
const displayFont = localFont({
  src: [
    { path: './fonts/IBMPlexSansJP-Medium-latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSansJP-SemiBold-latin.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  preload: false,
  variable: '--font-display',
});

export const metadata = {
  title: 'Terras ERP',
  description: 'Next-generation modular manufacturing system',
  // iOS home-screen app: launches standalone (no Safari chrome), sets title + status bar
  appleWebApp: {
    capable: true,
    title: 'Terras',
    statusBarStyle: 'black-translucent' as const,
  },
}

export const viewport = {
  themeColor: '#1e293b',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the boot script below stamps data-ui-scale on
    // <html> before React hydrates, which the server markup can't know about.
    <html lang="en" className={displayFont.variable} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Standard counterpart to appleWebApp.capable above — Next's metadata API doesn't emit this one yet */}
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Interface scale, applied before first paint so the UI never flashes
            at full size and then snaps down. ThemeContext owns the value after
            hydration; the scale list here mirrors UI_SCALES there. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=Number(localStorage.getItem('ui_scale'));if([70,75,80,90,100,110].indexOf(s)<0)s=80;document.documentElement.setAttribute('data-ui-scale',String(s));}catch(e){document.documentElement.setAttribute('data-ui-scale','80');}})();`,
          }}
        />
      </head>
      <body>
        <SWRegister />
        <QueryProvider>
          <LanguageProvider>
            <ToastProvider>
              <ConfirmProvider>
                  <ThemeProvider>
                  {/* Upgrades every native `title=` in the app to the themed
                      surface, and gives clipped text a hover of its own. Sits
                      under ThemeProvider (it reads the style) and outside the
                      route subtree so it survives navigation. */}
                  <GlobalTooltip />
                  <TimezoneProvider>
                  <UserProvider>
                    <DataProvider>
                      <Suspense fallback={<div className="d-flex justify-content-center align-items-center vh-100 bg-light text-muted fw-bold">LOADING_SYSTEM_RESOURCES...</div>}>
                        <MainLayout>
                          {children}
                        </MainLayout>
                      </Suspense>
                    </DataProvider>
                  </UserProvider>
                  </TimezoneProvider>
                </ThemeProvider>
              </ConfirmProvider>
            </ToastProvider>
          </LanguageProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
