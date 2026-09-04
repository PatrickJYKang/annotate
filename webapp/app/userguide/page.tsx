import type { Metadata } from 'next';

import UserGuide from '../../components/userguide/UserGuide';

export const metadata: Metadata = {
  title: 'User Guide | Annotate',
  description: 'Workflow guide and reference for Annotate football video analysis.',
};

export default function UserGuidePage() {
  return <UserGuide />;
}
