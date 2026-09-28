import 'server-only';
import { missions } from '@swisshub/modules';
import type { TypAuswahl } from '@/modules/missions/components/missions-formular';

/**
 * Die Missionstypen fuer die Auswahlfelder.
 *
 * ## Warum das hier steht und nicht in der Komponente
 *
 * Die Registry in `typen.ts` traegt je Typ eine **Funktion**, die die
 * Datenbank befragt. Die laesst sich nicht an eine Client-Komponente
 * uebergeben - Next.js serialisiert die Eigenschaften, und eine Funktion
 * ueberlebt das nicht.
 *
 * Deshalb wird hier abgeschnitten, was die Oberflaeche braucht: Bezeichnung,
 * Einheit, Erklaerung, Vorschlag. Die Messung bleibt serverseitig, wo sie
 * hingehoert - eine Oberflaeche, die selbst messen koennte, waere eine
 * Oberflaeche, der man beim Messen zusehen sollte.
 */
export function typAuswahl(): TypAuswahl[] {
  return missions.missionTypen().map((typ) => ({
    key: typ.key,
    label: typ.label,
    einheit: typ.einheit,
    erklaerung: typ.erklaerung,
    zielVorschlag: typ.zielVorschlag,
    summierbar: typ.summierbar,
  }));
}
