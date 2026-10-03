import type { Metadata } from 'next';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { buttonVariants } from '@/components/ui/button';
import { ErrorState } from '@/components/shared/states';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { Spiel } from '@/modules/level/xpslot/components/spiel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'XP-Slot' };
export const dynamic = 'force-dynamic';

/**
 * Der XP-Slot.
 *
 * ## Warum ein Tab im Level-Modul
 *
 * Weil der Einsatz XP sind. Ein eigenes Modul in der Seitenleiste haette eine
 * eigene Berechtigung, eine eigene Abschaltung und eine eigene Stelle, an der
 * jemand nach XP-Regeln sucht - und alles davon gibt es im Level-System
 * schon. Wer das Level-Modul nicht sehen darf, sieht auch diesen Tab nicht;
 * `requirePagePermission` prueft `level.xpslot.play` **und** die
 * Modulsichtbarkeit.
 *
 * ## Was hier passiert
 *
 * Laden und weitergeben. Die Konfiguration und der eigene Stand kommen
 * serverseitig; das Spiel selbst ist eine Clientkomponente, weil Walzen,
 * Klaenge und Auto-Spin in den Browser gehoeren. Jeder Spin geht trotzdem
 * ueber eine Server Action - im Browser entsteht kein Ergebnis.
 */
export default async function XpSlotPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.xpslotPlay);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState
          title="Modul deaktiviert"
          description="Das Level-System ist derzeit deaktiviert. Der XP-Slot ist damit geschlossen."
        />
      </>
    );
  }

  const konfiguration = await level.xpslot.leseKonfiguration();
  const [ansicht, spieler] = await Promise.all([
    level.xpslot.slotAnsicht(konfiguration),
    level.xpslot.spielerAnsicht(context.user.discordId, konfiguration),
  ]);
  const csrfToken = csrfTokenFor(context);

  return (
    <>
      {sections}

      {/*
        Die Ueberschrift kommt von `PageHeader` und nicht von einer eigenen
        Hauptueberschrift: die gehoert der Kopfzeile der Anwendung, die sie
        aus der Module Registry ableitet. Eine zweite hier waere ein doppelter
        Titel - `tests/unit/page-headers.test.ts` haelt genau das fest, und
        zwar am rohen Quelltext, weshalb hier auch kein Beispiel in spitzen
        Klammern stehen darf.
      */}
      <PageHeader
        title="XP-Slot"
        description={
          `Fünf Walzen, ${ansicht.linien.length} Linien.` +
          (ansicht.eventName ? ` Gerade läuft: ${ansicht.eventName}.` : '')
        }
        actions={
          can(context, level.LEVEL_PERMISSIONS.xpslotManage) ? (
            <Link
              href="/level/xp-slot/verwaltung"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Settings2 aria-hidden="true" />
              Verwaltung
            </Link>
          ) : null
        }
        className="mb-4"
      />

      <Spiel csrfToken={csrfToken} ansicht={ansicht} spieler={spieler} />
    </>
  );
}
