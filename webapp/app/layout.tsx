import type { Metadata } from 'next';
import '@fontsource-variable/ibm-plex-sans';
import './globals.css';
import { ProjectProvider } from '../lib/state/ProjectContext';
import HeaderControls from '../components/HeaderControls';
import { LocaleProvider } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'Football Analysis Annotator',
  description: 'Frame-native football video analysis and presentation authoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh flex flex-col">
        <LocaleProvider>
          <ProjectProvider>
            <header className="header shrink-0">
              <HeaderControls />
            </header>
            <div className="app-content flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </ProjectProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
