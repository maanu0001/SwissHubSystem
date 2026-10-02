import { can, type AuthContext } from '@swisshub/auth';
import { prisma } from '@swisshub/database';
import { clips, fragt, isModuleEnabled, socialmedia, wrapped } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import type { ModulNavigationEintrag } from '@/components/shared/modul-navigation';

/**
 * Der Social-Media-Bereich: was er zeigt und woher es kommt.
 *
 * ## Warum dieser Bereich nichts Eigenes besitzt
 *
 * Weil er ein Zugriffspunkt ist und keine zweite Wahrheit. Jede Zahl hier
 * stammt aus dem Modul, dem die Daten gehoeren; dieser Bereich haelt keine
 * Kopie einer Frage, eines Clips oder eines Rueckblicks und schreibt nirgends
 * hin.
 *
 * Das ist die Lehre aus der Alternative: ein zweiter Ort mit eigenen Entwuerfen
 * waere ein zweiter Ort, an dem ein Entwurf anders aussieht als im Studio - und
 * am Ende zwei Antworten auf die Frage, was schon gepostet wurde.
 *
 * ## Warum hier gezaehlt und nicht geladen wird
 *
 * Die Uebersicht braucht Zahlen, keine Datensaetze: «drei Ergebnisse warten auf
 * den Export» beantwortet die Frage, mit der jemand hierherkommt. Dafuer
 * `count` und nicht `findMany().length` - der Unterschied ist bei zweihundert
 * Abstimmungen eine Zeile Netzwerkverkehr gegen zweihundert.
 *
 * Alle Zaehlungen laufen in **einem** `Promise.all`. Nicht aus Eleganz: sie
 * wissen nichts voneinander, und hintereinander waere es die Summe der
 * Wartezeiten statt der laengsten. Und ausdruecklich keine Schleife, die je
 * Runde eine weitere Abfrage stellt - eine Uebersicht, die mit der Zahl der
 * Runden langsamer wird, ist nach einem Jahr unbenutzbar.
 */

export interface SocialMediaStand {
  guildId: string;
  /** Ist der Bereich eingeschaltet? */
  aktiv: boolean;
  /** Welche Quellmodule gibt es gerade - und darf diese Person hinein? */
  fragtOffen: boolean;
  clipsOffen: boolean;
  wrappedOffen: boolean;
}

/**
 * Was dieser Person offensteht.
 *
 * Zwei Bedingungen je Bereich, und beide sind noetig: das Quellmodul muss
 * eingeschaltet sein, **und** die Person muss es oeffnen duerfen. Ein Reiter,
 * der auf 403 fuehrt, ist ein Versprechen, das die naechste Seite bricht - und
 * einer, der auf ein abgeschaltetes Modul fuehrt, eines, das niemand halten
 * kann.
 */
export async function ladeSocialMediaStand(context: AuthContext, guildId: string): Promise<SocialMediaStand> {
  const [aktiv, fragtAn, clipsAn, wrappedAn] = await Promise.all([
    isModuleEnabled(socialmedia.SOCIAL_MEDIA_MODULE_ID),
    isModuleEnabled(fragt.FRAGT_MODULE_ID),
    isModuleEnabled(clips.CLIPS_MODULE_ID),
    isModuleEnabled(wrapped.WRAPPED_MODULE_ID),
  ]);

  return {
    guildId,
    aktiv,
    fragtOffen: fragtAn && can(context, fragt.FRAGT_PERMISSIONS.studio),
    clipsOffen: clipsAn && can(context, clips.CLIPS_PERMISSIONS.view),
    wrappedOffen: wrappedAn && can(context, wrapped.WRAPPED_PERMISSIONS.studioView),
  };
}

/** Die Reiter des Bereichs - nur die, die jemand auch betreten darf. */
export function socialMediaBereiche(stand: SocialMediaStand): ModulNavigationEintrag[] {
  const bereiche: ModulNavigationEintrag[] = [
    { key: 'uebersicht', label: 'Übersicht', href: '/social-media', icon: 'Megaphone' },
  ];
  if (stand.fragtOffen) {
    bereiche.push({
      key: 'fragt',
      label: 'SwissHub fragt',
      href: '/social-media/fragt',
      icon: 'MessageCircleQuestion',
    });
  }
  if (stand.clipsOffen) {
    bereiche.push({
      key: 'clips',
      label: 'Clip of the Week',
      href: '/social-media/clips',
      icon: 'Clapperboard',
    });
  }
  if (stand.wrappedOffen) {
    bereiche.push({ key: 'wrapped', label: 'Wrapped', href: '/social-media/wrapped', icon: 'Gift' });
  }
  return bereiche;
}

export interface SocialMediaZahlen {
  /** Abgeschlossene Abstimmungen, deren Grafik noch nicht gepostet ist. */
  fragtOffeneExporte: number;
  /** Entwuerfe, die als veroeffentlicht markiert sind. */
  fragtGepostet: number;
  /** Abgeschlossene Clip-Runden mit einer Teilen-Karte. */
  clipsRunden: number;
  /** Rueckblicke, die veroeffentlicht sind und Folien zum Teilen haben. */
  wrappedVeroeffentlicht: number;
  /** Rueckblicke insgesamt. */
  wrappedGesamt: number;
}

/**
 * Die Zahlen der Uebersicht - in einem Durchgang.
 *
 * Was ein Bereich nicht zeigt, wird nicht gezaehlt: eine Abfrage fuer einen
 * Reiter, den diese Person nicht sieht, waere Arbeit fuer nichts - und bei
 * einem abgeschalteten Modul eine Abfrage auf Tabellen, die niemand pflegt.
 */
export async function ladeSocialMediaZahlen(stand: SocialMediaStand): Promise<SocialMediaZahlen> {
  const [fragtOffeneExporte, fragtGepostet, clipsRunden, wrappedVeroeffentlicht, wrappedGesamt] =
    await Promise.all([
      stand.fragtOffen
        ? prisma.fragtAbstimmung.count({
            where: {
              guildId: stand.guildId,
              status: 'CLOSED',
              // Dieselbe Bedingung wie in der Uebersicht von «SwissHub fragt»:
              // abgeschlossen und kein Entwurf, der als gepostet gilt.
              NOT: { entwuerfe: { some: { status: 'VEROEFFENTLICHT' } } },
            },
          })
        : 0,
      stand.fragtOffen
        ? prisma.fragtEntwurf.count({
            where: { status: 'VEROEFFENTLICHT', abstimmung: { guildId: stand.guildId } },
          })
        : 0,
      stand.clipsOffen
        ? prisma.clipCompetition.count({
            where: { guildId: stand.guildId, status: 'COMPLETED', hallOfFameHiddenAt: null },
          })
        : 0,
      stand.wrappedOffen
        ? prisma.wrappedCampaign.count({ where: { guildId: stand.guildId, status: 'PUBLISHED' } })
        : 0,
      stand.wrappedOffen ? prisma.wrappedCampaign.count({ where: { guildId: stand.guildId } }) : 0,
    ]);

  return { fragtOffeneExporte, fragtGepostet, clipsRunden, wrappedVeroeffentlicht, wrappedGesamt };
}

export interface ExportKarte {
  /** Woher es kommt - fuer die Beschriftung, nicht fuer eine Entscheidung. */
  quelle: 'fragt' | 'clips' | 'wrapped';
  titel: string;
  hinweis: string;
  /** Wohin es fuehrt: immer in das Ursprungsmodul. */
  href: string;
  /** Wann es entstanden ist - fuer die Sortierung «das Neueste oben». */
  zeitpunkt: Date | null;
  /** Steht es noch aus oder ist es erledigt? */
  offen: boolean;
}

/**
 * Was gerade zum Posten bereitliegt - quer ueber alle Quellen.
 *
 * ## Warum es eine gemeinsame Liste ist
 *
 * Weil die Frage «was poste ich heute» keine Frage nach einem Modul ist. Drei
 * Listen nebeneinander waeren dieselbe Information in der Gliederung der
 * Software statt in der des Nutzers.
 *
 * ## Warum sie kurz ist
 *
 * `take` je Quelle, und die Grenzen sind klein. Eine Uebersicht ist keine
 * Archivansicht: was aelter ist, findet man im Ursprungsmodul, das dafuer
 * Seitenumbruch und Filter hat. Ohne die Grenzen waere diese Seite nach einem
 * Jahr eine Liste aus fuenfhundert Zeilen, die niemand liest - und drei
 * Abfragen, die mit jedem Monat langsamer werden.
 */
export async function ladeExportKarten(stand: SocialMediaStand): Promise<ExportKarte[]> {
  const [fragtZeilen, clipZeilen, wrappedZeilen] = await Promise.all([
    stand.fragtOffen
      ? prisma.fragtAbstimmung.findMany({
          where: { guildId: stand.guildId, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
          take: 6,
          select: {
            id: true,
            frageText: true,
            closedAt: true,
            finalVotes: true,
            entwuerfe: { select: { id: true, status: true } },
          },
        })
      : [],
    stand.clipsOffen ? clips.hallOfFame(stand.guildId, 6, 0) : [],
    stand.wrappedOffen
      ? prisma.wrappedCampaign.findMany({
          where: { guildId: stand.guildId },
          orderBy: [{ displayYear: 'desc' }, { createdAt: 'desc' }],
          take: 6,
          select: { id: true, title: true, status: true, displayYear: true, createdAt: true },
        })
      : [],
  ]);

  const karten: ExportKarte[] = [];

  for (const zeile of fragtZeilen) {
    const entwurf = zeile.entwuerfe[0];
    const gepostet = entwurf?.status === 'VEROEFFENTLICHT';
    karten.push({
      quelle: 'fragt',
      titel: zeile.frageText,
      hinweis: gepostet
        ? 'Gepostet'
        : entwurf
          ? `Entwurf offen · ${zeile.finalVotes} ${zeile.finalVotes === 1 ? 'Stimme' : 'Stimmen'}`
          : `Noch kein Entwurf · ${zeile.finalVotes} ${zeile.finalVotes === 1 ? 'Stimme' : 'Stimmen'}`,
      /*
       * Ohne Entwurf fuehrt der Weg auf die Ergebnisseite und nicht ins Studio.
       *
       * Ein Studio-Link auf eine Kennung, die es nicht gibt, waere ein 404 -
       * und der Entwurf entsteht ohnehin dort, wo das Ergebnis steht.
       */
      href: entwurf ? `/fragt/studio/${entwurf.id}` : `/fragt/ergebnisse/${zeile.id}`,
      zeitpunkt: zeile.closedAt,
      offen: !gepostet,
    });
  }

  for (const runde of clipZeilen) {
    karten.push({
      quelle: 'clips',
      titel: runde.gewinner?.titel ?? `Woche ${runde.woche}/${runde.jahr}`,
      hinweis: runde.gewinner
        ? `${runde.gewinner.einreicher.displayName ?? runde.gewinner.einreicher.username ?? 'Unbekannt'} · ${runde.stimmen} ${runde.stimmen === 1 ? 'Stimme' : 'Stimmen'}`
        : 'Runde ohne Gewinner',
      href: `/clips/runde/${encodeURIComponent(runde.key)}`,
      zeitpunkt: runde.beendetAm,
      /*
       * Eine abgeschlossene Runde gilt hier immer als «offen».
       *
       * Anders als bei «SwissHub fragt» merkt sich das Clip-Modul nicht, ob die
       * Teilen-Karte schon einmal gepostet wurde - und das zu erfinden hiesse,
       * eine Spalte anzulegen, die nur diese Uebersicht fuellt. Lieber eine
       * ehrliche Liste als ein Haekchen, das nichts weiss.
       */
      offen: true,
    });
  }

  for (const kampagne of wrappedZeilen) {
    karten.push({
      quelle: 'wrapped',
      titel: kampagne.title,
      hinweis: kampagne.status === 'PUBLISHED' ? `Veröffentlicht · ${kampagne.displayYear}` : 'Entwurf',
      href: systemRoutes.wrappedKampagne(kampagne.id),
      zeitpunkt: kampagne.createdAt,
      offen: kampagne.status === 'PUBLISHED',
    });
  }

  // Das Neueste oben. Ohne Zeitpunkt nach hinten: ein Eintrag ohne Datum ist
  // nicht «von 1970».
  return karten.sort((a, b) => (b.zeitpunkt?.getTime() ?? 0) - (a.zeitpunkt?.getTime() ?? 0));
}
