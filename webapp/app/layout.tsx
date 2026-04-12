import type { Metadata } from 'next';
import './globals.css';
import { ProjectProvider } from '../lib/state/ProjectContext';
import HeaderControls from '../components/HeaderControls';

export const metadata: Metadata = {
  title: 'Football Analysis Annotator',
  description: 'Chromium-only PWA for stills-first annotation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh flex flex-col">
        <ProjectProvider>
          <header className="header shrink-0">
            <h1>Football Analysis Annotator</h1>
            <div className="flex items-stretch">
              <HeaderControls />
            </div>
          </header>
          <div className="container flex-1 min-h-0 flex flex-col">
            {children}
          </div>
        </ProjectProvider>
      </body>
    </html>
  );
}
