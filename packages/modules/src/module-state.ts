import { bumpConfigRevision, prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleDefinition, listModuleDefinitions, type ModuleDefinition } from './registry';

const log = createLogger('modules');

/**
 * Der Zustand eines Moduls - drei Werte, nicht zwei.
 *
 * ## Warum drei
 *
 * Ein Modul kann fertig deployed sein und trotzdem noch nicht der Community
 * gehoeren. Bisher gab es dafuer nur «aus» - und ein abgeschaltetes Modul
 * kann niemand testen, auch kein Admin. Wer ausprobieren wollte, ob etwas
 * funktioniert, musste es fuer alle einschalten.
 *
 * `TESTMODUS` ist die fehlende Stufe: das Modul laeuft, seine Jobs laufen,
 * seine Seiten antworten - aber nur fuer berechtigte Admins und Moderatoren.
 *
 * ## Warum kein Enum in der Datenbank
 *
 * Weil `enabled` bleiben soll, was es ist. Hundert Stellen fragen
 * `isModuleEnabled`, und fuer sie alle gilt unveraendert: ein Modul im
 * Testmodus **laeuft**. Ein Enum haette jede dieser Stellen zu einer Frage
 * gemacht, die sie vorher nicht stellen musste - und jede vergessene waere
 * ein Modul, das im Testmodus stillschweigend aussetzt.
 *
 * Der Testmodus ist deshalb eine **zusaetzliche** Spalte und eine
 * **zusaetzliche** Pruefung: wer das Modul benutzen will, braucht weiterhin
 * seine Berechtigung - und im Testmodus zusaetzlich einen Platz im Team.
 */
export type ModulStatus = 'AKTIV' | 'TESTMODUS' | 'DEAKTIVIERT';

/**
 * Aktivierungszustand und Einstellungen der Module (Datenbank als Source of Truth).
 */
export interface ModuleStatusEntry {
  definition: ModuleDefinition;
  enabled: boolean;
  /** Laeuft, aber nur fuer berechtigte Teammitglieder. */
  testMode: boolean;
  /** Die drei Zustaende als ein Wert - fuer Anzeige und Vergleich. */
  status: ModulStatus;
  updatedAt: Date | null;
}

/** Aus den zwei Spalten der eine Status. */
export function modulStatus(enabled: boolean, testMode: boolean): ModulStatus {
  if (!enabled) {
    return 'DEAKTIVIERT';
  }
  return testMode ? 'TESTMODUS' : 'AKTIV';
}

export async function listModuleStatus(): Promise<ModuleStatusEntry[]> {
  const rows = await prisma.moduleState.findMany();
  const byId = new Map(rows.map((row) => [row.moduleId, row]));

  return listModuleDefinitions().map((definition) => {
    const row = byId.get(definition.id);
    const enabled = definition.core ? true : (row?.enabled ?? definition.defaultEnabled);
    /*
     * Kernbereiche kennen keinen Testmodus.
     *
     * Sie lassen sich auch nicht abschalten - «Mein Profil» im Testmodus
     * waere ein System ohne Profilseite. Dieselbe Begruendung, dieselbe
     * Ausnahme, an derselben Stelle.
     */
    const testMode = definition.core ? false : (row?.testMode ?? false);
    return {
      definition,
      enabled,
      testMode,
      status: modulStatus(enabled, testMode),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function enabledModuleIds(): Promise<Set<string>> {
  const status = await listModuleStatus();
  return new Set(status.filter((entry) => entry.enabled).map((entry) => entry.definition.id));
}

/**
 * Die Module, die gerade im Testmodus laufen.
 *
 * Getrennt von `enabledModuleIds`, weil es zwei verschiedene Fragen sind:
 * «laeuft das Modul?» und «darf die Community es sehen?». Die Seitenleiste
 * braucht beide.
 */
export async function testModusModulIds(): Promise<Set<string>> {
  const status = await listModuleStatus();
  return new Set(status.filter((entry) => entry.testMode).map((entry) => entry.definition.id));
}

/**
 * Der Status eines einzelnen Moduls.
 *
 * Fuer Hintergrundjobs, die wissen muessen, ob ihr Ergebnis die Community
 * erreichen darf - eine Ankuendigung im Discord ist eine Community-Aktion,
 * auch wenn der Job selbst harmlos ist.
 */
export async function getModulStatus(moduleId: string): Promise<ModulStatus> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    return 'DEAKTIVIERT';
  }
  if (definition.core) {
    return 'AKTIV';
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  return modulStatus(row?.enabled ?? definition.defaultEnabled, row?.testMode ?? false);
}

export async function isModuleEnabled(moduleId: string): Promise<boolean> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    return false;
  }
  if (definition.core) {
    return true;
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  return row?.enabled ?? definition.defaultEnabled;
}

export async function setModuleEnabled(moduleId: string, enabled: boolean, updatedBy: string): Promise<void> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new Error(`Unbekanntes Modul: ${moduleId}`);
  }
  if (definition.core) {
    throw new Error('Kernbereiche können nicht deaktiviert werden.');
  }
  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled, updatedBy },
    update: { enabled, updatedBy },
  });

  // Der Zähler verwirft die Caches von Bot und WebApp. Ohne ihn würde ein
  // abgeschaltetes Modul weiterlaufen, bis der jeweilige Cache von selbst
  // abläuft - beim Level-System hiesse das: weiter XP vergeben.
  await bumpConfigRevision(`module.${moduleId}.enabled`, updatedBy);

  log.info('Modulzustand geändert', { moduleId, enabled, updatedBy });
}

/**
 * Den Testmodus eines Moduls setzen.
 *
 * ## Warum das nicht `setModuleEnabled` mit drei Werten ist
 *
 * Weil der Aufrufer sonst bei jedem Umschalten beide Spalten kennen muesste.
 * `setModulStatus` unten nimmt den Status und uebersetzt ihn - das ist die
 * Form, die die Oberflaeche braucht. Diese Funktion ist die schmale Kante
 * darunter.
 */
export async function setModuleTestMode(
  moduleId: string,
  testMode: boolean,
  updatedBy: string,
): Promise<void> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new Error(`Unbekanntes Modul: ${moduleId}`);
  }
  if (definition.core) {
    throw new Error('Kernbereiche kennen keinen Testmodus.');
  }
  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled: definition.defaultEnabled, testMode, updatedBy },
    update: { testMode, updatedBy },
  });

  /*
   * Derselbe Zaehler wie beim Ein- und Ausschalten.
   *
   * Der Testmodus entscheidet, wer ein Modul sehen darf - ein Cache, der ihn
   * nicht mitbekommt, zeigt es der Community weiter an. Dass hier
   * `.enabled` im Schluessel steht, ist Absicht: es ist derselbe Cache, und
   * zwei Schluessel fuer denselben Zustand waeren zwei Gelegenheiten, einen
   * davon zu vergessen.
   */
  await bumpConfigRevision(`module.${moduleId}.enabled`, updatedBy);

  log.info('Testmodus geändert', { moduleId, testMode, updatedBy });
}

/**
 * Den Status eines Moduls setzen - die eine Stelle fuer alle drei Werte.
 *
 * Beide Spalten in **einem** Schreibvorgang. Wer `AKTIV` auf `DEAKTIVIERT`
 * setzt und dabei den Testmodus stehen liesse, haette ein Modul, das beim
 * naechsten Einschalten unerwartet im Testmodus landet.
 */
export async function setModulStatus(
  moduleId: string,
  status: ModulStatus,
  updatedBy: string,
): Promise<void> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new Error(`Unbekanntes Modul: ${moduleId}`);
  }
  if (definition.core) {
    throw new Error('Kernbereiche können nicht umgeschaltet werden.');
  }

  const enabled = status !== 'DEAKTIVIERT';
  const testMode = status === 'TESTMODUS';

  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled, testMode, updatedBy },
    update: { enabled, testMode, updatedBy },
  });

  await bumpConfigRevision(`module.${moduleId}.enabled`, updatedBy);
  log.info('Modulstatus geändert', { moduleId, status, updatedBy });
}

/**
 * Liest die Einstellungen eines Moduls und validiert sie gegen das Schema.
 * Ungültige oder fehlende Werte fallen auf die Defaults zurück (Fail Safe).
 */
export async function getModuleSettings<T>(moduleId: string): Promise<T> {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.settingsSchema) {
    return {} as T;
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  const parsed = definition.settingsSchema.safeParse(row?.settings ?? {});
  if (!parsed.success) {
    log.warn('Ungültige Moduleinstellungen - Defaults werden verwendet', {
      moduleId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return definition.settingsSchema.parse({}) as T;
  }
  return parsed.data as T;
}

export async function setModuleSettings<T>(
  moduleId: string,
  settings: unknown,
  updatedBy: string,
): Promise<T> {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.settingsSchema) {
    throw new Error(`Modul ${moduleId} besitzt keine Einstellungen.`);
  }
  const parsed = definition.settingsSchema.parse(settings);
  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled: definition.defaultEnabled, settings: parsed, updatedBy },
    update: { settings: parsed, updatedBy },
  });
  return parsed as T;
}
