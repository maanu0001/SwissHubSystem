import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_social_posts');

/**
 * Die Post-Bibliothek gegen eine echte Datenbank (§56).
 *
 * Geprueft wird der Weg, den ein Post wirklich nimmt: anlegen, speichern,
 * als fertig markieren, duplizieren, ablegen, zurueckholen, loeschen - und
 * dass die Filter der Bibliothek finden, was sie finden sollen.
 */
process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 37).toString('base64');

const { prisma } = await import('@swisshub/database');
const { socialmedia } = await import('@swisshub/modules');

const GUILD = '300000000000000001';
const FREMDE_GUILD = '300000000000000002';
const AUTOR = { userId: '', discordId: '300000000000000009', username: 'redakteurin' };

describeWithDatabase('Der Post Creator', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.socialPost.deleteMany();
    await prisma.user.deleteMany({ where: { discordId: AUTOR.discordId } });
    const benutzer = await prisma.user.create({
      data: { discordId: AUTOR.discordId, username: 'redakteurin' },
    });
    AUTOR.userId = benutzer.id;
  });

  it('legt einen Entwurf an und merkt sich, wer ihn gemacht hat', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Turnier Oktober',
      postType: 'turnier',
      design: 'tournament',
      inhalt: { titel: 'SwissHub Cup' },
      autor: AUTOR,
    });

    expect(post.status).toBe('DRAFT');
    expect(post.createdByUsername).toBe('redakteurin');
    expect((post.renderConfig as Record<string, unknown>)['titel']).toBe('SwissHub Cup');
  });

  it('weist einen unbekannten Typ ab, statt ihn anzulegen', async () => {
    await expect(
      socialmedia.erstellePost({
        guildId: GUILD,
        title: 'x',
        postType: 'gibtsnicht',
        design: 'clean',
        inhalt: {},
        autor: AUTOR,
      }),
    ).rejects.toThrow();
  });

  it('lässt «fertig» erst zu, wenn die Pflichtfelder da sind', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Begegnung',
      postType: 'match',
      design: 'tournament',
      inhalt: {},
      autor: AUTOR,
    });

    // Ohne Teams: als Entwurf in Ordnung, als «fertig» nicht - sonst waere
    // der Status eine Behauptung, und genau der Post wird ungeprueft
    // exportiert.
    await expect(
      socialmedia.speicherePost({
        postId: post.id,
        guildId: GUILD,
        title: 'Begegnung',
        postType: 'match',
        design: 'tournament',
        inhalt: {},
        status: 'READY',
        autorUsername: 'redakteurin',
      }),
    ).rejects.toThrow();

    const alsEntwurf = await socialmedia.speicherePost({
      postId: post.id,
      guildId: GUILD,
      title: 'Begegnung',
      postType: 'match',
      design: 'tournament',
      inhalt: {},
      autorUsername: 'redakteurin',
    });
    expect(alsEntwurf.status).toBe('DRAFT');

    const fertig = await socialmedia.speicherePost({
      postId: post.id,
      guildId: GUILD,
      title: 'Begegnung',
      postType: 'match',
      design: 'tournament',
      inhalt: { teams: { a: 'Team A', b: 'Team B' } },
      status: 'READY',
      autorUsername: 'redakteurin',
    });
    expect(fertig.status).toBe('READY');
  });

  it('räumt beim Typwechsel die Felder weg, die der neue Typ nicht hat', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Zuerst ein Event',
      postType: 'event',
      design: 'clean',
      inhalt: { titel: 'Spieleabend', datum: '2026-10-24', ort: 'Discord' },
      autor: AUTOR,
    });
    expect((post.renderConfig as Record<string, unknown>)['ort']).toBe('Discord');

    // «Update» kennt weder Datum noch Ort. Beide muessen verschwinden -
    // sonst taucht der alte Ort beim Zurueckwechseln wieder auf, obwohl
    // niemand ihn mehr gesehen hat.
    const gewechselt = await socialmedia.speicherePost({
      postId: post.id,
      guildId: GUILD,
      title: 'Jetzt ein Update',
      postType: 'update',
      design: 'minimal',
      inhalt: { titel: 'Spieleabend', datum: '2026-10-24', ort: 'Discord' },
      autorUsername: 'redakteurin',
    });
    const inhalt = gewechselt.renderConfig as Record<string, unknown>;
    expect(inhalt['titel']).toBe('Spieleabend');
    expect(inhalt['datum']).toBeUndefined();
    expect(inhalt['ort']).toBeUndefined();
  });

  it('dupliziert als Entwurf, auch wenn das Original fertig war', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Gewinner',
      postType: 'gewinner',
      design: 'spotlight',
      inhalt: { gewinner: 'Team Alpha' },
      autor: AUTOR,
    });
    await socialmedia.speicherePost({
      postId: post.id,
      guildId: GUILD,
      title: 'Gewinner',
      postType: 'gewinner',
      design: 'spotlight',
      inhalt: { gewinner: 'Team Alpha' },
      status: 'READY',
      autorUsername: 'redakteurin',
    });

    const kopie = await socialmedia.verdopplePost(post.id, GUILD, AUTOR);
    expect(kopie.status).toBe('DRAFT');
    expect(kopie.title).toContain('Kopie');
    expect(kopie.id).not.toBe(post.id);
    // Eine Kopie, die «bereit zum Posten» heisst, waere ein zweiter fertiger
    // Post mit demselben Inhalt - und der wird versehentlich gepostet.
  });

  it('legt ab, holt zurück und löscht endgültig', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Alte Ankündigung',
      postType: 'info',
      design: 'clean',
      inhalt: { titel: 'Alt' },
      autor: AUTOR,
    });

    const abgelegt = await socialmedia.setzeArchiv(post.id, GUILD, true, 'redakteurin');
    expect(abgelegt.status).toBe('ARCHIVED');
    expect(abgelegt.archivedAt).not.toBeNull();

    // Abgelegt heisst gesperrt - sonst waere «ablegen» nur eine Beschriftung.
    await expect(
      socialmedia.speicherePost({
        postId: post.id,
        guildId: GUILD,
        title: 'Alte Ankündigung',
        postType: 'info',
        design: 'clean',
        inhalt: { titel: 'Neu' },
        autorUsername: 'redakteurin',
      }),
    ).rejects.toThrow();

    const zurueck = await socialmedia.setzeArchiv(post.id, GUILD, false, 'redakteurin');
    expect(zurueck.status).toBe('DRAFT');
    expect(zurueck.archivedAt).toBeNull();

    await socialmedia.loeschePost(post.id, GUILD);
    expect(await socialmedia.ladePost(post.id, GUILD)).toBeNull();
  });

  it('gibt keinen Post eines anderen Servers heraus', async () => {
    const post = await socialmedia.erstellePost({
      guildId: GUILD,
      title: 'Nur hier',
      postType: 'info',
      design: 'clean',
      inhalt: { titel: 'x' },
      autor: AUTOR,
    });
    expect(await socialmedia.ladePost(post.id, FREMDE_GUILD)).toBeNull();
    await expect(socialmedia.loeschePost(post.id, FREMDE_GUILD)).rejects.toThrow();
  });

  it('filtert die Bibliothek nach Status, Typ und Titel', async () => {
    for (const [titel, typ] of [
      ['Turnier Oktober', 'turnier'],
      ['Turnier November', 'turnier'],
      ['Spieleabend', 'event'],
    ] as const) {
      await socialmedia.erstellePost({
        guildId: GUILD,
        title: titel,
        postType: typ,
        design: typ === 'turnier' ? 'tournament' : 'clean',
        inhalt: { titel },
        autor: AUTOR,
      });
    }

    expect(await socialmedia.ladePosts({ guildId: GUILD })).toHaveLength(3);
    expect(await socialmedia.ladePosts({ guildId: GUILD, postType: 'turnier' })).toHaveLength(2);
    // Teiltreffer, ohne Gross-/Kleinschreibung.
    expect(await socialmedia.ladePosts({ guildId: GUILD, suche: 'turnier ok' })).toHaveLength(1);
    expect(await socialmedia.ladePosts({ guildId: GUILD, suche: 'TURNIER' })).toHaveLength(2);
    expect(await socialmedia.ladePosts({ guildId: GUILD, status: 'READY' })).toHaveLength(0);

    const zahlen = await socialmedia.zaehlePosts(GUILD);
    expect(zahlen.DRAFT).toBe(3);
    expect(zahlen.READY).toBe(0);
    expect(zahlen.ARCHIVED).toBe(0);
  });

  it('speichert keine Bildadresse aus dem Browser (§35)', async () => {
    await expect(
      socialmedia.erstellePost({
        guildId: GUILD,
        title: 'Mit Bild',
        postType: 'info',
        design: 'clean',
        inhalt: { titel: 'x', bild: 'blob:http://localhost/8f3a-4c' },
        autor: AUTOR,
      }),
    ).rejects.toThrow();
    expect(await prisma.socialPost.count()).toBe(0);
  });
});
