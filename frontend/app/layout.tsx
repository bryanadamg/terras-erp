import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './globals.css';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './context/ConfirmContext';
import { LanguageProvider } from './context/LanguageContext';
import { Suspense } from 'react';
import { UserProvider } from './context/UserContext';
import { DataProvider } from './context/DataContext';
import { ThemeProvider } from './context/ThemeContext';
import QueryProvider from './components/QueryProvider';
import MainLayout from './components/MainLayout';

export const metadata = {
  title: 'Terras ERP',
  description: 'Next-generation modular manufacturing system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>
        <QueryProvider>
          <LanguageProvider>
            <ToastProvider>
              <ConfirmProvider>
                  <ThemeProvider>
                  <UserProvider>
                    <DataProvider>
                      <Suspense fallback={<div className="d-flex justify-content-center align-items-center vh-100 bg-light text-muted fw-bold">LOADING_SYSTEM_RESOURCES...</div>}>
                        <MainLayout>
                          {children}
                        </MainLayout>
                      </Suspense>
                    </DataProvider>
                  </UserProvider>
                </ThemeProvider>
              </ConfirmProvider>
            </ToastProvider>
          </LanguageProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
