import type { Metadata } from 'next';
import { requirePagePermission } from '@/server/auth';
import { DokuStart } from '@/modules/docs/components/werk-ansicht';
import { TEAM_DOKU } from '@/modules/docs/werk';

export const metadata: Metadata = { title: 'Team-Dokumentation' };

/** Startseite der Team-Dokumentation. Zum Riegel siehe die Entwickler-Seite. */
export default async function TeamDokuPage(): Promise<React.JSX.Element> {
  await requirePagePermission(TEAM_DOKU.permission);
  return <DokuStart werk={TEAM_DOKU} />;
}
