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
          <div className="container">
            <header className="header">
              <h1>Football Analysis Annotator</h1>
              <div className="flex items-stretch">
                <HeaderControls />
              </div>
            </header>
            {children}
          </div>
        </ProjectProvider>
      </body>
    </html>
  );
}
