import { DISCORD_PERMISSIONS, type DiscordPermissionName } from '@swisshub/discord';

/**
 * Welche Rolle sich jemand selbst geben darf - und welche niemals.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Weil hier der Unterschied zwischen «bequem» und «Serverübernahme» liegt.
 * Ein Haken im Dashboard heisst «ich möchte, dass sich das jemand selbst geben
 * kann». Ob das überhaupt erlaubt sein darf, entscheidet nicht der Haken.
 *
 * Der Fall, auf den es ankommt, ist kein Angriff, sondern ein Versehen: eine
 * Rolle heisst «Content», trägt aber seit einem Umbau «Nachrichten verwalten»
 * und «Mitglieder kicken». Wer sie im Dashboard durchwinkt, hat die Moderation
 * zur Selbstbedienung gemacht - und es fällt erst auf, wenn es jemand nutzt.
 *
 * Deshalb wird **bei jeder Zuweisung erneut** geprüft und nicht nur beim
 * Setzen des Hakens. Zwischen beiden Zeitpunkten kann sich auf Discord alles
 * geändert haben: die Rechte der Rolle, ihre Position, die Position des Bots.
 *
 * ## Vier Gründe, die reichen
 *
 * 1. **Kritische Rechte.** Die Liste unten. `ADMINISTRATOR` schliesst bei
 *    Discord alles ein - und damit auch alles andere hier.
 * 2. **Von Discord verwaltet.** Booster-Rollen und Integrationsrollen kann
 *    kein Bot vergeben; Discord lehnt das ab. Ein Knopf dafür wäre ein Knopf,
 *    der immer scheitert.
 * 3. **Über der Bot-Rolle.** Discord erlaubt einem Bot nur Rollen unterhalb
 *    seiner höchsten eigenen. Auch das endet sonst in einer Fehlermeldung.
 * 4. **Nicht freigegeben.** Der Haken fehlt schlicht.
 *
 * Alle vier liefern einen Grund im Klartext, weil ein «geht nicht» ohne Grund
 * die Person zum Rätselraten zwingt - und das Team zum Suchen.
 */

/**
 * Rechte, die eine Rolle für die Selbstvergabe sperren.
 *
 * Genau die aus der Anforderung, und bewusst keine längere Liste: jedes
 * weitere Recht hier wäre eine Entscheidung darüber, was «gefährlich» ist, und
 * die trifft das Team im Dashboard. Diese sechs sind nicht verhandelbar -
 * wer sie bekommt, kann den Server umbauen oder Leute entfernen.
 */
export const KRITISCHE_RECHTE: readonly DiscordPermissionName[] = [
  'ADMINISTRATOR',
  'MANAGE_GUILD',
  'MANAGE_ROLES',
  'BAN_MEMBERS',
  'KICK_MEMBERS',
  'MANAGE_CHANNELS',
] as const;

/** Warum eine Rolle nicht selbst vergeben werden darf. */
export type SperrGrund =
  | 'nicht_freigegeben'
  | 'kritische_rechte'
  | 'von_discord_verwaltet'
  | 'ueber_der_bot_rolle'
  | 'voraussetzung_fehlt';

export interface SelbstzuweisungsUrteil {
  erlaubt: boolean;
  grund: SperrGrund | null;
  /** Ein Satz für die Oberfläche - nie eine Rechteliste für Fremde. */
  text: string | null;
  /** Welche kritischen Rechte gefunden wurden - für das Dashboard, nicht öffentlich. */
  gefundeneRechte: DiscordPermissionName[];
}

export interface RollenAngabe {
  /** Rohe Permission-Bits als String, wie Discord sie liefert. */
  permissions: string;
  managed: boolean;
  position: number;
}

/**
 * Welche kritischen Rechte eine Rolle trägt.
 *
 * `ADMINISTRATOR` wird **nicht** zu «alle Rechte» aufgelöst. Hier soll stehen,
 * was tatsächlich gesetzt ist: «Administrator» ist eine klarere Auskunft als
 * eine Liste von sechs Rechten, die alle aus derselben Quelle stammen.
 */
export function kritischeRechteVon(permissions: string): DiscordPermissionName[] {
  /*
   * Unlesbar heisst nicht harmlos.
   *
   * Die Spalte kommt aus einem Zwischenspeicher und ist älter als der nächste
   * Stand des Codes. Was sich nicht lesen lässt, wird wie «Administrator»
   * behandelt - die andere Richtung wäre eine Rolle, die sich durch einen
   * kaputten Wert freikauft.
   *
   * Geprüft wird mit einem Muster und nicht nur mit `try`: `BigInt('')` ist
   * `0n` und wirft nicht. Ein leerer Wert sähe damit aus wie «keine Rechte» -
   * also wie die harmloseste Rolle des Servers, obwohl niemand weiss, was
   * dort stehen sollte. Dasselbe gilt für Leerzeichen und für ein Vorzeichen.
   */
  if (!/^\d+$/u.test(permissions)) {
    return ['ADMINISTRATOR'];
  }
  let bits: bigint;
  try {
    bits = BigInt(permissions);
  } catch {
    return ['ADMINISTRATOR'];
  }
  return KRITISCHE_RECHTE.filter((name) => (bits & DISCORD_PERMISSIONS[name]) !== 0n);
}

/**
 * Darf sich jemand diese Rolle selbst geben?
 *
 * `botPosition` ist die höchste Position der Bot-Rollen. `null` heisst «nicht
 * bekannt» - dann wird gesperrt und nicht durchgelassen: eine Hierarchie, die
 * sich gerade nicht abfragen lässt, ist kein Freibrief.
 */
export function pruefeSelbstzuweisung(eingabe: {
  rolle: RollenAngabe;
  selfAssignable: boolean;
  botPosition: number | null;
  /** Rollen, die das Mitglied bereits hat - für die Voraussetzung. */
  eigeneRollen?: readonly string[];
  voraussetzungRoleId?: string | null;
}): SelbstzuweisungsUrteil {
  const gefundeneRechte = kritischeRechteVon(eingabe.rolle.permissions);

  /*
   * Die Reihenfolge ist Absicht.
   *
   * Die kritischen Rechte stehen **vor** dem Haken: so sagt das Dashboard
   * auch bei einer nicht freigegebenen Rolle, dass sie ohnehin nie
   * freigegeben werden könnte. Das ist die nützlichere Auskunft - sonst
   * setzt jemand den Haken und wundert sich, dass nichts passiert.
   */
  if (gefundeneRechte.length > 0) {
    return {
      erlaubt: false,
      grund: 'kritische_rechte',
      text: 'Diese Rolle trägt Rechte, mit denen sich der Server verändern lässt. Sie kann nicht selbst vergeben werden.',
      gefundeneRechte,
    };
  }

  if (eingabe.rolle.managed) {
    return {
      erlaubt: false,
      grund: 'von_discord_verwaltet',
      text: 'Diese Rolle verwaltet Discord selbst - etwa eine Booster- oder Integrationsrolle. Kein Bot kann sie vergeben.',
      gefundeneRechte,
    };
  }

  if (eingabe.botPosition === null || eingabe.rolle.position >= eingabe.botPosition) {
    return {
      erlaubt: false,
      grund: 'ueber_der_bot_rolle',
      text: 'Diese Rolle liegt auf oder über der Rolle des Bots. Discord lässt ihn sie deshalb nicht vergeben.',
      gefundeneRechte,
    };
  }

  if (!eingabe.selfAssignable) {
    return {
      erlaubt: false,
      grund: 'nicht_freigegeben',
      text: 'Diese Rolle ist nicht zur Selbstvergabe freigegeben.',
      gefundeneRechte,
    };
  }

  if (eingabe.voraussetzungRoleId && !(eingabe.eigeneRollen ?? []).includes(eingabe.voraussetzungRoleId)) {
    return {
      erlaubt: false,
      grund: 'voraussetzung_fehlt',
      text: 'Für diese Rolle fehlt dir eine andere Rolle.',
      gefundeneRechte,
    };
  }

  return { erlaubt: true, grund: null, text: null, gefundeneRechte };
}
