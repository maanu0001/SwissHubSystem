import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_mitgliederverzeichnis');

/**
 * Das Mitgliederverzeichnis - gegen eine echte Datenbank.
 *
 * ## Was bestellt war
 *
 * «Auf dem Dashboard soll es unter der Kategorie Community einen neuen
 * Sidebar Tab für alle Mitglieder geben, unter dem alle user mit deren
 * öffentlichen profilen aufgelistet sind. Die Profile sollen den
 * Discord-Rollen nach hirarchisch von oben nach unten sortiert sein.»
 *
 * ## Warum das eine Datenbank braucht
 *
 * Weil die Ordnung aus **zwei** Tabellen entsteht: die hoechste Rolle eines
 * Mitglieds steht im Rollenspiegel, die Mitglieder im Mitgliederspiegel. Das
 * laesst sich nicht ohne Daten pruefen - und die Verbindung von Slug und
 * Mitglied kommt aus einer dritten.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

async function legeRolle(roleId: string, name: string, position: number, farbe = 0): Promise<void> {
  await prisma.discordRoleCache.create({ data: { roleId, name, position, color: farbe } });
}

async function legeMitglied(eingabe: {
  discordId: string;
  name: string;
  rollen?: string[];
  bot?: boolean;
  weg?: boolean;
  boostet?: boolean;
}): Promise<void> {
  await prisma.discordMemberCache.create({
    data: {
      discordId: eingabe.discordId,
      username: eingabe.name.toLowerCase(),
      displayName: eingabe.name,
      searchText: eingabe.name.toLowerCase(),
      roleIds: eingabe.rollen ?? [],
      isBot: eingabe.bot ?? false,
      leftAt: eingabe.weg ? new Date() : null,
      boosting: eingabe.boostet ?? false,
    },
  });
}

async function legeProfilAn(discordId: string, slug: string, oeffentlich = true): Promise<void> {
  await prisma.memberProfile.create({
    data: {
      discordId,
      publicSlug: slug,
      visibilityProfile: oeffentlich ? 'PUBLIC' : 'PRIVATE',
    },
  });
}

describeWithDatabase('Mitgliederverzeichnis', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberProfile.deleteMany();
    await prisma.discordMemberCache.deleteMany();
    await prisma.discordRoleCache.deleteMany();
  });

  it('ordnet nach der Rollenhierarchie von oben nach unten', async () => {
    await legeRolle('r-admin', 'Admin', 90);
    await legeRolle('r-mod', 'Moderator', 50);
    await legeRolle('r-member', 'Mitglied', 10);

    // Absichtlich in der falschen Reihenfolge angelegt.
    await legeMitglied({ discordId: '1', name: 'Mitglied-A', rollen: ['r-member'] });
    await legeMitglied({ discordId: '2', name: 'Admin-A', rollen: ['r-admin'] });
    await legeMitglied({ discordId: '3', name: 'Mod-A', rollen: ['r-mod'] });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual([
      'Admin-A',
      'Mod-A',
      'Mitglied-A',
    ]);
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.hoechsteRolle?.name)).toEqual([
      'Admin',
      'Moderator',
      'Mitglied',
    ]);
  });

  it('nimmt bei mehreren Rollen die hoechste', async () => {
    // Discord ordnet selbst nach der hoechsten Rolle - nicht nach der ersten
    // in der Liste, und nicht nach der zuletzt vergebenen.
    await legeRolle('r-admin', 'Admin', 90);
    await legeRolle('r-member', 'Mitglied', 10);
    await legeMitglied({ discordId: '1', name: 'Beides', rollen: ['r-member', 'r-admin'] });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege[0]?.hoechsteRolle?.name).toBe('Admin');
  });

  it('ordnet innerhalb derselben Rolle nach dem Namen', async () => {
    /*
     * Ohne diese zweite Stufe waere die Reihenfolge innerhalb einer Rolle
     * beliebig - und bei jedem Aufruf eine andere. `de-CH` setzt dabei «Ä»
     * neben «A» statt hinter «Z».
     */
    await legeRolle('r-member', 'Mitglied', 10);
    for (const name of ['Zora', 'Ändi', 'Beat']) {
      await legeMitglied({ discordId: `id-${name}`, name, rollen: ['r-member'] });
    }

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual(['Ändi', 'Beat', 'Zora']);
  });

  it('stellt Mitglieder ohne Rolle nach unten', async () => {
    await legeRolle('r-member', 'Mitglied', 10);
    await legeMitglied({ discordId: '1', name: 'Ohne' });
    await legeMitglied({ discordId: '2', name: 'Mit', rollen: ['r-member'] });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual(['Mit', 'Ohne']);
    expect(verzeichnis.eintraege[1]?.hoechsteRolle).toBeNull();
  });

  it('ignoriert eine geloeschte Rolle fuer die Ordnung', async () => {
    /*
     * Geloeschte Rollen bleiben im Spiegel, damit alte Eintraege ihren Namen
     * behalten. Fuer die Ordnung taugen sie nicht mehr - sonst stuende jemand
     * oben wegen einer Rolle, die es auf Discord nicht mehr gibt.
     */
    await legeRolle('r-member', 'Mitglied', 10);
    await prisma.discordRoleCache.create({
      data: { roleId: 'r-alt', name: 'Alt-Admin', position: 99, deletedAt: new Date() },
    });
    await legeMitglied({ discordId: '1', name: 'Altlast', rollen: ['r-alt'] });
    await legeMitglied({ discordId: '2', name: 'Heute', rollen: ['r-member'] });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual(['Heute', 'Altlast']);
  });

  it('laesst Bots und Ausgetretene weg', async () => {
    // Ein Bot hat kein Profil, keine XP und keine Vitrine - er stuende als
    // Zeile da, die zu nichts fuehrt. Wer gegangen ist, ist nicht hier.
    await legeMitglied({ discordId: '1', name: 'Mensch' });
    await legeMitglied({ discordId: '2', name: 'Botli', bot: true });
    await legeMitglied({ discordId: '3', name: 'Weggegangen', weg: true });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual(['Mensch']);
    expect(verzeichnis.gesamt).toBe(1);
  });

  it('verlinkt nur veroeffentlichte Profile', async () => {
    /*
     * Die Zusicherung aus `slugsVon`: wer sein Profil nicht oeffentlich
     * gestellt hat, steht in der Liste - aber ohne Link. Die Liste sagt, wer
     * da ist, und nicht, wer sich zeigt.
     */
    await legeMitglied({ discordId: '1', name: 'Offen' });
    await legeMitglied({ discordId: '2', name: 'Privat' });
    await legeMitglied({ discordId: '3', name: 'Ohne Profil' });
    await legeProfilAn('1', 'offen');
    await legeProfilAn('2', 'privat', false);

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    const slugs = Object.fromEntries(
      verzeichnis.eintraege.map((eintrag) => [eintrag.anzeigename, eintrag.slug]),
    );
    expect(slugs).toEqual({ Offen: 'offen', Privat: null, 'Ohne Profil': null });
  });

  it('gibt keinen Slug fuer ein gesperrtes Profil heraus', async () => {
    // Eine Sperre schaltet jede oeffentliche Ausgabe ab - auch den Link hier.
    await legeMitglied({ discordId: '1', name: 'Gesperrt' });
    await prisma.memberProfile.create({
      data: {
        discordId: '1',
        publicSlug: 'gesperrt',
        visibilityProfile: 'PUBLIC',
        publicLockedAt: new Date(),
      },
    });

    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege[0]?.slug).toBeNull();
  });

  it('zaehlt den ganzen Bestand und blaettert darueber', async () => {
    await legeRolle('r-member', 'Mitglied', 10);
    for (let index = 0; index < 7; index += 1) {
      await legeMitglied({
        discordId: `id-${index}`,
        name: `Mitglied-${String(index).padStart(2, '0')}`,
        rollen: ['r-member'],
      });
    }

    const erste = await profile.ladeMitgliederverzeichnis({ seite: 1, seitengroesse: 3 });
    expect(erste.gesamt).toBe(7);
    expect(erste.seiten).toBe(3);
    expect(erste.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual([
      'Mitglied-00',
      'Mitglied-01',
      'Mitglied-02',
    ]);

    const letzte = await profile.ladeMitgliederverzeichnis({ seite: 3, seitengroesse: 3 });
    expect(letzte.eintraege.map((eintrag) => eintrag.anzeigename)).toEqual(['Mitglied-06']);

    /*
     * Kein Mitglied zweimal und keines verloren - die Probe darauf, dass
     * Ordnung und Schnitt zusammenpassen. Eine Sortierung, die bei jedem
     * Aufruf anders ist, laesst genau hier jemanden verschwinden.
     */
    const alleSeiten = [];
    for (const seite of [1, 2, 3]) {
      const ausschnitt = await profile.ladeMitgliederverzeichnis({ seite, seitengroesse: 3 });
      alleSeiten.push(...ausschnitt.eintraege.map((eintrag) => eintrag.discordId));
    }
    expect(new Set(alleSeiten).size).toBe(7);
  });

  it('sucht ueber den ganzen Bestand, nicht ueber eine Seite', async () => {
    await legeRolle('r-member', 'Mitglied', 10);
    for (let index = 0; index < 10; index += 1) {
      await legeMitglied({
        discordId: `id-${index}`,
        name: `Mitglied-${String(index).padStart(2, '0')}`,
        rollen: ['r-member'],
      });
    }
    await legeMitglied({ discordId: 'gesucht', name: 'Zuhinterst', rollen: ['r-member'] });

    const treffer = await profile.ladeMitgliederverzeichnis({ suche: 'zuhinterst', seitengroesse: 3 });
    expect(treffer.gesamt).toBe(1);
    expect(treffer.eintraege[0]?.anzeigename).toBe('Zuhinterst');
  });

  it('traegt den Boost-Stern durch', async () => {
    await legeMitglied({ discordId: '1', name: 'Booster', boostet: true });
    const verzeichnis = await profile.ladeMitgliederverzeichnis();
    expect(verzeichnis.eintraege[0]?.boosting).toBe(true);
  });
});
