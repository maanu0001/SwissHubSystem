'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { resolveGuildId } from '@swisshub/discord';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import type { AuthContext } from '@swisshub/auth';

/**
 * Was die Verwaltung von «SwissHub fragt» tut.
 *
 * ## Jede Aktion prueft serverseitig
 *
 * `defineAction` nimmt `permission` und lehnt ohne sie ab - vor dem ersten
 * Zugriff auf die Datenbank. Die Oberflaeche entscheidet, welche Knoepfe sie
 * zeigt; was geschieht, entscheidet diese Datei.
 *
 * Die Berechtigungen sind feiner geschnitten als bei den meisten Modulen, und
 * das ist hier der Punkt: `questions` schreibt Vorlagen, `publish` stellt sie
 * an alle, `studio` erzeugt etwas, das den Server verlaesst. Wer Fragen
 * vorbereiten darf, soll nicht senden koennen.
 *
 * Die Kennung des Handelnden kommt in jedem Fall aus der Sitzung. Eine
 * `discordId` aus dem Formular gibt es nicht.
 */

const handelnder = (ctx: AuthContext): fragt.Handelnder => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

const neuLaden = (): void => {
  revalidatePath(systemRoutes.fragt());
  revalidatePath(systemRoutes.fragtBibliothek());
  revalidatePath(systemRoutes.fragtGeplant());
  revalidatePath(systemRoutes.fragtAktiv());
  revalidatePath(systemRoutes.fragtErgebnisse());
};

const fragetypSchema = z.enum(['ENTWEDER_ODER', 'UMFRAGE', 'FAVORIT', 'HOT_TAKE']);

/*
 * Die Antworten werden hier nur grob begrenzt.
 *
 * Wie viele es sein muessen und wie lang sie sein duerfen, entscheidet
 * `pruefeAntworten` - an genau einer Stelle, damit Formular und Bot nicht zwei
 * verschiedene Meinungen dazu haben koennen.
 */
const antwortenSchema = z.array(z.string().trim().max(120)).max(10);

export const fragtFrageErstellenAction = defineAction(
  {
    name: 'fragt.question.create',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      text: z.string().trim().min(5).max(240),
      untertitel: z.string().trim().max(240).optional(),
      kategorie: z.string().trim().min(1).max(40),
      typ: fragetypSchema,
      antworten: antwortenSchema,
      tags: z.array(z.string().trim().max(24)).max(8).optional(),
      dauerStunden: z.number().int().min(1).max(336).optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const frage = await fragt.erstelleFrage(guildId, handelnder(ctx), {
      text: input.text,
      untertitel: input.untertitel ?? null,
      kategorie: input.kategorie,
      typ: input.typ,
      antworten: input.antworten,
      tags: input.tags,
      dauerStunden: input.dauerStunden,
    });
    neuLaden();
    return { frageId: frage.id };
  },
);

export const fragtFrageBearbeitenAction = defineAction(
  {
    name: 'fragt.question.update',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      frageId: z.string().cuid(),
      text: z.string().trim().min(5).max(240).optional(),
      untertitel: z.string().trim().max(240).nullable().optional(),
      kategorie: z.string().trim().min(1).max(40).optional(),
      typ: fragetypSchema.optional(),
      antworten: antwortenSchema.optional(),
      tags: z.array(z.string().trim().max(24)).max(8).optional(),
      dauerStunden: z.number().int().min(1).max(336).optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const { frageId, ...rest } = input;
    const frage = await fragt.bearbeiteFrage(frageId, handelnder(ctx), rest);
    neuLaden();
    return { frageId: frage.id };
  },
);

export const fragtFrageStatusAction = defineAction(
  {
    name: 'fragt.question.status',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({
      frageId: z.string().cuid(),
      status: z.enum(['DRAFT', 'READY', 'ARCHIVED']),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.setzeStatus(input.frageId, handelnder(ctx), input.status);
    neuLaden();
    return { status: input.status };
  },
);

export const fragtFrageDuplizierenAction = defineAction(
  {
    name: 'fragt.question.duplicate',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    const kopie = await fragt.dupliziereFrage(input.frageId, handelnder(ctx));
    neuLaden();
    return { frageId: kopie.id };
  },
);

export const fragtSeedEinspielenAction = defineAction(
  {
    name: 'fragt.seed',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.questions,
    schema: z.object({}),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx }) => {
    const guildId = await resolveGuildId();
    // Legt die Fragen als Entwurf an. Nichts davon kann von selbst auf Discord
    // landen - die Automatik waehlt nur freigegebene Fragen.
    const neu = await fragt.spieleSeedEin(guildId, ctx.user.discordId);
    neuLaden();
    return { neu };
  },
);

export const fragtPlanenAction = defineAction(
  {
    name: 'fragt.schedule',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.schedule,
    schema: z.object({
      frageId: z.string().cuid(),
      /** ISO-Zeitstempel aus dem Formular. */
      termin: z.string().datetime(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.planeFrage(input.frageId, handelnder(ctx), new Date(input.termin));
    neuLaden();
    return { geplant: true };
  },
);

export const fragtPlanungAufhebenAction = defineAction(
  {
    name: 'fragt.schedule.clear',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.schedule,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.hebePlanungAuf(input.frageId, handelnder(ctx));
    neuLaden();
    return { geplant: false };
  },
);

export const fragtVeroeffentlichenAction = defineAction(
  {
    name: 'fragt.publish',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.publish,
    schema: z.object({ frageId: z.string().cuid() }),
    rateLimit: 'fragtPublish',
    // Eine Veroeffentlichung sehen alle im Kanal. Die Sitzung muss frisch sein.
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const guildId = await resolveGuildId();
    const ausgang = await fragt.veroeffentlicheVonHand(guildId, input.frageId, handelnder(ctx));
    neuLaden();
    return { abstimmungId: ausgang.abstimmung.id };
  },
);

export const fragtSchliessenAction = defineAction(
  {
    name: 'fragt.close',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.close,
    schema: z.object({ abstimmungId: z.string().cuid() }),
    rateLimit: 'fragtPublish',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ausgang = await fragt.schliesseVonHand(input.abstimmungId, handelnder(ctx));
    neuLaden();
    return {
      stimmen: ausgang.art === 'geschlossen' ? ausgang.ergebnis.gesamt : 0,
    };
  },
);

export const fragtEntwurfBearbeitenAction = defineAction(
  {
    name: 'fragt.draft.update',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({
      entwurfId: z.string().cuid(),
      vorlage: z.enum(['winner', 'results', 'duel']).optional(),
      format: z.enum(['story', 'feed', 'quadrat']).optional(),
      /*
       * Redaktionelle Texte - und nur die.
       *
       * Es gibt in diesem Schema kein Feld fuer eine Prozentzahl oder eine
       * Stimmenzahl, und im Datenmodell auch keine Spalte dafuer. Die Zahlen
       * kommen beim Rendern aus dem festgeschriebenen Ergebnis.
       *
       * `stimmenZeigen` ist davon keine Ausnahme: ein Schalter, kein Wert. Er
       * laesst die absolute Zahl weg oder nicht und kann keine setzen. Die
       * Prozente stehen in jedem Fall auf der Grafik - sie sind die Aussage.
       */
      stimmenZeigen: z.boolean().optional(),
      ueberschrift: z.string().trim().min(1).max(240).optional(),
      untertitel: z.string().trim().max(240).nullable().optional(),
      cta: z.string().trim().min(1).max(200).optional(),
      folien: z
        .array(
          z.object({
            art: z.enum(['frage', 'gewinner', 'verteilung', 'duell', 'cta']),
            aktiv: z.boolean(),
            position: z.number().int().min(0).max(9),
          }),
        )
        .max(5)
        .optional(),
      /*
       * Farbe, Zeichen und Zusatztext dieses Exports.
       *
       * Alle drei `nullable().optional()`, und das ist nicht Bequemlichkeit:
       *
       *   - **nicht uebergeben** heisst «unveraendert».
       *   - **`null`** heisst «zuruecksetzen auf die Moduleinstellung».
       *
       * Die Farbe nimmt hier eine lose Zeichenkette an und wird im Modul
       * durch `normalisiereFarbe` geschickt. Ein strenges `#rrggbb`-Regex im
       * Schema klaenge sicherer, waere aber schlechter: `#FFF`, `#fff` und
       * `rgb(255,255,255)` sind gueltige Eingaben in einem Farbfeld, und eine
       * abgewiesene Eingabe verwirft das ganze Speichern samt der Texte
       * daneben. Umgewandelt wird sie in jedem Fall - es gibt keinen Weg, auf
       * dem eine Eingabe unveraendert in ein `style`-Attribut gelangt.
       *
       * Das Zeichen ist eine Auswahl aus drei Woertern, nie ein Pfad.
       */
      exportAkzentfarbe: z.string().trim().max(32).nullable().optional(),
      exportLogo: z.enum(fragt.EXPORT_LOGO_WAHLEN).nullable().optional(),
      exportZusatztext: z.string().trim().max(80).nullable().optional(),
    }),
    rateLimit: 'fragtWrite',
  },
  async ({ input }) => {
    const { entwurfId, ...rest } = input;
    await fragt.bearbeiteEntwurf(entwurfId, rest);
    revalidatePath(systemRoutes.fragtStudio(entwurfId));
    return { gespeichert: true };
  },
);

/**
 * Einen Entwurf loeschen.
 *
 * ## Warum `delete` und nicht `studio`
 *
 * `studio` bearbeitet. Loeschen ist keine Bearbeitung, sondern ihr Ende, und
 * die Folgen sind andere: eine Vorlage zurueckzusetzen kostet eine Minute,
 * einen Entwurf wegzuwerfen kostet die Arbeit darin. Zwei Handlungen mit
 * verschiedenen Folgen gehoeren nicht in dieselbe Berechtigung.
 *
 * `freshness: 'critical'` - die Discord-Rolle wird frisch gelesen, bevor sie
 * zaehlt. Wem die Rolle vor fuenf Minuten entzogen wurde, soll nicht noch
 * loeschen koennen.
 */
export const fragtEntwurfLoeschenAction = defineAction(
  {
    name: 'fragt.draft.delete',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.delete,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await fragt.loescheEntwurf(input.entwurfId, handelnder(ctx));
    /*
     * Die Studioseite neu laden und die Listen dazu.
     *
     * Der Entwurf ist weg; die Seite, auf der der Knopf stand, zeigt danach
     * ihre «gibt es nicht»-Ansicht. Die Oberflaeche leitet selbst auf die
     * Ergebnisliste - eine Seite, die auf eine geloeschte Kennung zeigt,
     * waere ein Rueckweg ins Leere.
     */
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    neuLaden();
    return { geloescht: true };
  },
);

/**
 * Eine abgeschlossene Abstimmung samt Ergebnis loeschen.
 *
 * **Die Frage bleibt.** Das entscheidet nicht diese Aktion, sondern die
 * Richtung der Kaskade im Datenmodell: `FragtFrage → FragtAbstimmung`, nie
 * umgekehrt. `loescheAbstimmung` liest die `frageId` trotzdem und schreibt sie
 * ins Protokoll, damit die Zusage nachpruefbar ist und nicht nur behauptet.
 */
export const fragtErgebnisLoeschenAction = defineAction(
  {
    name: 'fragt.poll.delete',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.delete,
    schema: z.object({ abstimmungId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await fragt.loescheAbstimmung(input.abstimmungId, handelnder(ctx));
    revalidatePath(systemRoutes.fragtErgebnis(input.abstimmungId));
    neuLaden();
    return { geloescht: true };
  },
);

export const fragtEntwurfFinalisierenAction = defineAction(
  {
    name: 'fragt.draft.finalize',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    await fragt.finalisiereEntwurf(input.entwurfId, handelnder(ctx));
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    neuLaden();
    return { status: 'FINALISIERT' as const };
  },
);

export const fragtEntwurfFreigebenAction = defineAction(
  {
    name: 'fragt.draft.reopen',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ input }) => {
    await fragt.gibEntwurfFrei(input.entwurfId);
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    return { status: 'OFFEN' as const };
  },
);

export const fragtEntwurfGepostetAction = defineAction(
  {
    name: 'fragt.draft.posted',
    module: fragt.FRAGT_MODULE_ID,
    permission: fragt.FRAGT_PERMISSIONS.studio,
    schema: z.object({ entwurfId: z.string().cuid() }),
    rateLimit: 'fragtWrite',
  },
  async ({ ctx, input }) => {
    /*
     * Diese Aktion postet nichts.
     *
     * Sie haelt fest, dass jemand es getan hat. Das Modul hat keine
     * Instagram-Zugangsdaten und keinen Endpunkt dorthin; eine automatische
     * Veroeffentlichung gibt es in dieser Fassung ausdruecklich nicht.
     */
    await fragt.markiereVeroeffentlicht(input.entwurfId, handelnder(ctx));
    revalidatePath(systemRoutes.fragtStudio(input.entwurfId));
    neuLaden();
    return { status: 'VEROEFFENTLICHT' as const };
  },
);
