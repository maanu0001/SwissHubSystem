import { AUDIT_ACTIONS, Prisma, prisma, recordAudit } from '@swisshub/database';
import type { Automation, AutomationConcurrency, AutomationKind } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conditionNodeSchema } from './conditions';
import { darfAusDiscordStarten } from './core-triggers';
import { getTrigger } from './registry';
import { planeNaechsten } from './dispatcher';
import { verwerfeJobs } from './scheduler';
import { stepsSchema } from './steps';
import { systemFreigabe } from './templates';

const logger = createLogger('automation:store');

/**
 * Lesen und Schreiben von Automationen.
 *
 * Zwei Dinge, die diese Datei anders macht als eine gewöhnliche CRUD-Schicht:
 *
 * 1. **Jede Änderung erzeugt eine Fassung.** Ein Lauf hält die Fassung fest,
 *    mit der er begonnen hat. Änderte jemand eine Automation, während ein Lauf
 *    zwischen zwei Schritten wartet, machte der Lauf sonst nach dem Aufwachen
 *    etwas anderes, als beim Start dastand (§12).
 * 2. **Löschen ist ein Archivieren.** Der Verlauf und die Prüfspur bleiben
 *    lesbar. Wer wissen will, warum vor drei Wochen tausend Nachrichten
 *    hinausgingen, findet die Automation sonst nicht mehr.
 */

export interface AutomationEingabe {
  guildId: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions?: unknown;
  steps: unknown;
  concurrency?: AutomationConcurrency;
  concurrencyKey?: string | null;
  maxRunsPerMinute?: number;
  kind?: AutomationKind;
  systemKey?: string | null;
}

export interface Akteur {
  discordId: string;
  username?: string | null;
}

/** Eine Automation samt ihrer Zählwerte für die Übersicht. */
export interface AutomationMitZahlen extends Automation {
  laeufe24h: number;
  fehler24h: number;
  /**
   * Wann sie das naechste Mal von selbst laeuft.
   *
   * `null` heisst «kein Termin bekannt» - entweder haengt sie an einem
   * Ereignis statt an einer Uhr, oder sie ist ausgeschaltet, oder es ist
   * gerade nichts eingeplant.
   *
   * Der Wert kommt aus dem eingeplanten Auftrag und wird nicht neu
   * ausgerechnet. Eine zweite Rechnung waere eine Vorhersage; der Auftrag ist
   * das, was tatsaechlich passieren wird - samt allem, was der Zeitplaner
   * inzwischen daran getan hat.
   */
  naechsterLauf: Date | null;
}

export async function holeAutomation(guildId: string, id: string): Promise<Automation | null> {
  // Die Gilde steht in der Abfrage, nicht in einer Nachprüfung: eine ID aus
  // einer fremden Gilde darf nicht einmal gelesen werden.
  return prisma.automation.findFirst({ where: { id, guildId } });
}

/**
 * Automationen, die diese Person aus Discord starten darf.
 *
 * Die Rollenpruefung passiert **hier**, nicht in der Oberflaeche des Befehls:
 * die Autocomplete-Liste ist keine Sicherheitsgrenze - wer einen Namen kennt,
 * kann ihn tippen, und Discord schickt ihn dann trotzdem. Deshalb fragen die
 * Vorschlagsliste und die Ausfuehrung dieselbe Funktion.
 *
 * Nur eingeschaltete, nicht archivierte Automationen mit dem Trigger
 * `discord`. Eine ausgeschaltete waere in der Liste eine Einladung zu einem
 * Befehl, der nichts tut.
 */
export async function listeDiscordStartbare(
  guildId: string,
  rollenDesMitglieds: readonly string[],
): Promise<Automation[]> {
  if (rollenDesMitglieds.length === 0) {
    // Ohne Rolle gibt es nichts zu pruefen. Die Abfrage zu sparen ist hier
    // nicht Sparsamkeit, sondern die richtige Antwort.
    return [];
  }
  const kandidaten = await prisma.automation.findMany({
    where: { guildId, archivedAt: null, enabled: true, triggerType: 'discord' },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return kandidaten.filter((automation) =>
    darfAusDiscordStarten(automation.triggerType, automation.triggerConfig, rollenDesMitglieds),
  );
}

export async function listeAutomationen(
  guildId: string,
  optionen: { nurAktive?: boolean; mitArchivierten?: boolean } = {},
): Promise<AutomationMitZahlen[]> {
  const automationen = await prisma.automation.findMany({
    where: {
      guildId,
      ...(optionen.mitArchivierten ? {} : { archivedAt: null }),
      ...(optionen.nurAktive ? { enabled: true } : {}),
    },
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    take: 500,
  });

  if (automationen.length === 0) {
    return [];
  }

  const seit = new Date(Date.now() - 24 * 3600_000);
  const gruppen = await prisma.automationRun.groupBy({
    by: ['automationId', 'status'],
    where: { guildId, createdAt: { gte: seit }, dryRun: false },
    _count: { _all: true },
  });

  const zahlen = new Map<string, { laeufe: number; fehler: number }>();
  for (const gruppe of gruppen) {
    const eintrag = zahlen.get(gruppe.automationId) ?? { laeufe: 0, fehler: 0 };
    eintrag.laeufe += gruppe._count._all;
    if (gruppe.status === 'FAILED' || gruppe.status === 'DEAD_LETTER') {
      eintrag.fehler += gruppe._count._all;
    }
    zahlen.set(gruppe.automationId, eintrag);
  }

  /*
   * Der naechste eingeplante Termin je Automation.
   *
   * Aus den offenen Auftraegen des Zeitplaners, nicht aus einer eigenen
   * Rechnung: was hier steht, ist der Auftrag, der tatsaechlich liegt. Nur
   * `PENDING` zaehlt - ein Auftrag, den sich gerade jemand geholt hat, laeuft
   * bereits und ist keine Ankuendigung mehr.
   *
   * Eine Abfrage fuer alle statt eine je Zeile: bei fuenfhundert Automationen
   * waeren das fuenfhundert Abfragen fuer eine Spalte.
   */
  const termine = new Map<string, Date>();
  const geplant = await prisma.automationJob.findMany({
    where: {
      guildId,
      status: 'PENDING',
      automationId: { in: automationen.map((eintrag) => eintrag.id) },
    },
    select: { automationId: true, runAt: true },
    orderBy: { runAt: 'asc' },
  });
  for (const auftrag of geplant) {
    if (auftrag.automationId && !termine.has(auftrag.automationId)) {
      termine.set(auftrag.automationId, auftrag.runAt);
    }
  }

  return automationen.map((automation) => ({
    ...automation,
    laeufe24h: zahlen.get(automation.id)?.laeufe ?? 0,
    fehler24h: zahlen.get(automation.id)?.fehler ?? 0,
    // Ausgeschaltet heisst: sie laeuft nicht von selbst. Ein Termin daneben
    // waere ein Versprechen, das der Schalter gerade bricht.
    naechsterLauf: automation.enabled ? (termine.get(automation.id) ?? null) : null,
  }));
}

/**
 * Die Bausteine einer Automation prüfen, ehe sie in die Datenbank gehen.
 *
 * Nur die Form, nicht die Umgebung - ob der Kanal noch existiert, klärt
 * `pruefeAutomation()` beim Einschalten. Beides hier zu tun hiesse, dass sich
 * ein Entwurf nicht speichern liesse, solange Discord gerade hakt.
 */
function pruefeForm(eingabe: AutomationEingabe): { steps: unknown; conditions: unknown } {
  const schritte = stepsSchema.safeParse(eingabe.steps);
  if (!schritte.success) {
    throw Object.assign(new Error('Schrittfolge ungültig'), {
      code: 'VALIDATION_FAILED',
      userMessage: schritte.error.issues[0]?.message ?? 'Die Schrittfolge ist ungültig.',
    });
  }

  if (eingabe.conditions === null || eingabe.conditions === undefined) {
    return { steps: schritte.data, conditions: null };
  }

  const bedingungen = conditionNodeSchema.safeParse(eingabe.conditions);
  if (!bedingungen.success) {
    throw Object.assign(new Error('Bedingungen ungültig'), {
      code: 'VALIDATION_FAILED',
      userMessage: bedingungen.error.issues[0]?.message ?? 'Die Bedingungen sind ungültig.',
    });
  }
  return { steps: schritte.data, conditions: bedingungen.data };
}

/**
 * Eine Fassung festhalten.
 *
 * Die Momentaufnahme enthält alles, was ein Lauf braucht - Auslöser,
 * Bedingungen, Schritte. Ein Lauf zeigt darauf und nicht auf die Automation
 * selbst; deshalb bleibt er nach einer Änderung derselbe Lauf.
 */
async function schreibeFassung(automation: Automation, akteur: Akteur | null, notiz?: string): Promise<void> {
  await prisma.automationVersion.upsert({
    where: { automationId_version: { automationId: automation.id, version: automation.version } },
    create: {
      automationId: automation.id,
      version: automation.version,
      snapshot: {
        name: automation.name,
        triggerType: automation.triggerType,
        triggerConfig: automation.triggerConfig,
        conditions: automation.conditions,
        steps: automation.steps,
      } as Prisma.InputJsonValue,
      createdBy: akteur?.discordId ?? null,
      note: notiz?.slice(0, 200) ?? null,
    },
    update: {},
  });
}

export async function legeAn(eingabe: AutomationEingabe, akteur: Akteur): Promise<Automation> {
  const { steps, conditions } = pruefeForm(eingabe);

  const automation = await prisma.automation.create({
    data: {
      guildId: eingabe.guildId,
      name: eingabe.name.trim().slice(0, 120),
      description: eingabe.description?.trim().slice(0, 500) ?? null,
      kind: eingabe.kind ?? 'USER',
      systemKey: eingabe.systemKey ?? null,
      triggerType: eingabe.triggerType,
      triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      concurrency: eingabe.concurrency ?? 'ALLOW',
      concurrencyKey: eingabe.concurrencyKey ?? null,
      maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
      // Neu ist immer aus. Wer sie einschaltet, hat sie gesehen - und die
      // Prüfung vor dem Einschalten hat stattgefunden (§22).
      enabled: false,
      createdBy: akteur.discordId,
      updatedBy: akteur.discordId,
    },
  });

  await schreibeFassung(automation, akteur, 'Angelegt');
  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_CREATED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: automation.name,
    metadata: { automationId: automation.id, triggerType: automation.triggerType },
  });

  return automation;
}

export async function aendere(
  guildId: string,
  id: string,
  eingabe: AutomationEingabe,
  akteur: Akteur,
): Promise<Automation> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }
  if (vorhanden.kind === 'SYSTEM') {
    /*
     * Eine Systemautomation gehört SwissHub, nicht der Gilde. Sie liesse sich
     * sonst so verändern, dass eine Kernfunktion still ausfällt - und beim
     * nächsten Start wäre die Änderung ohnehin wieder weg, weil der Abgleich
     * Name, Bedingungen und Schritte zurückschreibt.
     *
     * Was die Gilde ausfüllen darf, geht durch `aendereSystemfelder`. Diese
     * Tür bleibt zu: der allgemeine Editor schickt eine ganze Automation, und
     * davon dürfte hier fast nichts ankommen. Eine Absage ist ehrlicher, als
     * das meiste still zu verwerfen.
     */
    throw Object.assign(new Error('Systemautomation'), {
      code: 'FORBIDDEN',
      userMessage:
        'Bei einer Systemautomation lassen sich nur die freigegebenen Felder ändern, nicht der Ablauf.',
    });
  }

  const { steps, conditions } = pruefeForm(eingabe);

  const geaendert = await prisma.automation.update({
    where: { id },
    data: {
      name: eingabe.name.trim().slice(0, 120),
      description: eingabe.description?.trim().slice(0, 500) ?? null,
      triggerType: eingabe.triggerType,
      triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      concurrency: eingabe.concurrency ?? 'ALLOW',
      concurrencyKey: eingabe.concurrencyKey ?? null,
      maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
      version: { increment: 1 },
      updatedBy: akteur.discordId,
    },
  });

  await schreibeFassung(geaendert, akteur, 'Bearbeitet');

  // Geplante Termine gehören zur alten Fassung; sie werden verworfen und -
  // falls die Automation eingeschaltet ist - neu gesetzt.
  await verwerfeJobs(geaendert.id);
  if (geaendert.enabled) {
    await planeNaechsten(geaendert);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_UPDATED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: geaendert.name,
    metadata: { automationId: geaendert.id, version: geaendert.version },
  });

  return geaendert;
}

/**
 * Die freigegebenen Felder einer Systemautomation ändern.
 *
 * ## Warum es diese Tür überhaupt gibt
 *
 * Die Systemeinladung entsteht beim Start als Zeile - mit leerer Rollenliste,
 * weil nur der Server weiss, welche Rollen eine Einladung verschicken dürfen.
 * Ohne diese Funktion war sie damit unbenutzbar: `aendere` lehnte jede
 * Änderung ab, also blieb die Liste leer, also lehnte der Trigger jeden
 * Aufruf ab. Die Automation war vorhanden, abschaltbar, einschaltbar - und
 * tat nichts.
 *
 * ## Warum nicht einfach `aendere` öffnen
 *
 * Weil dann der ganze Builder auf eine Systemautomation losgelassen wäre:
 * Schritte umstellen, Bedingungen löschen, Text ändern. Beim nächsten Start
 * schreibt der Abgleich das alles zurück - die Änderung wäre weg, ohne dass
 * jemand etwas gemerkt hätte. Deshalb geht hier nur durch, was die Vorlage
 * als `auszufuellen` ausweist, und der Abgleich lässt `triggerConfig`
 * unangetastet. Beides zusammen ist die Zusage: was hier gespeichert wird,
 * bleibt auch nach einem Deployment stehen.
 *
 * `werte` ist nach Pfad geschlüsselt - genau nach den Pfaden der Vorlage.
 * Alles andere ist ein Fehler und nicht etwas, das still übergangen wird.
 */
export async function aendereSystemfelder(
  guildId: string,
  id: string,
  werte: Record<string, unknown>,
  akteur: Akteur,
): Promise<Automation> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }
  if (vorhanden.kind !== 'SYSTEM') {
    // Eine gewöhnliche Automation wird ganz gespeichert. Diese Tür hier wäre
    // ein zweiter Schreibweg auf dieselbe Zeile - und damit ein zweiter Ort,
    // an dem Prüfungen stehen müssten.
    throw Object.assign(new Error('Keine Systemautomation'), {
      code: 'VALIDATION_FAILED',
      userMessage: 'Diese Automation wird im Builder bearbeitet.',
    });
  }

  const freigegeben = new Set(systemFreigabe(vorhanden.systemKey).map((eintrag) => eintrag.pfad));
  const pfade = Object.keys(werte);
  if (freigegeben.size === 0 || pfade.length === 0) {
    throw Object.assign(new Error('Keine Freigabe'), {
      code: 'FORBIDDEN',
      userMessage: 'Bei dieser Systemautomation gibt es nichts zum Ausfüllen.',
    });
  }
  const fremd = pfade.filter((pfad) => !freigegeben.has(pfad));
  if (fremd.length > 0) {
    throw Object.assign(new Error('Pfad nicht freigegeben'), {
      code: 'FORBIDDEN',
      userMessage: 'Dieses Feld ist bei einer Systemautomation nicht freigegeben.',
    });
  }

  /*
   * Gearbeitet wird auf einer Kopie des Gespeicherten, nicht auf dem, was
   * hereinkam. So kann die Eingabe nichts mitbringen, wonach niemand gefragt
   * hat - weder ein zusätzliches Feld in der Trigger-Konfiguration noch ein
   * anderer Schritt.
   */
  const stand = {
    triggerConfig: klone(vorhanden.triggerConfig) as Record<string, unknown>,
    steps: klone(vorhanden.steps),
  };
  for (const pfad of pfade) {
    setzePfad(stand, pfad, werte[pfad]);
  }

  // Dieselbe Formprüfung wie bei jeder anderen Änderung, und dazu die des
  // Triggers: ein Pfad, der die Konfiguration ungültig macht, darf nicht
  // gespeichert werden, nur weil er freigegeben ist.
  const { steps, conditions } = pruefeForm({
    guildId,
    name: vorhanden.name,
    triggerType: vorhanden.triggerType,
    triggerConfig: stand.triggerConfig,
    conditions: vorhanden.conditions,
    steps: stand.steps,
  });
  pruefeTriggerKonfiguration(vorhanden.triggerType, stand.triggerConfig);

  const geaendert = await prisma.automation.update({
    where: { id },
    data: {
      triggerConfig: stand.triggerConfig as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      version: { increment: 1 },
      updatedBy: akteur.discordId,
    },
  });

  await schreibeFassung(geaendert, akteur, 'Freigegebene Felder bearbeitet');

  // Wie bei `aendere`: die geplanten Termine gehören zur alten Fassung. Ein
  // freigegebener Pfad kann eine Uhrzeit enthalten.
  await verwerfeJobs(geaendert.id);
  if (geaendert.enabled) {
    await planeNaechsten(geaendert);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_UPDATED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: geaendert.name,
    metadata: {
      automationId: geaendert.id,
      version: geaendert.version,
      systemKey: vorhanden.systemKey,
      pfade,
    },
  });

  return geaendert;
}

/** Eine tiefe Kopie eines JSON-Werts. */
function klone(wert: unknown): unknown {
  return wert === null || wert === undefined ? wert : (JSON.parse(JSON.stringify(wert)) as unknown);
}

/**
 * Welche Pfade überhaupt freigebbar sind.
 *
 * Nicht die Vorlage entscheidet das allein. Stünde dort eines Tages
 * `steps.0.typ`, liesse sich die Aktion austauschen - und damit aus einer
 * Direktnachricht ein Rollenentzug machen. Erlaubt ist deshalb nur, was ein
 * **Wert** ist: etwas in der Trigger-Konfiguration oder im `config` eines
 * Schritts.
 */
const VERBOTENE_SCHLUESSEL = new Set(['__proto__', 'prototype', 'constructor']);

function setzePfad(
  stand: { triggerConfig: Record<string, unknown>; steps: unknown },
  pfad: string,
  wert: unknown,
): void {
  const teile = pfad.split('.');
  if (teile.some((teil) => teil === '' || VERBOTENE_SCHLUESSEL.has(teil))) {
    throw Object.assign(new Error('Pfad unzulässig'), {
      code: 'FORBIDDEN',
      userMessage: 'Dieses Feld lässt sich nicht ändern.',
    });
  }

  const erlaubt =
    (teile[0] === 'triggerConfig' && teile.length >= 2) ||
    (teile[0] === 'steps' && teile.length >= 4 && teile[2] === 'config');
  if (!erlaubt) {
    throw Object.assign(new Error('Pfad unzulässig'), {
      code: 'FORBIDDEN',
      userMessage: 'Bei einer Systemautomation lassen sich nur Werte ausfüllen, nicht der Ablauf.',
    });
  }

  let ziel: unknown = stand;
  for (const teil of teile.slice(0, -1)) {
    if (ziel === null || typeof ziel !== 'object') {
      throw Object.assign(new Error('Pfad zeigt ins Leere'), {
        code: 'VALIDATION_FAILED',
        userMessage: 'Dieses Feld gibt es in dieser Automation nicht.',
      });
    }
    ziel = (ziel as Record<string, unknown>)[teil];
  }
  if (ziel === null || typeof ziel !== 'object') {
    throw Object.assign(new Error('Pfad zeigt ins Leere'), {
      code: 'VALIDATION_FAILED',
      userMessage: 'Dieses Feld gibt es in dieser Automation nicht.',
    });
  }
  (ziel as Record<string, unknown>)[teile[teile.length - 1] as string] = wert;
}

/**
 * Die Trigger-Konfiguration gegen das Schema des Triggers prüfen.
 *
 * `pruefeForm` prüft Schritte und Bedingungen; die Konfiguration des Triggers
 * kennt nur der Trigger selbst. Ist er nicht angemeldet - etwa weil sein Modul
 * aus ist - wird nicht geprüft und auch nicht abgelehnt: dann ist die
 * Automation ohnehin nicht einschaltbar, und das meldet die Prüfung vor dem
 * Einschalten.
 */
function pruefeTriggerKonfiguration(triggerType: string, config: Record<string, unknown>): void {
  const trigger = getTrigger(triggerType);
  const geprueft = trigger?.configSchema?.safeParse(config);
  if (geprueft && !geprueft.success) {
    throw Object.assign(new Error('Trigger-Konfiguration ungültig'), {
      code: 'VALIDATION_FAILED',
      userMessage: geprueft.error.issues[0]?.message ?? 'Die Eingabe passt nicht zu diesem Auslöser.',
    });
  }
}

/**
 * Ein- oder ausschalten.
 *
 * Die Prüfung vor dem Einschalten liegt bewusst **nicht** hier, sondern beim
 * Aufrufer: sie braucht einen Discord-Zugang, und diese Datei soll auch dort
 * benutzbar bleiben, wo keiner zur Verfügung steht.
 */
export async function schalte(
  guildId: string,
  id: string,
  eingeschaltet: boolean,
  akteur: Akteur,
): Promise<Automation> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }

  const geaendert = await prisma.automation.update({
    where: { id },
    data: { enabled: eingeschaltet, updatedBy: akteur.discordId },
  });

  if (eingeschaltet) {
    await planeNaechsten(geaendert);
  } else {
    // Offene Wecker verwerfen: eine ausgeschaltete Automation soll auch dann
    // nicht laufen, wenn ihr Termin bereits eingeplant war.
    const verworfen = await verwerfeJobs(id);
    if (verworfen > 0) {
      logger.info('Geplante Läufe verworfen', { automationId: id, anzahl: verworfen });
    }
  }

  await recordAudit({
    action: eingeschaltet ? AUDIT_ACTIONS.AUTOMATION_ENABLED : AUDIT_ACTIONS.AUTOMATION_DISABLED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: geaendert.name,
    metadata: { automationId: id },
  });

  return geaendert;
}

/**
 * Archivieren statt löschen.
 *
 * Die Zeile bleibt, damit der Verlauf lesbar bleibt; sie verschwindet aus
 * allen Listen und wird von keinem Verteiler mehr berücksichtigt, weil jede
 * Abfrage `archivedAt: null` verlangt.
 */
export async function archiviere(guildId: string, id: string, akteur: Akteur): Promise<void> {
  const vorhanden = await holeAutomation(guildId, id);
  if (!vorhanden) {
    throw Object.assign(new Error('Automation nicht gefunden'), {
      code: 'NOT_FOUND',
      userMessage: 'Diese Automation gibt es nicht.',
    });
  }
  if (vorhanden.kind === 'SYSTEM') {
    throw Object.assign(new Error('Systemautomation'), {
      code: 'FORBIDDEN',
      userMessage: 'Systemautomationen lassen sich nicht löschen.',
    });
  }

  await prisma.automation.update({
    where: { id },
    data: { enabled: false, archivedAt: new Date(), updatedBy: akteur.discordId },
  });
  await verwerfeJobs(id);

  await recordAudit({
    action: AUDIT_ACTIONS.AUTOMATION_DELETED,
    module: 'automation',
    actorDiscordId: akteur.discordId,
    actorUsername: akteur.username ?? null,
    targetLabel: vorhanden.name,
    metadata: { automationId: id },
  });
}

/**
 * Eine Systemautomation anlegen oder auffrischen.
 *
 * Systemautomationen gehören SwissHub: sie werden beim Start abgeglichen und
 * nicht von Hand gepflegt. Das Ein- und Ausschalten bleibt der Gilde
 * überlassen - deshalb wird `enabled` beim Auffrischen **nicht** überschrieben.
 */
export async function stelleSystemautomationSicher(
  eingabe: AutomationEingabe & { systemKey: string },
): Promise<Automation> {
  const { steps, conditions } = pruefeForm(eingabe);
  const vorhanden = await prisma.automation.findUnique({ where: { systemKey: eingabe.systemKey } });

  if (!vorhanden) {
    const automation = await prisma.automation.create({
      data: {
        guildId: eingabe.guildId,
        name: eingabe.name,
        description: eingabe.description ?? null,
        kind: 'SYSTEM',
        systemKey: eingabe.systemKey,
        triggerType: eingabe.triggerType,
        triggerConfig: eingabe.triggerConfig as Prisma.InputJsonValue,
        conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        steps: steps as Prisma.InputJsonValue,
        concurrency: eingabe.concurrency ?? 'ALLOW',
        concurrencyKey: eingabe.concurrencyKey ?? null,
        maxRunsPerMinute: eingabe.maxRunsPerMinute ?? 60,
        enabled: false,
      },
    });
    await schreibeFassung(automation, null, 'Systemautomation angelegt');
    return automation;
  }

  /*
   * Was SwissHub vorgibt und was der Gilde gehört.
   *
   * Vorgegeben sind Name, Beschreibung, Trigger**art**, Bedingungen und
   * Schritte - sie kommen aus der Vorlage und werden abgeglichen. Die
   * Trigger-**Konfiguration** gehört der Gilde: dort stehen die Werte, die
   * ein Teammitglied ausfüllt (welche Rollen, welcher Kanal). Sie wird beim
   * Anlegen gesetzt und danach nie wieder angefasst.
   *
   * Das ist nicht Bequemlichkeit, sondern der Grund, warum der Vergleich
   * hier überhaupt steht: wäre `triggerConfig` mit im Vergleich, würde eine
   * ausgefüllte Rollenliste bei jedem Start als «verändert» gelten - und
   * das `update` würde sie mit der leeren Vorlage überschreiben. Jeder
   * Neustart hätte die Einstellung der Gilde gelöscht.
   *
   * Die Bedingungen waren umgekehrt gar nicht im Vergleich: eine Vorlage,
   * die ihre Schritte behält und nur eine Bedingung dazubekommt, wäre
   * lautlos nie angekommen.
   */
  const unveraendert =
    JSON.stringify(vorhanden.steps) === JSON.stringify(steps) &&
    JSON.stringify(vorhanden.conditions ?? null) === JSON.stringify(conditions ?? null) &&
    vorhanden.name === eingabe.name &&
    vorhanden.description === (eingabe.description ?? null) &&
    vorhanden.triggerType === eingabe.triggerType;
  if (unveraendert) {
    return vorhanden;
  }

  const geaendert = await prisma.automation.update({
    where: { id: vorhanden.id },
    data: {
      name: eingabe.name,
      description: eingabe.description ?? null,
      triggerType: eingabe.triggerType,
      conditions: (conditions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      steps: steps as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  await schreibeFassung(geaendert, null, 'Systemautomation aufgefrischt');
  return geaendert;
}
