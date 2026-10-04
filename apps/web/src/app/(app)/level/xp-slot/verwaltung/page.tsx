import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { level, loadPersonen, profile } from '@swisshub/modules';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { SlotVerwaltung } from '@/modules/level/xpslot/components/verwaltung';
import { PageHeader } from '@/components/shared/page-header';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';
import '@/modules/level/xpslot/xpslot.css';

export const metadata: Metadata = { title: 'XP-Slot verwalten' };
export const dynamic = 'force-dynamic';

/**
 * Die Verwaltung des XP-Slots.
 *
 * Alles wird hier serverseitig geladen und als Eigenschaften weitergegeben -
 * die Oberflaeche ist eine Clientkomponente, weil sie zwoelf Bereiche
 * umschaltet und Formulare haelt, aber sie holt nichts selbst. Jede Aenderung
 * geht ueber eine Server Action, die die Berechtigung erneut prueft.
 */
export default async function SlotVerwaltungPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.xpslotManage);
  const S = level.xpslot;

  const konfiguration = await S.leseKonfiguration();
  const [pakete, kennzahlen, verlauf, freispielZeilen, bonusGeschenke, befehl] = await Promise.all([
    S.pakete(konfiguration.wirksam.soundPackId),
    S.kennzahlen('alles'),
    S.verlauf({ seite: 1, proSeite: 40 }),
    /*
     * Die offenen Pakete aller Personen.
     *
     * `offeneFreispiele` fragt je Person; hier wird die Tabelle gebraucht,
     * also wird sie einmal gelesen. Zweihundert Pakete sind kein Problem,
     * zweihundert Abfragen waeren eines.
     */
    prisma.xpSlotFreespinPackage.findMany({
      where: { status: 'ACTIVE', remaining: { gt: 0 } },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    }),
    // Dieselbe Begruendung wie eine Zeile hoeher: eine Abfrage fuer die
    // ganze Tabelle, nicht eine je Person.
    S.bonusGeschenke(),
    S.befehlsEinstellungen(),
  ]);

  /*
   * Die Namen hinter den Kennungen.
   *
   * In Statistik und Historie stand nur die Discord-ID - achtzehn Ziffern,
   * die niemand liest. Wer in der Historie eine Auffaelligkeit sieht, will
   * wissen, **wer** das war, und zwar ohne die Zahl in die Mitgliedersuche zu
   * kopieren.
   *
   * Zwei Abfragen fuer die ganze Seite und nicht eine je Zeile:
   * `loadPersonen` liefert Anzeigename, Benutzername und ob die Person noch
   * da ist; `slugsVon` liefert die oeffentliche Adresse - und zwar nur fuer
   * Profile, die wirklich oeffentlich sind. Die Entscheidung darueber bleibt
   * dort, wo sie hingehoert; diese Seite bekommt eine Adresse oder keine.
   */
  const kennungen = [
    ...new Set([
      ...kennzahlen.aktivste.map((eintrag) => eintrag.discordId),
      ...verlauf.eintraege.map((eintrag) => eintrag.discordId),
      ...freispielZeilen.map((zeile) => zeile.discordId),
      ...bonusGeschenke.map((zeile) => zeile.discordId),
    ]),
  ];
  const [personen, slugs] = await Promise.all([loadPersonen(kennungen), profile.slugsVon(kennungen)]);
  const namen = kennungen.map((discordId) => {
    const person = personen.get(discordId);
    return {
      discordId,
      // Ohne Treffer die Kennung: haesslich, aber wahr - ein erfundener
      // Platzhalter sieht aus wie ein Name.
      name: person?.displayName ?? discordId,
      username: person?.username ?? null,
      slug: slugs.get(discordId) ?? null,
      ehemalig: person?.ehemalig ?? true,
    };
  });

  return (
    <>
      <LevelSectionNav sections={levelSections(context)} />

      <PageHeader
        title="XP-Slot verwalten"
        description="Jede Zahl hier verändert die Auszahlungsquote. Sie steht nach jedem Speichern oben."
        className="mb-4"
      />

      <SlotVerwaltung
        csrfToken={csrfTokenFor(context)}
        konfiguration={konfiguration}
        rtp={S.rtpVon(konfiguration)}
        pakete={pakete}
        freispiele={freispielZeilen.map(S.alsPaket)}
        bonusGeschenke={bonusGeschenke}
        kennzahlen={kennzahlen}
        verlauf={verlauf}
        klangSlots={S.KLANG_SLOTS}
        testfaelle={S.TESTFAELLE.map((fall) => ({ key: fall, label: S.TESTFALL_LABEL[fall] }))}
        namen={namen}
        befehl={befehl}
        vorgaben={S.BEFEHL_VORGABEN}
        darfFreispiele={can(context, level.LEVEL_PERMISSIONS.xpslotFreespinsManage)}
      />
    </>
  );
}
