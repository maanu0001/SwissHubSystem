'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { AppError } from '@swisshub/shared';
import { serverrollen } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Die Aktionen der Rollenübersicht.
 *
 * ## Zwei Arten von Aktion, zwei Arten von Prüfung
 *
 * Die Pflege (Gruppen, Beschreibungen, Reihenfolge) braucht
 * `serverrollen.manage`. Die Freigabe zur Selbstvergabe braucht zusätzlich
 * `serverrollen.selfservice.manage` - sie entscheidet darüber, wer auf dem
 * Server was bekommen kann, und ist deshalb eine eigene, als `critical`
 * gekennzeichnete Berechtigung.
 *
 * Das Nehmen und Abgeben einer Rolle ist Selbstbedienung: `selfService: true`,
 * und die Kennung kommt aus der Sitzung. Es gibt keinen Weg, über die Eingabe
 * eine fremde `discordId` zu setzen - genau deshalb genügt die Mitgliedschaft.
 *
 * ## Warum hier keine Sicherheitslogik steht
 *
 * Weil sie in `packages/modules/src/serverrollen/sicherheit.ts` steht und von
 * `aendereEigeneRolle` bei jedem Aufruf angewandt wird. Eine zweite Prüfung
 * hier wäre eine zweite Wahrheit; eine davon wäre eines Tages die veraltete.
 * Diese Datei reicht weiter und macht die Antwort für die Oberfläche brauchbar.
 */

const PFAD = '/server/serverrollen';

/** Eine freigegebene Rolle selbst nehmen oder wieder abgeben. */
export const aendereEigeneRolleAction = defineAction(
  {
    name: 'serverrollen.eigeneRolle',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    // Selbstbedienung: wirkt ausschliesslich auf den Aufrufer. Die Kennung
    // kommt aus `ctx.user`, nie aus der Eingabe.
    selfService: true,
    rateLimit: 'serverrolleSelbst',
    schema: z.object({
      discordRoleId: z.string().min(1).max(32),
      richtung: z.enum(['hinzufuegen', 'entfernen']),
    }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await serverrollen.aendereEigeneRolle(
      ctx.user.discordId,
      input.discordRoleId,
      input.richtung,
    );
    revalidatePath('/serverrollen');
    return ergebnis;
  },
);

const kategorieSchema = z.object({
  name: z.string().min(1).max(60),
  hinweis: z.string().max(200).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  publicVisible: z.boolean().optional(),
  exklusiv: z.boolean().optional(),
  /*
   * Die Spaltenzahl steht auch im Schema und nicht nur im Auswahlfeld.
   *
   * Eine Server Action ist eine Tuer; wer sie aufruft, kann jede Zahl
   * schicken. `serverrollen.bearbeiteKategorie` deckelt zusaetzlich - zwei
   * Sperren fuer denselben Wert, und die hier spart dem Dienst den
   * Sonderfall.
   */
  spalten: z.number().int().min(1).max(4).optional(),
});

export const erstelleKategorieAction = defineAction(
  {
    name: 'serverrollen.kategorie.erstellen',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: kategorieSchema,
  },
  async ({ input }) => {
    const id = await serverrollen.erstelleKategorie(input);
    revalidatePath(PFAD);
    revalidatePath('/serverrollen');
    return { id };
  },
);

export const bearbeiteKategorieAction = defineAction(
  {
    name: 'serverrollen.kategorie.bearbeiten',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: kategorieSchema.partial().extend({ id: z.string().min(1) }),
  },
  async ({ input }) => {
    const { id, ...rest } = input;
    await serverrollen.bearbeiteKategorie(id, rest);
    revalidatePath(PFAD);
    revalidatePath('/serverrollen');
    return { ok: true };
  },
);

export const loescheKategorieAction = defineAction(
  {
    name: 'serverrollen.kategorie.loeschen',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({ id: z.string().min(1) }),
  },
  async ({ input }) => {
    await serverrollen.loescheKategorie(input.id);
    revalidatePath(PFAD);
    revalidatePath('/serverrollen');
    return { ok: true };
  },
);

/**
 * Die Angaben zu einer Rolle speichern.
 *
 * ## Warum die Freigabe eine eigene Berechtigung prüft
 *
 * Weil «Beschreibung schreiben» und «Rolle zur Selbstbedienung öffnen» zwei
 * verschiedene Entscheidungen sind. Beides über `manage` zu erlauben hiesse,
 * jeder Person, die Texte pflegt, auch die Rollenvergabe zu geben.
 *
 * `defineAction` prüft `manage` vorab; `selfAssignable` prüft der Rumpf
 * zusätzlich - und zwar nur, wenn das Feld überhaupt mitkommt. Wer keine
 * Freigabe ändert, braucht die Berechtigung nicht.
 */
export const speichereRolleAction = defineAction(
  {
    name: 'serverrollen.rolle.speichern',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({
      discordRoleId: z.string().min(1).max(32),
      categoryId: z.string().nullish(),
      beschreibung: z.string().max(280).nullish(),
      sortOrder: z.number().int().min(0).max(999).optional(),
      publicVisible: z.boolean().optional(),
      selfAssignable: z.boolean().optional(),
      selfRemovable: z.boolean().optional(),
      voraussetzungRoleId: z.string().nullish(),
    }),
  },
  async ({ ctx, input }) => {
    const { discordRoleId, ...rest } = input;
    if (rest.selfAssignable !== undefined && !can(ctx, serverrollen.SERVERROLLEN_PERMISSIONS.selfService)) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Die Freigabe zur Selbstvergabe darf nur ändern, wer dafür berechtigt ist.',
      });
    }
    await serverrollen.speichereRolle(discordRoleId, rest);
    revalidatePath(PFAD);
    revalidatePath('/serverrollen');
    return { ok: true };
  },
);

export const entferneRolleAction = defineAction(
  {
    name: 'serverrollen.rolle.entfernen',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({ discordRoleId: z.string().min(1).max(32) }),
  },
  async ({ input }) => {
    await serverrollen.entferneRolle(input.discordRoleId);
    revalidatePath(PFAD);
    revalidatePath('/serverrollen');
    return { ok: true };
  },
);

/**
 * Das Dropdown-Embed einer Gruppe.
 *
 * ## Warum das Senden dieselbe Berechtigung braucht wie das Pflegen
 *
 * Weil es eine Nachricht auf dem Server ist, die jeder bedienen kann. Wer sie
 * veroeffentlichen darf, entscheidet mit, wo Rollen zu holen sind - das ist
 * dieselbe Art von Entscheidung wie «diese Gruppe sichtbar machen», und
 * deshalb `manage`.
 *
 * **Nicht** `selfService`: welche Rollen im Menue stehen, entscheidet die
 * Gruppe und nicht dieses Knopfdruck. Wer eine Rolle freigeben will, braucht
 * dafuer weiterhin die eigene, kritische Berechtigung.
 *
 * Mitglieder brauchen hier gar nichts: sie waehlen im Menue, und das laeuft
 * ueber den Bot und `setzeGruppenauswahl`.
 */
export const speichereEmbedAction = defineAction(
  {
    name: 'serverrollen.embed.speichern',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({
      id: z.string().min(1),
      channelId: z.string().max(32).nullish(),
      titel: z.string().max(120).nullish(),
      beschreibung: z.string().max(500).nullish(),
      farbe: z.string().max(7).nullish(),
    }),
  },
  async ({ input }) => {
    const { id, ...rest } = input;
    await serverrollen.speichereEmbedEinstellungen(id, rest);
    revalidatePath(PFAD);
    return { ok: true };
  },
);

/** Veroeffentlichen oder aktualisieren - derselbe Vorgang, siehe `sendeGruppenEmbed`. */
export const sendeEmbedAction = defineAction(
  {
    name: 'serverrollen.embed.senden',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({ id: z.string().min(1) }),
  },
  async ({ ctx, input }) => {
    const ergebnis = await serverrollen.sendeGruppenEmbed(input.id, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath(PFAD);
    return ergebnis;
  },
);

export const entferneEmbedAction = defineAction(
  {
    name: 'serverrollen.embed.entfernen',
    module: serverrollen.SERVERROLLEN_MODULE_ID,
    permission: serverrollen.SERVERROLLEN_PERMISSIONS.manage,
    rateLimit: 'serverrollenPflege',
    schema: z.object({ id: z.string().min(1) }),
  },
  async ({ ctx, input }) => {
    await serverrollen.entferneGruppenEmbed(input.id, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath(PFAD);
    return { ok: true };
  },
);
