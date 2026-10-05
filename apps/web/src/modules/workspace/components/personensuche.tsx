'use client';

import { Personensuche as Basis } from '@/components/shared/personensuche';
import { workspaceTeamSuchenAction } from '../actions';
import type { Teammitglied } from '@/modules/workspace/daten';

/**
 * Die Beteiligtensuche des Workspace.
 *
 * Der Picker selbst steht unter `components/shared` - er ist derselbe, den
 * die XP-Slot-Verwaltung fuer ihre Geschenke benutzt. Hier kommt dazu, was
 * nur den Workspace betrifft: **welche** Suche gefragt wird.
 *
 * `workspaceTeamSuchenAction` prueft serverseitig `workspace.view` und sucht
 * im Mitgliederspiegel - inklusive der Administration und der Moderation, die
 * ohnehin jedes Projekt sehen. Wer dort nicht auftaucht, soll auch nicht
 * beteiligt werden koennen.
 */
export function Personensuche({
  csrfToken,
  ausgeschlossen,
  wert,
  aufWahl,
  beschriftung,
  platzhalter,
  leerText,
  disabled,
}: {
  csrfToken: string;
  /** Wer nicht mehr in Frage kommt - die bereits Beteiligten. */
  ausgeschlossen: readonly string[];
  wert: Teammitglied | null;
  aufWahl: (person: Teammitglied | null) => void;
  beschriftung?: string;
  platzhalter?: string;
  leerText?: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Basis<Teammitglied>
      suchen={(begriff) => workspaceTeamSuchenAction({ csrfToken, begriff })}
      ausgeschlossen={ausgeschlossen}
      wert={wert}
      aufWahl={aufWahl}
      {...(beschriftung === undefined ? {} : { beschriftung })}
      {...(platzhalter === undefined ? {} : { platzhalter })}
      {...(leerText === undefined ? {} : { leerText })}
      {...(disabled === undefined ? {} : { disabled })}
    />
  );
}
