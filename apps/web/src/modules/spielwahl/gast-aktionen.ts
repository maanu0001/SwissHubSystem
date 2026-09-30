'use server';

import { z } from 'zod';
import { spielwahl } from '@swisshub/modules';
import { defineOeffentlicheAktion } from '@/server/action';
import { spielwahlThema, wecke } from '@/server/live-bus';

/**
 * Was ein Gast in einer Spielauswahl tun darf.
 *
 * ## Vier Handlungen, und das ist die vollständige Liste
 *
 * Beitreten, abstimmen, ein Lebenszeichen senden, gehen. Nicht dabei und
 * absichtlich nicht dabei: ein Spiel vorschlagen, einen Vorschlag entfernen,
 * eine Phase öffnen oder schliessen, eine Runde starten, neu auslosen, ein
 * Ergebnis annehmen, die Einstellungen ändern, jemanden entfernen, die Runde
 * schliessen. Wer eines davon will, meldet sich an.
 *
 * Dass die Liste vollständig ist, folgt nicht aus einem Kommentar, sondern
 * daraus, dass es diese Datei ist: `defineOeffentlicheAktion` steht nur hier,
 * und jede andere Aktion des Moduls läuft durch `defineAction` mit Anmeldung,
 * Mitgliedschaft und Berechtigung. Eine fünfte Handlung hinzuzufügen heisst,
 * sie hier hinzuschreiben - und das fällt in einem Diff auf.
 *
 * ## Jede prüft zuerst denselben Satz
 *
 *     const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
 *
 * Das ist der Ersatz für Anmeldung, Mitgliedschaft und Berechtigung: die
 * Kennung muss die Form einer Gastkennung haben, die Runde muss Gäste
 * zulassen, und sie muss noch laufen. `tests/unit/action-authorization.test.ts`
 * verlangt diesen Aufruf von jeder Aktion in dieser Datei.
 *
 * ## Warum die Vorschlagssperre trotzdem im Modul steht
 *
 * Weil diese Datei nicht die einzige Verteidigung sein darf. `schlageVor`
 * weist eine Gastkennung selbst ab - auch dann, wenn eines Tages jemand einen
 * Aufruf von hier aus einbaut oder eine andere Stelle dieselbe Kennung
 * weiterreicht. Die Regel gehört dorthin, wo sie gilt, nicht dorthin, wo sie
 * gerade eingehalten wird.
 */

const sessionId = spielwahl.sessionIdSchema;

const anstossen = (id: string): void => {
  wecke(spielwahlThema(id));
};

/**
 * Als Gast beitreten.
 *
 * Der Name geht an `tritteBei` und wird dort geprüft - dieselbe Funktion, mit
 * der auch ein Mitglied beitritt. Sie setzt den Namen nur für eine
 * Gastkennung; einem Mitglied ihn mitzugeben wäre ein Weg, den Anzeigenamen in
 * der Teilnehmerliste frei zu wählen.
 *
 * Ohne Idempotenzschlüssel: `tritteBei` ist von sich aus idempotent - wer
 * schon dabei ist, bleibt dabei und erneuert nur sein Lebenszeichen.
 */
export const gastBeitretenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.join',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, name: spielwahl.gastNameSchema }),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    const art = await spielwahl.tritteBei(input.sessionId, besucher.kennung, input.name);
    anstossen(input.sessionId);
    return { art };
  },
);

/**
 * Als Gast abstimmen.
 *
 * Dieselbe Funktion wie für ein Mitglied, dieselbe Eindeutigkeit in der
 * Datenbank, dieselbe Umschaltlogik: derselbe Klick noch einmal nimmt die
 * Stimme zurück. Eine Gaststimme zählt wie jede andere - eine, die weniger
 * zählte, wäre eine Abstimmung, die niemand erklären kann.
 *
 * `verlangeTeilnahme` steht daneben, weil Zugang und Teilnahme zwei Dinge
 * sind: die Runde lässt Gäste zu, dieser Gast muss ausserdem beigetreten sein.
 */
export const gastStimmeAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.vote',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({
      sessionId,
      candidateId: z.string().trim().min(1).max(64),
      duell: z.coerce.number().int().min(0).max(999).default(0),
    }),
    rateLimit: 'spielwahlStimme',
  },
  async ({ besucher, input }) => {
    await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await spielwahl.verlangeTeilnahme(input.sessionId, besucher.kennung);
    await spielwahl.stimme(input.sessionId, besucher.kennung, input.candidateId, input.duell);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/**
 * Lebenszeichen.
 *
 * Ohne Wecken, wie beim Mitglied: sechs Browser, die sich gegenseitig alle
 * zwanzig Sekunden wecken, wären ein Polling mit Umweg.
 */
export const gastHierAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.ping',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await spielwahl.melde(input.sessionId, besucher.kennung);
    return { ok: true };
  },
);

/** Gehen. Die Zeile bleibt, damit abgegebene Stimmen ihren Absender behalten. */
export const gastVerlassenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.leave',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await spielwahl.verlasse(input.sessionId, besucher.kennung);
    anstossen(input.sessionId);
    return { ok: true };
  },
);
