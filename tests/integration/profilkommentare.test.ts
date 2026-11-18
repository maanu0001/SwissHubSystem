import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profilkommentare');

/**
 * Kommentare unter einem oeffentlichen Profil - gegen eine echte Datenbank.
 *
 * ## Warum das eine Datenbank braucht
 *
 * Weil genau die Dinge geprueft werden, die es ohne sie nicht gibt: dass die
 * Sichtbarkeitsregel beim **Schreiben** greift und nicht erst beim Anzeigen,
 * dass eine weiche Loeschung die Zeile stehen laesst und aus der Liste nimmt,
 * und dass der Doppelklick keinen zweiten gleichen Kommentar erzeugt.
 *
 * Die wichtigste Zusicherung ist die erste: an ein privates oder gesperrtes
 * Profil darf sich nichts schreiben lassen. Die Seite zeigte den Eintrag nie
 * an - in der Datenbank stuende er trotzdem, und das waere ein Kommentar, den
 * niemand sieht und niemand entfernen kann.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');
const { AppError } = await import('@swisshub/shared');

/**
 * Was der Benutzer zu lesen bekommt - und was nicht.
 *
 * `AppError.message` ist die **interne** Begruendung: sie geht ins Protokoll
 * und nie an den Browser. `userMessage` ist der Satz auf dem Bildschirm.
 * Diese Pruefung verlangt beides getrennt, weil die Trennung der Zweck der
 * Klasse ist - ein Test auf `message` wuerde durchgehen, auch wenn die
 * interne Begruendung versehentlich zur Anzeige wird.
 */
async function abgewiesen(
  vorgang: Promise<unknown>,
): Promise<{ code: string; userMessage: string; internal: string }> {
  try {
    await vorgang;
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(AppError);
    const app = fehler as InstanceType<typeof AppError>;
    return { code: app.code, userMessage: app.userMessage, internal: app.message };
  }
  throw new Error('Der Vorgang hätte abgewiesen werden müssen.');
}

const BESITZER = '900000000000007001';
const GAST = '900000000000007002';
const DRITTER = '900000000000007003';
const MODERATOR = '900000000000007004';

/** Ein Profil mit oeffentlicher Adresse. */
async function legeProfilAn(
  discordId: string,
  slug: string,
  zustand: { oeffentlich?: boolean; gesperrt?: boolean } = {},
): Promise<void> {
  const daten = {
    publicSlug: slug,
    visibilityProfile: (zustand.oeffentlich ?? true) ? ('PUBLIC' as const) : ('PRIVATE' as const),
    publicLockedAt: zustand.gesperrt ? new Date() : null,
  };
  await prisma.memberProfile.upsert({
    where: { discordId },
    create: { discordId, ...daten },
    update: daten,
  });
}

describeWithDatabase('Profilkommentare', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberProfileComment.deleteMany();
    await prisma.memberProfile.deleteMany();
    await legeProfilAn(BESITZER, 'besitzer');
  });

  it('schreibt einen Kommentar unter das Profil hinter dem Slug', async () => {
    const kommentar = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'Schöne Seite!' },
      { discordId: GAST, name: 'Gast' },
    );

    expect(kommentar.text).toBe('Schöne Seite!');
    expect(kommentar.autorName).toBe('Gast');

    const zeile = await prisma.memberProfileComment.findUniqueOrThrow({ where: { id: kommentar.id } });
    expect(zeile.profileDiscordId).toBe(BESITZER);
    expect(zeile.authorDiscordId).toBe(GAST);
  });

  it('schreibt nicht an ein privates Profil', async () => {
    /*
     * Die Zusicherung, auf die es ankommt. Ein Slug zeigt nur auf ein
     * veroeffentlichtes Profil - wer die Adresse errät, nachdem sie privat
     * gestellt wurde, darf nichts hinterlassen.
     */
    await legeProfilAn(BESITZER, 'besitzer', { oeffentlich: false });

    const befund = await abgewiesen(
      profile.schreibeKommentar({ slug: 'besitzer', text: 'hallo' }, { discordId: GAST, name: 'Gast' }),
    );
    expect(befund.code).toBe('NOT_FOUND');
    expect(befund.userMessage).toBe('Dieses Profil gibt es nicht.');
    /*
     * «privat» und «gesperrt» stehen nur innen.
     *
     * Nach aussen ist es dieselbe 404 wie fuer jede unbekannte Adresse - wer
     * die Faelle unterscheiden koennte, koennte Adressen durchprobieren und
     * erfahren, wer ein Profil hat, das er nicht zeigt.
     */
    expect(befund.userMessage).not.toMatch(/privat|gesperrt/iu);
    expect(befund.internal).toMatch(/privaten oder gesperrten/u);
    expect(await prisma.memberProfileComment.count()).toBe(0);
  });

  it('schreibt nicht an ein gesperrtes Profil', async () => {
    // Eine Sperre schaltet jede oeffentliche Ausgabe ab - und jede Eingabe.
    await legeProfilAn(BESITZER, 'besitzer', { gesperrt: true });

    const befund = await abgewiesen(
      profile.schreibeKommentar({ slug: 'besitzer', text: 'hallo' }, { discordId: GAST, name: 'Gast' }),
    );
    expect(befund.code).toBe('NOT_FOUND');
    expect(befund.userMessage).toBe('Dieses Profil gibt es nicht.');
    expect(await prisma.memberProfileComment.count()).toBe(0);
  });

  it('nimmt denselben Kommentar nicht zweimal in kurzer Folge', async () => {
    // Der Doppelklick und das zweite Abschicken nach einem langsamen Netz.
    await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'derselbe Satz' },
      { discordId: GAST, name: 'Gast' },
    );
    const befund = await abgewiesen(
      profile.schreibeKommentar(
        { slug: 'besitzer', text: 'derselbe Satz' },
        { discordId: GAST, name: 'Gast' },
      ),
    );
    expect(befund.code).toBe('CONFLICT');
    expect(befund.userMessage).toMatch(/eben schon geschrieben/u);
    expect(await prisma.memberProfileComment.count()).toBe(1);
  });

  it('laesst denselben Satz von einer anderen Person zu', async () => {
    // Die Sperre gilt dem Doppelklick, nicht der Zustimmung.
    await profile.schreibeKommentar({ slug: 'besitzer', text: 'top' }, { discordId: GAST, name: 'Gast' });
    await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'top' },
      { discordId: DRITTER, name: 'Dritter' },
    );
    expect(await prisma.memberProfileComment.count()).toBe(2);
  });

  it('zeigt den neuesten Kommentar oben', async () => {
    for (const text of ['erster', 'zweiter', 'dritter']) {
      await profile.schreibeKommentar({ slug: 'besitzer', text }, { discordId: GAST, name: 'Gast' });
    }
    const liste = await profile.ladeKommentare(BESITZER, { discordId: null, darfModerieren: false });
    expect(liste.map((eintrag) => eintrag.text)).toEqual(['dritter', 'zweiter', 'erster']);
  });

  it('zeigt einen Loeschknopf genau dort, wo jemand loeschen darf', async () => {
    const vonGast = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'vom Gast' },
      { discordId: GAST, name: 'Gast' },
    );
    const vonDritten = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'vom Dritten' },
      { discordId: DRITTER, name: 'Dritter' },
    );

    const loeschbarFuer = async (
      discordId: string | null,
      darfModerieren = false,
    ): Promise<Record<string, boolean>> => {
      const liste = await profile.ladeKommentare(BESITZER, { discordId, darfModerieren });
      return Object.fromEntries(liste.map((eintrag) => [eintrag.id, eintrag.loeschbar]));
    };

    // Ein Gast ohne Anmeldung sieht nirgends einen Knopf.
    expect(await loeschbarFuer(null)).toEqual({ [vonGast.id]: false, [vonDritten.id]: false });
    // Der Verfasser nur an seinem eigenen.
    expect(await loeschbarFuer(GAST)).toEqual({ [vonGast.id]: true, [vonDritten.id]: false });
    // Der Profilbesitzer an beiden - es ist seine Seite.
    expect(await loeschbarFuer(BESITZER)).toEqual({ [vonGast.id]: true, [vonDritten.id]: true });
    // Die Moderation an beiden - es ist ihr Server.
    expect(await loeschbarFuer(MODERATOR, true)).toEqual({ [vonGast.id]: true, [vonDritten.id]: true });
  });

  it('weist eine fremde Loeschung ab', async () => {
    const kommentar = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'vom Gast' },
      { discordId: GAST, name: 'Gast' },
    );

    const befund = await abgewiesen(
      profile.pruefeKommentarZugriff(kommentar.id, { discordId: DRITTER, darfModerieren: false }),
    );
    /*
     * `FORBIDDEN` und nicht `NOT_FOUND`: der Kommentar steht sichtbar auf
     * einer oeffentlichen Seite - dass es ihn gibt, ist kein Geheimnis.
     */
    expect(befund.code).toBe('FORBIDDEN');
    expect(befund.userMessage).toBe('Diesen Kommentar darfst du nicht entfernen.');
    expect(await prisma.memberProfileComment.count({ where: { deletedAt: null } })).toBe(1);
  });

  it('loescht weich - die Zeile bleibt, die Liste nicht', async () => {
    /*
     * Weich, weil eine Loeschung hier eine Moderationshandlung sein kann. Wer
     * spaeter fragt, warum ein Kommentar verschwunden ist, bekommt mit einer
     * harten Loeschung keine Antwort.
     */
    const kommentar = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'weg damit' },
      { discordId: GAST, name: 'Gast' },
    );
    await profile.pruefeKommentarZugriff(kommentar.id, { discordId: MODERATOR, darfModerieren: true });
    await profile.entferneKommentar(kommentar.id, MODERATOR);

    expect(await profile.ladeKommentare(BESITZER, { discordId: null, darfModerieren: false })).toEqual([]);
    const zeile = await prisma.memberProfileComment.findUniqueOrThrow({ where: { id: kommentar.id } });
    expect(zeile.deletedAt).not.toBeNull();
    expect(zeile.deletedByDiscordId).toBe(MODERATOR);
    expect(zeile.body).toBe('weg damit');
  });

  it('laesst einen geloeschten Kommentar nicht zweimal loeschen', async () => {
    const kommentar = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'einmal' },
      { discordId: GAST, name: 'Gast' },
    );
    await profile.pruefeKommentarZugriff(kommentar.id, { discordId: GAST, darfModerieren: false });
    await profile.entferneKommentar(kommentar.id, GAST);

    const befund = await abgewiesen(
      profile.pruefeKommentarZugriff(kommentar.id, { discordId: GAST, darfModerieren: false }),
    );
    expect(befund.code).toBe('NOT_FOUND');
    expect(befund.userMessage).toBe('Diesen Kommentar gibt es nicht mehr.');
  });

  it('haelt den Namen fest, den der Verfasser damals trug', async () => {
    /*
     * Der Name wird mitgeschrieben und nicht beim Anzeigen nachgeschlagen:
     * ein Kommentar von vor einem Jahr soll den Namen tragen, der damals
     * darunter stand - und wer den Server verlassen hat, hinterlaesst keine
     * namenlose Zeile.
     */
    const kommentar = await profile.schreibeKommentar(
      { slug: 'besitzer', text: 'damals' },
      { discordId: GAST, name: 'AlterName' },
    );
    const [eintrag] = await profile.ladeKommentare(BESITZER, { discordId: null, darfModerieren: false });
    expect(eintrag?.autorName).toBe('AlterName');
    expect(eintrag?.id).toBe(kommentar.id);
  });
});
