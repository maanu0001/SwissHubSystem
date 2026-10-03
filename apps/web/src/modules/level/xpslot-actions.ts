'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@swisshub/auth';
import { AppError } from '@swisshub/shared';
import { level } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = level.LEVEL_MODULE_ID;
const P = level.LEVEL_PERMISSIONS;
const S = level.xpslot;

/**
 * Die Server Actions des XP-Slots.
 *
 * ## Warum diese Datei hier liegt und nicht in `xpslot/`
 *
 * Weil `tests/unit/action-authorization.test.ts` jede Server Action der
 * Anwendung findet und von ihr eine Berechtigung verlangt - und zwar ueber ein
 * Dateimuster, das genau eine Ebene unter `modules/` sucht. Eine Aktionsdatei
 * in einem Unterordner waere dem Waechter entgangen, und der Waechter hat
 * genau das gemeldet. Dieselbe Stelle wie `raffle-actions.ts`, aus demselben
 * Grund: eine Unterfunktion des Level-Moduls, deren Aktionen trotzdem
 * gepruft werden.
 *
 * ## Was hier steht und was nicht
 *
 * Hier steht **kein Spiel**. Jede Funktion prueft die Berechtigung, reicht
 * weiter und gibt zurueck - gerechnet wird in `@swisshub/modules`, denselben
 * Funktionen, die auch der Testmodus und die Tests aufrufen. Dass ein Knopf
 * im Browser fehlt, ist Bequemlichkeit; die Absicherung ist hier.
 *
 * ## Warum der Schluessel vom Browser kommt
 *
 * Der Idempotenzschluessel ist das einzige, was der Browser zum Ergebnis
 * beitraegt - und er kann damit nichts gewinnen. Er kann einen Spin
 * wiederholen (dann bekommt er denselben zurueck) oder einen neuen Schluessel
 * schicken (dann ist es ein neuer Spin, der XP kostet). Ein geratener
 * Schluessel einer anderen Person nuetzt nichts: `dreheSpin` prueft in
 * `gehoertMir`, dass der gespeicherte Spin zur anfragenden Person gehoert,
 * und weist ihn sonst ab - ohne zu sagen, wem er gehoert.
 *
 * ## Warum `revalidatePath` beim Spin fehlt
 *
 * Weil ein Spin die Seite nicht neu laedt. Das Ergebnis kommt als Rueckgabe
 * an, die Oberflaeche spielt es ab und schreibt XP, Einsatz und Freispiele
 * fort - so steht es im Konzept («ohne Seitenreload»). Ein
 * `revalidatePath` je Spin waere bei Auto-Spin hundert Serverrenderings.
 */

const spinSchema = z.object({
  einsatz: z.number().int().min(1).max(1_000_000),
  schluessel: z.string().min(8).max(100),
});

export const spinAction = defineAction(
  {
    name: 'level.xpslot.spin',
    module: MODULE_ID,
    permission: P.xpslotPlay,
    schema: spinSchema,
    rateLimit: 'slotSpin',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    return S.dreheSpin({
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      displayName: ctx.user.displayName ?? null,
      avatarHash: ctx.user.avatarHash ?? null,
      einsatz: input.einsatz,
      schluessel: input.schluessel,
    });
  },
);

const bonusSchema = z.object({ rundeId: z.string().min(1).max(60) });

export const bonusNehmenAction = defineAction(
  {
    name: 'level.xpslot.bonus.nehmen',
    module: MODULE_ID,
    permission: P.xpslotPlay,
    schema: bonusSchema,
    rateLimit: 'slotSpin',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    return S.nimmFreispiele(ctx.user.discordId, input.rundeId);
  },
);

export const bonusRiskierenAction = defineAction(
  {
    name: 'level.xpslot.bonus.riskieren',
    module: MODULE_ID,
    permission: P.xpslotPlay,
    schema: bonusSchema,
    rateLimit: 'slotSpin',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    return S.riskiere(ctx.user.discordId, input.rundeId);
  },
);

/** Der eigene Zustand - nach einem Spin, ohne die Seite neu zu laden. */
export const meinStandAction = defineAction(
  {
    name: 'level.xpslot.stand',
    module: MODULE_ID,
    permission: P.xpslotPlay,
    schema: z.object({}),
    rateLimit: 'slotSpin',
  },
  async ({ ctx }) => S.spielerAnsicht(ctx.user.discordId),
);

// ---------------------------------------------------------------------------
// Verwaltung
// ---------------------------------------------------------------------------

function revalidiereVerwaltung(): void {
  revalidatePath('/level/xp-slot');
  revalidatePath('/level/xp-slot/verwaltung');
}

export const konfigSpeichernAction = defineAction(
  {
    name: 'level.xpslot.konfig',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.konfigSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const rtp = await S.speichereKonfig(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { rtp: rtp.rtp, lage: S.rtpLage(rtp.rtp), hinweise: rtp.hinweise };
  },
);

export const designSpeichernAction = defineAction(
  {
    name: 'level.xpslot.design',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.designSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.speichereDesign(input, { discordId: ctx.user.discordId, username: ctx.user.username });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

/**
 * Das Embed von `/xp-slot`.
 *
 * Dieselbe Berechtigung wie jede andere Slot-Einstellung. Ausdruecklich
 * **nicht** die Befehlsverwaltung: ob `/xp-slot` laeuft und wer ihn benutzen
 * darf, entscheidet weiterhin die zentrale Command- und Rollenverwaltung.
 * Hier geht es nur um Text und Aussehen.
 */
export const befehlSpeichernAction = defineAction(
  {
    name: 'level.xpslot.befehl',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.befehlSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.speichereBefehl(input, { discordId: ctx.user.discordId, username: ctx.user.username });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

export const feedSpeichernAction = defineAction(
  {
    name: 'level.xpslot.feed',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.feedSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.speichereFeed(input, { discordId: ctx.user.discordId, username: ctx.user.username });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'DISABLED', 'EVENT_ONLY']),
  hinweis: z.string().max(400).nullable(),
});

export const statusSetzenAction = defineAction(
  {
    name: 'level.xpslot.status',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: statusSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.setzeStatus(input.status, input.hinweis, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { status: input.status };
  },
);

export const symbolSpeichernAction = defineAction(
  {
    name: 'level.xpslot.symbol',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.symbolSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { rtp } = await S.speichereSymbol(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { rtp: rtp.rtp, lage: S.rtpLage(rtp.rtp) };
  },
);

export const paytableSpeichernAction = defineAction(
  {
    name: 'level.xpslot.paytable',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: S.paytableSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const rtp = await S.speicherePaytable(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { rtp: rtp.rtp, lage: S.rtpLage(rtp.rtp), hinweise: rtp.hinweise };
  },
);

// --- Sound-Pakete ----------------------------------------------------------

const paketSchema = z.object({
  name: z.string().min(2).max(80),
  art: z.enum(['STANDARD', 'EVENT', 'SPECIAL']),
});

export const paketAnlegenAction = defineAction(
  {
    name: 'level.xpslot.paket.neu',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: paketSchema,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const paket = await S.legePaketAn(input.name, input.art, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { packId: paket.id };
  },
);

export const paketAendernAction = defineAction(
  {
    name: 'level.xpslot.paket.aendern',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: paketSchema.extend({ packId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.benennePaket(input.packId, input.name, input.art, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

export const paketLoeschenAction = defineAction(
  {
    name: 'level.xpslot.paket.loeschen',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({ packId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.loeschePaket(input.packId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

const klangSchema = z.object({
  packId: z.string().min(1),
  slot: z.string().min(1).max(40),
  lautstaerke: z.number().int().min(0).max(100).optional(),
  an: z.boolean().optional(),
});

export const klangStellenAction = defineAction(
  {
    name: 'level.xpslot.klang.stellen',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: klangSchema,
    rateLimit: 'slotAdmin',
  },
  async ({ input }) => {
    await S.stelleKlang(input.packId, input.slot, {
      lautstaerke: input.lautstaerke,
      an: input.an,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

export const klangEntfernenAction = defineAction(
  {
    name: 'level.xpslot.klang.weg',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({ packId: z.string().min(1), slot: z.string().min(1).max(40) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ input }) => {
    await S.entferneKlang(input.packId, input.slot);
    revalidiereVerwaltung();
    return { ok: true };
  },
);

// --- Events ----------------------------------------------------------------

/**
 * Das Eventschema fuer den Browser.
 *
 * Das Modul erwartet `Date`; aus einem Formular kommt eine Zeichenkette.
 * Umgewandelt wird hier, einmal - und zwar mit `coerce`, damit eine
 * unbrauchbare Angabe eine Fehlermeldung ergibt und kein `Invalid Date`, das
 * stillschweigend in die Datenbank wandert.
 */
const eventFormular = z.object({
  name: z.string().min(2).max(80),
  beschreibung: z.string().max(500).nullable(),
  von: z.coerce.date().nullable(),
  bis: z.coerce.date().nullable(),
  soundPackId: z.string().min(1).nullable(),
  ueberschreibungen: S.eventUeberschreibungSchema,
  symbolwerte: S.eventSymbolSchema,
});

export const eventAnlegenAction = defineAction(
  {
    name: 'level.xpslot.event.neu',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: eventFormular,
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const event = await S.legeEventAn(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { eventId: event.id };
  },
);

export const eventAendernAction = defineAction(
  {
    name: 'level.xpslot.event.aendern',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: eventFormular.extend({ eventId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { eventId, ...rest } = input;
    await S.aendereEvent(eventId, rest, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

export const eventPruefenAction = defineAction(
  {
    name: 'level.xpslot.event.pruefen',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({ eventId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
  },
  async ({ input }) => {
    const pruefung = await S.pruefeEvent(input.eventId);
    return {
      ok: pruefung.ok,
      fehler: pruefung.fehler,
      warnungen: pruefung.warnungen,
      rtp: pruefung.rtp?.rtp ?? null,
    };
  },
);

export const eventAktivierenAction = defineAction(
  {
    name: 'level.xpslot.event.an',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({ eventId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const pruefung = await S.aktiviereEvent(input.eventId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { warnungen: pruefung.warnungen, rtp: pruefung.rtp?.rtp ?? null };
  },
);

export const eventBeendenAction = defineAction(
  {
    name: 'level.xpslot.event.aus',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({ eventId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.beendeEvent(input.eventId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

// --- Freispiele ------------------------------------------------------------

export const freispieleGewaehrenAction = defineAction(
  {
    name: 'level.xpslot.freispiele.gewaehren',
    module: MODULE_ID,
    permission: P.xpslotFreespinsManage,
    schema: z.object({
      discordId: z.string().regex(/^\d{17,20}$/u, 'Das ist keine Discord-Kennung.'),
      anzahl: z.number().int().min(1).max(500),
      einsatz: z.number().int().min(1).max(1_000_000),
      laeuftAb: z.coerce.date().nullable(),
      grund: z.string().max(200).nullable(),
    }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const konfiguration = await S.leseKonfiguration();
    const paket = await S.gewaehreFreispiele(
      {
        discordId: input.discordId,
        anzahl: input.anzahl,
        einsatz: input.einsatz,
        laeuftAb: input.laeuftAb,
        grund: input.grund,
      },
      konfiguration.wirksam.einsaetze,
      { discordId: ctx.user.discordId, username: ctx.user.username },
    );
    revalidiereVerwaltung();
    return { packageId: paket.id };
  },
);

export const freispieleEntziehenAction = defineAction(
  {
    name: 'level.xpslot.freispiele.entziehen',
    module: MODULE_ID,
    permission: P.xpslotFreespinsManage,
    schema: z.object({ packageId: z.string().min(1) }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.entzieheFreispiele(input.packageId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

export const freispieleFristAction = defineAction(
  {
    name: 'level.xpslot.freispiele.frist',
    module: MODULE_ID,
    permission: P.xpslotFreespinsManage,
    schema: z.object({ packageId: z.string().min(1), laeuftAb: z.coerce.date().nullable() }),
    rateLimit: 'slotAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await S.aendereFrist(input.packageId, input.laeuftAb, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidiereVerwaltung();
    return { ok: true };
  },
);

// --- Testmodus -------------------------------------------------------------

export const testlaufAction = defineAction(
  {
    name: 'level.xpslot.testlauf',
    module: MODULE_ID,
    permission: P.xpslotManage,
    schema: z.object({
      einsatz: z.number().int().min(1).max(1_000_000),
      fall: z.enum(S.TESTFAELLE),
    }),
    rateLimit: 'slotAdmin',
  },
  async ({ ctx, input }) => {
    const { ergebnis } = await S.testlauf({
      discordId: ctx.user.discordId,
      einsatz: input.einsatz,
      fall: input.fall,
    });
    return ergebnis;
  },
);

// --- Statistik und Historie ------------------------------------------------

export const kennzahlenAction = defineAction(
  {
    name: 'level.xpslot.kennzahlen',
    module: MODULE_ID,
    permission: P.xpslotStats,
    schema: z.object({ zeitraum: z.enum(S.ZEITRAEUME) }),
    rateLimit: 'slotAdmin',
  },
  async ({ input }) => S.kennzahlen(input.zeitraum),
);

export const verlaufAction = defineAction(
  {
    name: 'level.xpslot.verlauf',
    module: MODULE_ID,
    /*
     * Die Spielberechtigung genuegt - fuer den **eigenen** Verlauf.
     *
     * Wer den Verlauf einer anderen Person sehen will, braucht
     * `xpslotStats`; das prueft die Funktion unten. Haette diese Huelle
     * `xpslotStats` verlangt, koennte niemand seinen eigenen Verlauf
     * abrufen - und die Pruefung darin waere toter Code.
     */
    permission: P.xpslotPlay,
    schema: z.object({
      discordId: z.string().max(25).nullable(),
      nurJackpot: z.boolean(),
      nurBonus: z.boolean(),
      nurPremium: z.boolean(),
      mitTestlaeufen: z.boolean(),
      seite: z.number().int().min(1).max(500),
    }),
    rateLimit: 'slotAdmin',
  },
  async ({ ctx, input }) => {
    /*
     * Ohne `xpslotStats` gibt es ausschliesslich den eigenen Verlauf.
     *
     * Und zwar nicht, indem die Anfrage abgewiesen wird: `null` heisst «alle
     * Personen», und genau das darf ohne die Berechtigung nicht passieren.
     * Deshalb wird die Kennung **ersetzt**, nicht nur geprueft - eine
     * weggelassene Kennung waere sonst die Hintertuer.
     */
    const darfAlle = can(ctx, P.xpslotStats);
    if (!darfAlle && input.discordId !== ctx.user.discordId) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Du darfst nur deinen eigenen Spielverlauf ansehen.',
      });
    }
    return S.verlauf({
      discordId: darfAlle ? input.discordId : ctx.user.discordId,
      nurJackpot: input.nurJackpot,
      nurBonus: input.nurBonus,
      nurPremium: input.nurPremium,
      mitTestlaeufen: input.mitTestlaeufen,
      seite: input.seite,
    });
  },
);
