'use server';

import { moderation, profile } from '@swisshub/modules';
import { can, type AuthContext } from '@swisshub/auth';
import { defineAction } from '@/server/action';

/**
 * Kommentare unter einem oeffentlichen Profil.
 *
 * ## Warum das keine Verwaltungsberechtigung verlangt
 *
 * Einen Kommentar zu schreiben ist kein Eingriff in fremde Daten: der
 * Eintrag traegt die Kennung des Aufrufers, und keine Eingabe kann das
 * aendern - `authorDiscordId` kommt ausschliesslich aus `ctx.user`. Das
 * einzige fremde Merkmal in der Eingabe ist die oeffentliche Adresse, und
 * die loest `discordIdZuSlug` unter denselben Regeln auf wie die Profilseite
 * selbst: veroeffentlicht, nicht gesperrt. An ein privates Profil laesst
 * sich darum nicht vorbei schreiben, indem man die Adresse raet.
 *
 * ## Warum das Loeschen anders gebaut ist
 *
 * Beim Loeschen steht die Berechtigung erst zur Laufzeit fest - wie beim
 * Kalender. Drei Parteien duerfen: der Verfasser, der Profilbesitzer und
 * die Moderation. Das laesst sich nicht als eine feste `permission`
 * ausdruecken, also traegt die Aktion die Pruefung im Rumpf, unter einem
 * Namen, den der Waechter in `tests/unit/action-authorization.test.ts`
 * kennt.
 *
 * Die Moderationsseite haengt bewusst an `moderation.profile.lock`: wer ein
 * oeffentliches Profil ganz vom Netz nehmen darf, darf auch einen Satz
 * darunter entfernen. Eine eigene Berechtigung dafuer waere ein weiterer
 * Schalter, den jemand pflegen muesste, fuer eine Befugnis, die niemand
 * getrennt vergeben wuerde.
 */

/** Die Zustaendigkeit fuer genau diesen Kommentar. */
async function requireKommentarZugriff(ctx: AuthContext, kommentarId: string): Promise<{ id: string }> {
  return profile.pruefeKommentarZugriff(kommentarId, {
    discordId: ctx.user.discordId,
    darfModerieren: can(ctx, moderation.MODERATION_PERMISSIONS.profileLock),
  });
}

/*
 * Kein `revalidatePath` auf die Profilseite.
 *
 * Die Kommentare stehen nicht in ihrem Zwischenspeicher - sie kommen aus
 * `/api/profil/<slug>/kommentare`, weil sie fuer jeden Besucher anders
 * aussehen (siehe dort). Die Seite anzustossen wuerde das ganze Profil zum
 * Neubau zwingen, und zwar fuer einen Abschnitt, der gar nicht darin steckt.
 * Die Liste laedt der Browser nach dem Schreiben selbst neu.
 */

export const kommentarSchreibenAction = defineAction(
  {
    name: 'profil.kommentar.schreiben',
    schema: profile.kommentarSchema,
    selfService: true,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    const kommentar = await profile.schreibeKommentar(input, {
      discordId: ctx.user.discordId,
      /*
       * Der Name wird mitgeschrieben und nicht beim Anzeigen nachgeschlagen.
       *
       * Ein Kommentar von vor einem Jahr soll den Namen tragen, der damals
       * darunter stand. Wer sich seither umbenannt hat, benennt damit nicht
       * rueckwirkend jeden seiner Beitraege um - und wer den Server verlassen
       * hat, hinterlaesst keine namenlose Zeile.
       */
      name: ctx.identity.displayName ?? ctx.user.displayName,
    });
    return { kommentarId: kommentar.id };
  },
);

export const kommentarEntfernenAction = defineAction(
  {
    name: 'profil.kommentar.entfernen',
    schema: profile.kommentarLoeschenSchema,
    rateLimit: 'profilWrite',
  },
  async ({ ctx, input }) => {
    const zugriff = await requireKommentarZugriff(ctx, input.kommentarId);
    await profile.entferneKommentar(zugriff.id, ctx.user.discordId);
    return { ok: true };
  },
);
