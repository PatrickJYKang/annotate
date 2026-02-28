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
      <body>
        <ProjectProvider>
          <header className="header">
            <h1>Football Analysis Annotator</h1>
            <div className="flex items-stretch">
              <HeaderControls />
            </div>
          </header>
          <div className="container">
            {children}
          </div>
        </ProjectProvider>
      </body>
    </html>
  );
}
