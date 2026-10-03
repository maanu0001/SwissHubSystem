import { appUrl } from '@swisshub/config';
import { branding } from '@swisshub/config/client';
import type { DiscordGateway } from '@swisshub/discord';
import { LIMITS } from './contract';

/**
 * Der Kontext eines Laufs.
 *
 * Alles, was Bedingungen und Aktionen zu sehen bekommen. Was hier nicht
 * steht, ist ihnen nicht zugänglich - das ist Absicht: eine Aktion soll ein
 * Discord-Ereignis auswerten können, aber nicht die Umgebungsvariablen des
 * Prozesses lesen und keine beliebige Tabelle abfragen (§44).
 */
/**
 * Eine Person, wie eine Vorlage sie sieht.
 *
 * Bewusst knapp. Was hier nicht steht, ist einer Automation nicht zugänglich -
 * und es steht nichts darin, was nicht ohnehin jedes Mitglied im Server sieht:
 * Kennung, Anzeigename, Erwähnung, Bot-Kennzeichen, Beitrittsdatum.
 *
 * **Keine Rollen, keine E-Mail, kein Konto.** Rollen prüft man mit der
 * Bedingung `rolle`; sie in einen Platzhalter zu schreiben hiesse, eine
 * Rollenliste in eine Nachricht setzen zu können, die vielleicht in einem
 * öffentlichen Kanal landet.
 */
export interface AufgeloestePerson {
  id: string;
  /** Der Name, den der Server zeigt - Nickname, sonst globaler Name. */
  name: string;
  /** `<@id>` - damit Discord den Namen auflöst. */
  mention: string;
  istBot: boolean;
  /** ISO-Datum des Serverbeitritts, oder `null`. */
  beigetretenAm: string | null;
}

export interface AutomationContext {
  runId: string;
  automationId: string;
  guildId: string;
  correlationId: string;
  depth: number;
  /** Probelauf: Aktionen beschreiben sich, statt zu wirken. */
  dryRun: boolean;
  /** Der Discord-Zugang. Im Probelauf lesend verwendet, nie schreibend. */
  gateway: DiscordGateway;
  event: {
    id: string | null;
    type: string | null;
    actorId: string | null;
    subjectId: string | null;
    entityId: string | null;
    occurredAt: Date;
  };
  /** Die Nutzdaten des Ereignisses - schemageprüft veröffentlicht. */
  payload: Record<string, unknown>;
  /** Ergebnisse vorangegangener Schritte, unter ihrer Stellung. */
  steps: Record<string, unknown>;
  /** Zeitpunkt des Laufs. Für Zeitbedingungen und `{{now}}`. */
  now: Date;
  /**
   * Das betroffene Mitglied, **serverseitig aufgelöst**.
   *
   * ## Warum aufgelöst und nicht nachgeschlagen
   *
   * `{{user.name}}` soll in einer Nachricht stehen können, ohne dass die
   * Vorlage weiss, aus welchem Ereignis die Nutzdaten kommen. Vorher gab es
   * dafür nur `{{payload.displayName}}` - und das steht nur in den Nutzdaten
   * **dieses einen** Ereignistyps. Eine Vorlage, die bei `member.joined`
   * funktioniert und bei `level.up` eine leere Stelle zeigt, ist eine Vorlage,
   * die man zweimal baut.
   *
   * Aufgelöst wird **einmal je Lauf**, in `starte`, über den Discord-Zugang -
   * nicht beim Lesen des Platzhalters: `leseWert` ist synchron, und ein
   * Platzhalter in einer Schleife würde sonst zu einer Abfrage je
   * Vorkommen. Siehe `loeseUmfeldAuf`.
   *
   * `null`, wenn das Ereignis niemanden betrifft oder die Person den Server
   * verlassen hat. Ein Platzhalter darauf wird dann zur leeren Zeichenkette
   * und als fehlend gemeldet - wie jeder andere unbekannte Pfad.
   */
  user: AufgeloestePerson | null;
  /** Wer den Lauf ausgelöst hat - dieselbe Form, dieselbe Auflösung. */
  invoker: AufgeloestePerson | null;
  /** Die Gilde. Mehr als Kennung und Name gibt es hier nicht zu wissen. */
  guild: { id: string; name: string | null };
  /**
   * Feste Angaben über SwissHub selbst.
   *
   * Aus der Konfiguration, nie aus einer Eingabe: `{{system.loginUrl}}` ist
   * genau die Adresse, auf die auch die Anwendung verweist. Eine Automation
   * kann damit einen Einladungslink schreiben, ohne dass jemand eine Adresse
   * in ein Textfeld tippt - und damit ohne die Möglichkeit, dass dort
   * irgendwann eine fremde steht.
   */
  system: { name: string; appUrl: string; loginUrl: string };
  /**
   * Ereignisse, die dieser Lauf ausgelöst hat.
   *
   * Der Executor zählt mit; über `LIMITS.maxEmittedEvents` hinaus wird
   * abgebrochen (§16).
   */
  emitted: number;
}

/**
 * Die vier neuen Wurzeln mit ihren Vorgaben.
 *
 * Jeder Ort, an dem ein `AutomationContext` entsteht, ruft dies - der
 * Ausführer, der Verteiler, die Fortsetzung eines wartenden Laufs. Vier
 * Stellen, die vier Felder von Hand setzen, wären vier Gelegenheiten, eines zu
 * vergessen, und das vergessene wäre in einer Nachricht eine leere Stelle.
 *
 * `user` und `invoker` beginnen als `null`: wer dahintersteckt, weiss erst
 * `loeseUmfeldAuf`, und das braucht den Discord-Zugang.
 *
 * `system` dagegen steht sofort fest. Es kommt aus der Konfiguration und nicht
 * aus einer Eingabe - das ist der ganze Punkt: eine Automation schreibt damit
 * einen Einladungslink, ohne dass irgendwo eine Adresse in ein Textfeld
 * getippt wird.
 */
export function leeresUmfeld(
  guildId: string,
): Pick<AutomationContext, 'user' | 'invoker' | 'guild' | 'system'> {
  return {
    user: null,
    invoker: null,
    guild: { id: guildId, name: null },
    system: {
      name: branding.name,
      appUrl: appUrl('/'),
      loginUrl: appUrl('/login'),
    },
  };
}

/**
 * Eine Person für die Platzhalter auflösen.
 *
 * Über denselben Discord-Zugang, den auch die Bedingungen `rolle` und `istBot`
 * benutzen. Wer den Server verlassen hat, ergibt `null` - und ein Platzhalter
 * darauf wird zur leeren Zeichenkette und gemeldet. Das ist richtiger, als
 * einen Namen zu erfinden.
 */
async function loesePerson(
  gateway: DiscordGateway,
  discordId: string | null,
): Promise<AufgeloestePerson | null> {
  if (!discordId) {
    return null;
  }
  const mitglied = await gateway.members.get(discordId);
  if (!mitglied) {
    return null;
  }
  return {
    id: mitglied.discordId,
    name: mitglied.displayName,
    mention: `<@${mitglied.discordId}>`,
    istBot: mitglied.isBot,
    beigetretenAm: mitglied.joinedAt ? mitglied.joinedAt.toISOString() : null,
  };
}

/**
 * `user`, `invoker` und `guild` einmal je Lauf auflösen.
 *
 * ## Warum einmal und nicht beim Lesen
 *
 * `leseWert` ist synchron, und das soll es bleiben: ein Platzhalter in einer
 * Nachricht darf keine Netzanfrage sein. Eine Vorlage mit zehn
 * `{{user.name}}` wäre sonst zehn Abfragen, und eine Bedingung, die in einer
 * Gruppe mehrfach geprüft wird, noch einmal so viele.
 *
 * ## Warum höchstens zwei Abfragen
 *
 * Sind `subjectId` und `actorId` dieselbe Person - der häufige Fall, wenn
 * jemand etwas über sich auslöst -, wird einmal gefragt und das Ergebnis
 * geteilt.
 *
 * Fehler werden verschluckt. Ein Lauf soll nicht daran scheitern, dass
 * Discord gerade nicht antwortet; die Platzhalter bleiben dann leer und
 * erscheinen als fehlend.
 */
export async function loeseUmfeldAuf(context: AutomationContext): Promise<void> {
  try {
    const subjekt = context.event.subjectId;
    const akteur = context.event.actorId;

    context.user = await loesePerson(context.gateway, subjekt);
    context.invoker =
      akteur && akteur === subjekt ? context.user : await loesePerson(context.gateway, akteur);

    const gilde = await context.gateway.guild.get();
    if (gilde.name) {
      context.guild = { id: context.guildId, name: gilde.name };
    }
  } catch {
    // Siehe oben: leere Platzhalter statt eines abgebrochenen Laufs.
  }
}

// --- Variablenauflösung -----------------------------------------------------

/**
 * Was ein Pfad in `{{...}}` erreichen darf.
 *
 * Eine Freigabeliste und keine Sperrliste: was hier nicht steht, gibt es
 * nicht. Eine Sperrliste müsste jede künftige Gefahr vorwegnehmen; eine
 * Freigabeliste muss nur das Erlaubte kennen.
 */
const ERLAUBTE_WURZELN = new Set([
  'payload',
  'event',
  'steps',
  'guildId',
  'now',
  'runId',
  /*
   * Die vier neuen Wurzeln.
   *
   * Sie stehen hier und nicht in einer Sonderbehandlung, weil sie genau
   * dieselben Regeln bekommen sollen wie `payload`: ein Pfad, kein Ausdruck,
   * kein `__proto__`, und was ins Leere zeigt, wird zur leeren Zeichenkette
   * und gemeldet.
   *
   * Aufgelöst werden sie **vor** den Schritten, serverseitig, einmal je Lauf -
   * siehe `AutomationContext.user`. Eine Vorlage kann sie also lesen, aber
   * nicht beeinflussen.
   */
  'user',
  'invoker',
  'guild',
  'system',
]);

/**
 * Ein Pfad besteht aus Namen und Zahlen, getrennt durch Punkte.
 *
 * Kein `[`, kein `(`, kein Leerzeichen: damit lässt sich weder ein
 * Funktionsaufruf noch ein Indexzugriff auf etwas anderes als ein Feld
 * schreiben.
 */
const PFAD_MUSTER = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/u;

/** Namen, die auf dem Prototyp liegen und niemals gelesen werden dürfen. */
const VERBOTEN = new Set(['__proto__', 'constructor', 'prototype']);

export function istErlaubterPfad(pfad: string): boolean {
  if (!PFAD_MUSTER.test(pfad)) {
    return false;
  }
  const teile = pfad.split('.');
  if (!ERLAUBTE_WURZELN.has(teile[0]!)) {
    return false;
  }
  return !teile.some((teil) => VERBOTEN.has(teil));
}

/**
 * Einen Wert aus dem Kontext lesen.
 *
 * Gibt `undefined` zurück, wenn der Pfad nicht erlaubt ist oder ins Leere
 * zeigt. Wirft nie - eine fehlende Variable ist ein Anzeigeproblem, kein
 * Grund, einen Lauf abzubrechen.
 */
export function leseWert(context: AutomationContext, pfad: string): unknown {
  if (!istErlaubterPfad(pfad)) {
    return undefined;
  }
  const teile = pfad.split('.');
  let aktuell: unknown = {
    payload: context.payload,
    event: context.event,
    steps: context.steps,
    guildId: context.guildId,
    runId: context.runId,
    now: context.now,
    user: context.user,
    invoker: context.invoker,
    guild: context.guild,
    system: context.system,
  };

  for (const teil of teile) {
    if (aktuell === null || aktuell === undefined) {
      return undefined;
    }
    if (typeof aktuell !== 'object') {
      return undefined;
    }
    // `Object.hasOwn` statt `in`: sonst käme man an Geerbtes heran.
    if (!Object.hasOwn(aktuell as object, teil)) {
      return undefined;
    }
    aktuell = (aktuell as Record<string, unknown>)[teil];
  }
  return aktuell;
}

/** Wie ein Wert in einem Text erscheint. */
function alsText(wert: unknown): string {
  if (wert === null || wert === undefined) {
    return '';
  }
  if (wert instanceof Date) {
    return wert.toISOString();
  }
  if (typeof wert === 'string') {
    return wert;
  }
  if (typeof wert === 'number' || typeof wert === 'boolean' || typeof wert === 'bigint') {
    return String(wert);
  }
  // Objekte und Listen werden nicht ausgeschrieben: `[object Object]` in
  // einer Discord-Nachricht hilft niemandem, und ein ganzes JSON darin wäre
  // eine unfreiwillige Datenausgabe.
  return '';
}

export interface RenderErgebnis {
  text: string;
  /** Pfade, die ins Leere zeigten. Der Builder zeigt sie als Warnung. */
  fehlend: string[];
}

/**
 * Einen Text mit `{{pfad}}` auflösen.
 *
 * **Kein `eval`, keine Ausdrücke, keine Funktionsaufrufe.** Ein Platzhalter
 * ist ein Pfad in eine Freigabeliste und sonst nichts. Damit ist die
 * Automation Engine keine Plattform, auf der sich Code ausführen lässt (§44) -
 * auch dann nicht, wenn jemand mit Schreibrecht auf Automationen es versucht.
 *
 * Ein unbekannter Pfad wird zur leeren Zeichenkette und gemeldet, nicht zum
 * Fehler: eine Nachricht ohne den Anzeigenamen ist besser als keine
 * Nachricht.
 */
export function render(vorlage: string, context: AutomationContext): RenderErgebnis {
  const fehlend: string[] = [];
  const text = vorlage.replace(/\{\{\s*([^}]{1,120}?)\s*\}\}/gu, (_treffer, roh: string) => {
    const pfad = roh.trim();
    if (!istErlaubterPfad(pfad)) {
      fehlend.push(pfad);
      return '';
    }
    const wert = leseWert(context, pfad);
    if (wert === undefined) {
      fehlend.push(pfad);
      return '';
    }
    return alsText(wert);
  });

  return {
    text: text.length > LIMITS.maxRenderedChars ? text.slice(0, LIMITS.maxRenderedChars) : text,
    fehlend,
  };
}

/** Welche Platzhalter in einem Text stehen - für die Prüfung vor dem Einschalten. */
export function findePlatzhalter(vorlage: string): string[] {
  const treffer = [...vorlage.matchAll(/\{\{\s*([^}]{1,120}?)\s*\}\}/gu)];
  return [...new Set(treffer.map((eintrag) => (eintrag[1] ?? '').trim()))];
}

/**
 * Alle Textfelder einer Konfiguration auflösen.
 *
 * Rekursiv über Objekte und Listen, aber begrenzt in der Tiefe: eine
 * Konfiguration ist ein flaches Gebilde, und eine unbegrenzte Rekursion wäre
 * eine Einladung.
 */
export function renderConfig<T>(config: T, context: AutomationContext, tiefe = 0): T {
  if (tiefe > 6) {
    return config;
  }
  if (typeof config === 'string') {
    return render(config, context).text as unknown as T;
  }
  if (Array.isArray(config)) {
    return config.map((eintrag) => renderConfig(eintrag, context, tiefe + 1)) as unknown as T;
  }
  if (config && typeof config === 'object') {
    const ergebnis: Record<string, unknown> = {};
    for (const [schluessel, wert] of Object.entries(config as Record<string, unknown>)) {
      if (VERBOTEN.has(schluessel)) {
        continue;
      }
      ergebnis[schluessel] = renderConfig(wert, context, tiefe + 1);
    }
    return ergebnis as unknown as T;
  }
  return config;
}
