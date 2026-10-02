'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { spielwahl } from '@swisshub/modules';
import { notFound, systemRoutes } from '@swisshub/shared';
import { defineOeffentlicheAktion } from '@/server/action';
import { spielwahlThema, wecke } from '@/server/live-bus';

/**
 * Was ein Besucher ohne Konto in einer Spielauswahl tun darf.
 *
 * ## Der ganze gewöhnliche Ablauf
 *
 * Eine Runde eröffnen, beitreten, Spiele vorschlagen, einen Vorschlag
 * zurücknehmen, abstimmen, die Vorschlagsphase schliessen und wieder öffnen,
 * den Modus wechseln, die Runde starten, einmal neu auslosen, das Ergebnis
 * annehmen, noch eine Runde anhängen, ein Lebenszeichen senden, gehen, die
 * eigene Runde beenden.
 *
 * Hier standen einmal **vier** Handlungen - beitreten, abstimmen,
 * Lebenszeichen, gehen - und daneben der Satz «und das ist die vollständige
 * Liste». Er war die Umsetzung einer Gastrolle als Zuschauerrolle, und er war
 * der Grund, warum «Was spielen wir» ohne Login nicht funktionierte: wer
 * keinen Account hat, konnte keine Runde eröffnen, und wer eine eröffnet
 * bekam, konnte nichts darin vorschlagen. Die Begründung dafür steht in
 * `spielwahl/gast.ts`.
 *
 * ## Was weiterhin nicht hier steht
 *
 * Drei Dinge, und jedes aus einem eigenen Grund:
 *
 *  - **Den Spielkatalog pflegen.** Er gehört allen Modulen und überlebt jede
 *    Runde; wer ihn ändert, ändert etwas für Leute, die nicht dabei sind. Das
 *    liegt in `games-aktionen.ts` hinter `spielwahl.manage`.
 *  - **Fremde Runden moderieren.** `spielwahlSchliessenAction` kennt dafür den
 *    Weg `alsModeration`; hier gibt es ihn nicht, und ein Test prüft, dass das
 *    Wort in dieser Datei nicht vorkommt.
 *  - **Jemanden ernennen oder entfernen** (`setzeCoHost`, `uebergib`,
 *    `entferne`). Es gibt keine Oberfläche dafür, und eine Handlung ohne
 *    Oberfläche braucht keinen öffentlichen Endpunkt.
 *
 * ## Jede prüft zuerst denselben Satz
 *
 *     await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
 *
 * Das ist der Ersatz für Anmeldung, Mitgliedschaft und Berechtigung: die
 * Kennung muss die Form einer Gastkennung haben, die Runde muss Gäste
 * zulassen, und sie muss noch laufen. `tests/unit/action-authorization.test.ts`
 * verlangt diesen Aufruf von jeder Aktion in dieser Datei - ausdrücklich im
 * Rumpf jeder einzelnen und nicht in einer gemeinsamen Hilfsfunktion, damit
 * eine Aktion ohne Prüfung in einem Diff auffällt und nicht in einem
 * Aufrufgraph verschwindet.
 *
 * Die eine Ausnahme ist das **Eröffnen**: dort gibt es noch keine Runde, zu
 * der es Zugang zu prüfen gäbe. An ihre Stelle tritt
 * `verlangeGastEroeffnung` - die Servereinstellung und die absolute Grenze
 * gleichzeitig offener Gastrunden. Derselbe Test verlangt eines von beiden.
 *
 * ## Was danach kommt, prüft das Modul
 *
 * Führung (`verlangeFuehrung`), Teilnahme (`verlangeTeilnahme`), Zustand
 * (die Statusmaschine) und Kontingente stehen im Modul und gelten für
 * Mitglied und Gast gleich. Diese Datei richtet nichts ein, was es dort nicht
 * gibt - sie reicht eine andere Art von Identität hinein.
 */

const sessionId = spielwahl.sessionIdSchema;
const schluessel = spielwahl.befehlsSchluessel;

const anstossen = (id: string): void => {
  wecke(spielwahlThema(id));
};

const neuLaden = (): void => {
  revalidatePath(systemRoutes.spielwahl());
};

/**
 * Die Guild der Runde gegen die eigene prüfen.
 *
 * `verlangeGastZugang` gibt sie zurück, weil sie ohnehin gelesen wird. Eine
 * Runde einer fremden Guild soll sich auch dann nicht bedienen lassen, wenn
 * ihre Kennung bekannt ist - dieselbe Zusicherung, die `ladeSession` den
 * Mitgliedsaktionen gibt.
 */
async function verlangeEigeneGuild(session: { guildId: string }): Promise<void> {
  if (session.guildId !== (await resolveGuildId())) {
    throw notFound('spielwahl: Session einer fremden Guild', 'Diese Runde gibt es nicht.');
  }
}

/**
 * Die Führung dieser Runde - und wer handelt.
 *
 * Zwei Dinge in einem Aufruf, weil sie zusammengehören: wer nicht führt,
 * bekommt hier die Absage, und wer führt, braucht für das Protokoll einen
 * Namen. Der Name kommt aus der Teilnehmerzeile und nicht aus der Eingabe -
 * er steht dort, weil der Gast ihn beim Beitreten eingetragen hat.
 */
async function alsFuehrung(id: string, kennung: string): Promise<spielwahl.Handelnder> {
  await spielwahl.verlangeFuehrung(id, kennung);
  return spielwahl.handelnderGast(id, kennung);
}

// ---------------------------------------------------------------------------
// Eröffnen, beitreten, verlassen
// ---------------------------------------------------------------------------

/**
 * Eine Runde eröffnen, ohne Konto.
 *
 * Der Name ist Pflicht und nicht Beiwerk: der Eröffner wird Host und steht
 * damit in der Teilnehmerliste und auf der Übersicht. «Gast» stünde dort bei
 * drei Runden dreimal.
 *
 * Es ist dieselbe `eroeffne` wie beim Mitglied, mit denselben Vorgaben und
 * denselben Grenzen. Zusätzlich gilt `verlangeGastEroeffnung`.
 */
export const gastEroeffnenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.session.create',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ name: spielwahl.gastNameSchema }).and(spielwahl.sessionEinstellungenSchema),
    rateLimit: 'spielwahlEroeffnen',
  },
  async ({ besucher, input }) => {
    const guildId = await resolveGuildId();
    await spielwahl.verlangeGastEroeffnung(guildId);

    const { name, ...optionen } = input;
    const session = await spielwahl.eroeffne({
      guildId,
      host: { discordId: besucher.kennung, username: name },
      optionen,
    });
    neuLaden();
    return { sessionId: session.id, inviteToken: session.inviteToken };
  },
);

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
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const art = await spielwahl.tritteBei(input.sessionId, besucher.kennung, input.name);
    anstossen(input.sessionId);
    return { art };
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
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await spielwahl.verlasse(input.sessionId, besucher.kennung);
    anstossen(input.sessionId);
    neuLaden();
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

// ---------------------------------------------------------------------------
// Vorschlagen
// ---------------------------------------------------------------------------

/**
 * Ein Spiel vorschlagen.
 *
 * Die Grenzen sind dieselben wie beim Mitglied und stehen alle im Modul: das
 * Kontingent je Person, der Katalogzwang, wenn freie Titel aus sind, und der
 * Zustand der Runde. Ein freier Titel landet nicht im Katalog, sondern bleibt
 * als `freierName` in dieser Runde.
 */
export const gastVorschlagAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.candidate.add',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }).and(spielwahl.kandidatSchema),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await spielwahl.verlangeTeilnahme(input.sessionId, besucher.kennung);

    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'suggest',
        discordId: besucher.kennung,
      },
      () =>
        spielwahl.schlageVor(input.sessionId, besucher.kennung, {
          gameId: input.gameId,
          freierName: input.freierName,
        }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

/** Den eigenen Vorschlag zurücknehmen. Wirkt nur auf die eigene Unterstützung. */
export const gastZurueckziehenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.candidate.withdraw',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, candidateId: z.string().trim().min(1).max(64) }),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await spielwahl.nimmZurueck(input.sessionId, besucher.kennung, input.candidateId);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/** Einen fremden Kandidaten entfernen - nur die Führung dieser Runde. */
export const gastKandidatEntfernenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.candidate.remove',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, candidateId: z.string().trim().min(1).max(64) }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.entferneKandidat(input.sessionId, input.candidateId);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/**
 * Die Spielsuche für das Vorschlagsfeld.
 *
 * Sie liest den gemeinsamen Katalog und schreibt nichts. Der Gastzugang wird
 * trotzdem geprüft: eine Suche, die jeder ohne Runde aufrufen kann, wäre ein
 * offener Katalogabzug - und die Runde ist der Anlass, aus dem gesucht wird.
 */
export const gastSpieleSuchenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.games.search',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, query: z.string().trim().max(60).default('') }),
    rateLimit: 'spielwahlMitmachen',
  },
  async ({ besucher, input }) => {
    await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    return { spiele: await spielwahl.sucheSpiele(input.query) };
  },
);

// ---------------------------------------------------------------------------
// Führung der eigenen Runde
// ---------------------------------------------------------------------------

/** Die Vorschlagsphase schliessen. */
export const gastPhaseSchliessenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.phase.close',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'close-phase',
        discordId: besucher.kennung,
      },
      async () => {
        await spielwahl.schliesseVorschlaege(input.sessionId, wer);
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/** Die Vorschlagsphase wieder öffnen. */
export const gastPhaseOeffnenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.phase.reopen',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'reopen',
        discordId: besucher.kennung,
      },
      async () => {
        await spielwahl.oeffneVorschlaege(input.sessionId, wer);
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/**
 * Die Regeln der Runde ändern.
 *
 * Dasselbe Schema wie beim Mitglied, und derselbe Riegel im Modul: die
 * Servervorgabe ist die Obergrenze, und in einer Gastrunde lässt sich die
 * Teilnahme ohne Konto nicht abschalten - sie ist die Tür, durch die der Host
 * selbst hereingekommen ist.
 */
export const gastModusSetzenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.mode.set',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId }).and(spielwahl.sessionEinstellungenSchema),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.aendereEinstellungen(input.sessionId, input);
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/** Die Entscheidung starten. */
export const gastStartenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.round.start',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'start',
        discordId: besucher.kennung,
      },
      async () => ({ rundenId: await spielwahl.starte(input.sessionId, wer) }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

/** Einmal neu auslosen - das Modul lässt es genau einmal je Auswahl zu. */
export const gastNeuLosenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.round.reroll',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    const ergebnis = await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'reroll',
        discordId: besucher.kennung,
      },
      async () => ({ rundenId: await spielwahl.loseNeu(input.sessionId, wer) }),
    );
    anstossen(input.sessionId);
    return ergebnis;
  },
);

/** Noch eine Runde mit derselben Gruppe. */
export const gastNochEineAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.round.again',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'again',
        discordId: besucher.kennung,
      },
      async () => {
        await spielwahl.nochEine(input.sessionId, wer);
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    return { ok: true };
  },
);

/** Das Ergebnis annehmen. Damit ist die Runde vorbei. */
export const gastAnnehmenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.result.accept',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId, schluessel }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.einmalig(
      {
        sessionId: input.sessionId,
        schluessel: input.schluessel,
        befehl: 'accept',
        discordId: besucher.kennung,
      },
      async () => {
        await spielwahl.nimmAn(input.sessionId, wer);
        return { ok: true };
      },
    );
    anstossen(input.sessionId);
    neuLaden();
    return { ok: true };
  },
);

/**
 * Die eigene Runde beenden.
 *
 * **Nur die eigene.** Den Weg `alsModeration`, über den
 * `spielwahlSchliessenAction` eine fremde Runde schliessen kann, gibt es hier
 * nicht - er hängt an `spielwahl.manage`, und eine Berechtigung hat ein Gast
 * strukturell nicht. `alsFuehrung` ist die ganze Erlaubnis.
 */
export const gastSchliessenAction = defineOeffentlicheAktion(
  {
    name: 'spielwahl.gast.session.close',
    module: spielwahl.SPIELWAHL_MODULE_ID,
    schema: z.object({ sessionId }),
    rateLimit: 'spielwahlFuehrung',
  },
  async ({ besucher, input }) => {
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    const wer = await alsFuehrung(input.sessionId, besucher.kennung);
    await spielwahl.schliesse(input.sessionId, wer);
    anstossen(input.sessionId);
    neuLaden();
    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Abstimmen
// ---------------------------------------------------------------------------

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
    const session = await spielwahl.verlangeGastZugang(input.sessionId, besucher.kennung);
    await verlangeEigeneGuild(session);
    await spielwahl.verlangeTeilnahme(input.sessionId, besucher.kennung);
    await spielwahl.stimme(input.sessionId, besucher.kennung, input.candidateId, input.duell);
    anstossen(input.sessionId);
    return { ok: true };
  },
);
