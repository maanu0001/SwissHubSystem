import 'server-only';
import { cache } from 'react';
import {
  listActions,
  listConditions,
  listEventDefinitions,
  listTemplates,
  listTriggers,
  systemFreigabe,
  type AutomationField,
} from '@swisshub/automation';

/**
 * Die Bausteine der Automation Engine, wie sie der Browser braucht.
 *
 * Die Registries leben im Server: sie enthalten Funktionen (`execute`,
 * `matches`, `evaluate`) und Zod-Schemata, und beides lässt sich weder
 * serialisieren noch gehört es in den Browser. Was hier entsteht, ist die
 * **Beschreibung** - Namen, Felder, Gruppen -, und die genügt dem Builder
 * vollständig.
 *
 * Der Builder kann damit für jedes Modul dasselbe Formular bauen, ohne ein
 * einziges Modul zu kennen. Ein neues Modul erscheint im Builder, sobald es
 * seine Trigger und Aktionen anmeldet - ohne Änderung an einer Datei hier.
 */

export interface BausteinAnsicht {
  id: string;
  label: string;
  description: string;
  group?: string;
  icon?: string;
  fields: AutomationField[];
  /** Nur bei Aktionen: die zusätzlich nötige Berechtigung. */
  requiredPermission?: string;
  /** Nur bei Aktionen: hält den Lauf an und wartet auf einen Menschen. */
  requiresApproval?: boolean;
}

export interface EreignisAnsicht {
  type: string;
  label: string;
  description: string;
  module: string;
  variablen: Array<{ path: string; label: string; type: string }>;
}

export interface VorlageAnsicht {
  id: string;
  name: string;
  description: string;
  gruppe: string;
  icon?: string;
  auszufuellen: Array<{ pfad: string; label: string }>;
}

export interface AutomationBausteine {
  trigger: BausteinAnsicht[];
  bedingungen: BausteinAnsicht[];
  aktionen: BausteinAnsicht[];
  ereignisse: EreignisAnsicht[];
  vorlagen: VorlageAnsicht[];
}

/**
 * Ein freigegebenes Feld einer Systemautomation - fertig zum Anzeigen.
 *
 * `pfad` ist, was gespeichert wird; `feld` ist, wie es aussieht. Beides
 * zusammenzufuehren ist Serverarbeit: die Feldbeschreibung steht in der
 * Registry, der Wert in der Datenbank, und die Freigabe in der Vorlage.
 */
export interface SystemFeld {
  pfad: string;
  label: string;
  feld: AutomationField;
  wert: unknown;
}

/**
 * Welche Felder einer Systemautomation die Gilde ausfuellen darf.
 *
 * Die Pfade kommen aus der Vorlage (`auszufuellen`), die Beschreibung des
 * Feldes aus der Registry des Triggers beziehungsweise der Aktion. Findet
 * sich zu einem Pfad keine Beschreibung, wird er **weggelassen** und nicht
 * als Textfeld geraten: ein falsch geratenes Feld schriebe einen Text dorthin,
 * wo eine Liste stehen muss.
 */
export function systemFelder(
  automation: {
    systemKey: string | null;
    triggerType: string;
    triggerConfig: unknown;
    steps: unknown;
  },
  bausteine: AutomationBausteine,
): SystemFeld[] {
  const felder: SystemFeld[] = [];

  for (const freigabe of systemFreigabe(automation.systemKey)) {
    const teile = freigabe.pfad.split('.');

    if (teile[0] === 'triggerConfig' && teile.length === 2) {
      const trigger = bausteine.trigger.find((eintrag) => eintrag.id === automation.triggerType);
      const feld = trigger?.fields.find((eintrag) => eintrag.key === teile[1]);
      if (feld) {
        felder.push({
          pfad: freigabe.pfad,
          label: freigabe.label,
          feld,
          wert: lesePfad(automation.triggerConfig, [teile[1] as string]),
        });
      }
      continue;
    }

    if (teile[0] === 'steps' && teile.length === 4 && teile[2] === 'config') {
      const schritte = Array.isArray(automation.steps) ? automation.steps : [];
      const schritt = schritte[Number(teile[1])] as { typ?: string } | undefined;
      const aktion = bausteine.aktionen.find((eintrag) => eintrag.id === schritt?.typ);
      const feld = aktion?.fields.find((eintrag) => eintrag.key === teile[3]);
      if (feld) {
        felder.push({
          pfad: freigabe.pfad,
          label: freigabe.label,
          feld,
          wert: lesePfad(automation.steps, teile.slice(1)),
        });
      }
    }
  }

  return felder;
}

/** Einen Wert entlang eines Pfads lesen. Gibt `undefined`, wenn er ins Leere zeigt. */
function lesePfad(wurzel: unknown, teile: string[]): unknown {
  let aktuell: unknown = wurzel;
  for (const teil of teile) {
    if (aktuell === null || typeof aktuell !== 'object') {
      return undefined;
    }
    aktuell = (aktuell as Record<string, unknown>)[teil];
  }
  return aktuell;
}

export const ladeBausteine = cache(async (): Promise<AutomationBausteine> => {
  return {
    trigger: listTriggers().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      fields: eintrag.fields,
    })),
    bedingungen: listConditions().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      group: eintrag.group,
      fields: eintrag.fields,
    })),
    aktionen: listActions().map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      description: eintrag.description,
      group: eintrag.group,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      fields: eintrag.fields,
      ...(eintrag.requiredPermission ? { requiredPermission: eintrag.requiredPermission } : {}),
      ...(eintrag.requiresApproval ? { requiresApproval: true } : {}),
    })),
    ereignisse: listEventDefinitions().map((eintrag) => ({
      type: eintrag.type,
      label: eintrag.label,
      description: eintrag.description,
      module: eintrag.module,
      variablen: (eintrag.variables ?? []).map((variable) => ({
        path: variable.path,
        label: variable.label,
        type: variable.type,
      })),
    })),
    vorlagen: listTemplates().map((eintrag) => ({
      id: eintrag.id,
      name: eintrag.name,
      description: eintrag.description,
      gruppe: eintrag.gruppe,
      ...(eintrag.icon ? { icon: eintrag.icon } : {}),
      auszufuellen: eintrag.auszufuellen ?? [],
    })),
  };
});
