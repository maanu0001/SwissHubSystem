import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_profil_oeffentlich');

/**
 * Was ohne Anmeldung herausgeht - und was nicht.
 *
 * ## Der Kern
 *
 * `PUBLIC` ist nachtraeglich dazugekommen. Wer `MEMBERS` gewaehlt hat, hat
 * fuer angemeldete Mitglieder freigegeben und nicht fuer das offene Netz.
 * Der wichtigste Test hier ist deshalb der langweiligste: ein Profil auf
 * `MEMBERS` hat **keine** oeffentliche Seite. Faellt er, ist eine
 * Datenschutz-Einstellung still ausgeweitet worden.
 *
 * ## Warum gegen eine echte Datenbank
 *
 * Die Eindeutigkeit des Slugs und die Auswahl nach `publicSlug` sind
 * Datenbankverhalten. Und die Pruefung «steht nichts Privates drin» ist nur
 * dann etwas wert, wenn sie gegen das laeuft, was wirklich gespeichert ist.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const ANNA = '100000000000000001';
const BEN = '100000000000000002';

async function spiegel(discordId: string, name: string): Promise<void> {
  await prisma.discordMemberCache.create({
    data: {
      discordId,
      username: name.toLowerCase(),
      displayName: name,
      joinedAt: new Date('2021-03-01T00:00:00Z'),
      roleIds: [],
      isBot: false,
    },
  });
}

/** Alle Abschnitte auf eine Stufe stellen. */
async function sichtbarkeit(discordId: string, stufe: 'PUBLIC' | 'MEMBERS' | 'PRIVATE'): Promise<void> {
  await profile.speicherePrivatsphaere(discordId, {
    visibilityProfile: stufe,
    visibilityGames: stufe,
    visibilitySocials: stufe,
    visibilityCareer: stufe,
    visibilityActivity: stufe,
    discoverable: true,
  });
}

describeWithDatabase('Oeffentliche Profile', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.memberSocialLink.deleteMany({});
    await prisma.memberGameProfile.deleteMany({});
    await prisma.memberShowcase.deleteMany({});
    await prisma.memberProfile.deleteMany({});
    await prisma.discordMemberCache.deleteMany({});
  });

  it('gibt einem Profil auf MEMBERS keine oeffentliche Seite', async () => {
    await spiegel(ANNA, 'Anna');
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: 'Nur für Mitglieder',
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    await sichtbarkeit(ANNA, 'MEMBERS');

    // Ohne PUBLIC gibt es gar keinen Slug - und damit keine Adresse.
    const zeile = await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(zeile.publicSlug).toBeNull();
    expect(await profile.slugVon(ANNA)).toBeNull();

    /*
     * Und selbst mit einer Adresse bleibt die Seite zu.
     *
     * Der Slug wird hier von Hand gesetzt - genau der Zustand, der
     * entsteht, wenn jemand sein Profil einmal oeffentlich hatte und wieder
     * zurueckgestellt hat. Ohne diesen Teil pruefte der Test nur, dass kein
     * Slug vergeben wird, und nicht, dass die Sichtbarkeit haelt.
     */
    await prisma.memberProfile.update({ where: { discordId: ANNA }, data: { publicSlug: 'anna' } });
    expect(await profile.ladeOeffentlichesProfil('anna')).toBeNull();

    // Auch auf dem direkten Weg kommt nichts heraus, was fuer Mitglieder
    // gedacht war.
    const alsBesucher = await profile.ladeProfilFuer(ANNA, 'oeffentlich');
    expect(alsBesucher?.angaben).toBeUndefined();
    expect(JSON.stringify(alsBesucher)).not.toContain('Nur für Mitglieder');
  });

  it('vergibt den Slug erst beim Oeffentlichstellen', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'MEMBERS');
    expect(
      (await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } })).publicSlug,
    ).toBeNull();

    await sichtbarkeit(ANNA, 'PUBLIC');
    const slug = await profile.slugVon(ANNA);
    expect(slug).toBe('anna');
  });

  it('behaelt den Slug, wenn jemand wieder nicht-oeffentlich wird', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');
    await sichtbarkeit(ANNA, 'MEMBERS');

    // Die Zeile behaelt ihn - ein verteilter Link soll spaeter wieder auf
    // dieselbe Person zeigen und nicht auf jemand anderen.
    const zeile = await prisma.memberProfile.findUniqueOrThrow({ where: { discordId: ANNA } });
    expect(zeile.publicSlug).toBe('anna');
    // Erreichbar ist die Seite trotzdem nicht.
    expect(await profile.ladeOeffentlichesProfil('anna')).toBeNull();
    expect(await profile.slugVon(ANNA)).toBeNull();
  });

  it('weicht bei gleichem Namen auf eine freie Adresse aus', async () => {
    await spiegel(ANNA, 'Anna');
    await spiegel(BEN, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');
    await sichtbarkeit(BEN, 'PUBLIC');

    expect(await profile.slugVon(ANNA)).toBe('anna');
    expect(await profile.slugVon(BEN)).toBe('anna-2');
  });

  it('liefert das oeffentliche Profil ohne Anmeldung', async () => {
    await spiegel(ANNA, 'Anna');
    await profile.speichereAllgemein(ANNA, {
      displayName: 'Annchen',
      tagline: 'Abends im Voice',
      bio: 'Spiele seit 2015.',
      languages: ['de'],
      platforms: ['pc'],
      playtimes: [],
      comms: [],
      playStyle: 'COMPETITIVE',
      availability: 'UNSET',
    });
    await sichtbarkeit(ANNA, 'PUBLIC');

    // Der Slug kommt aus dem selbst gewaehlten Namen und nicht aus dem
    // Discord-Namen: er ist das, was jemand ueber sich sagt.
    expect(await profile.slugVon(ANNA)).toBe('annchen');

    const oeffentlich = await profile.ladeOeffentlichesProfil('annchen');
    expect(oeffentlich).not.toBeNull();
    expect(oeffentlich?.identitaet.name).toBe('Anna');
    expect(oeffentlich?.identitaet.profilname).toBe('Annchen');
    expect(oeffentlich?.angaben?.tagline).toBe('Abends im Voice');
  });

  it('haelt zurueck, was nicht oeffentlich steht', async () => {
    await spiegel(ANNA, 'Anna');
    await profile.speichereAllgemein(ANNA, {
      displayName: null,
      tagline: 'Sichtbar',
      bio: null,
      languages: [],
      platforms: [],
      playtimes: [],
      comms: [],
      playStyle: 'BOTH',
      availability: 'UNSET',
    });
    await profile.speichereSocials(ANNA, {
      eintraege: [{ platform: 'twitch', handle: 'geheimer_kanal' }],
    });
    // Angaben oeffentlich, Konten nicht.
    await profile.speicherePrivatsphaere(ANNA, {
      visibilityProfile: 'PUBLIC',
      visibilityGames: 'PUBLIC',
      visibilitySocials: 'MEMBERS',
      visibilityCareer: 'MEMBERS',
      visibilityActivity: 'MEMBERS',
      discoverable: true,
    });

    const oeffentlich = await profile.ladeOeffentlichesProfil('anna');
    expect(oeffentlich?.angaben?.tagline).toBe('Sichtbar');
    expect(oeffentlich?.socials).toBeUndefined();
    // Nicht nur ausgeblendet - der Wert steht nirgends im Ergebnis.
    expect(JSON.stringify(oeffentlich)).not.toContain('geheimer_kanal');
  });

  it('gibt niemals interne Daten heraus', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');

    const oeffentlich = await profile.ladeOeffentlichesProfil('anna');
    const roh = JSON.stringify(oeffentlich);

    // Was in einem oeffentlichen Profil nichts zu suchen hat. Die Liste ist
    // laenger als noetig: sie soll auch dann anschlagen, wenn jemand spaeter
    // ein Feld hinzufuegt, das eines dieser Woerter traegt.
    for (const verboten of [
      'email',
      'permission',
      'roleIds',
      'ticket',
      'jail',
      'moderation',
      'verification',
      'note',
      'appRole',
      'sessionId',
      'userId',
    ]) {
      expect(roh, `«${verboten}» steht im oeffentlichen Profil`).not.toContain(verboten);
    }
  });

  it('reicht ein neues Feld der Ansicht nicht ungefragt nach draussen', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');
    const ansicht = await profile.ladeProfilFuer(ANNA, 'oeffentlich');

    /*
     * Der eigentliche Zweck der Allowlist - und er laesst sich heute nur so
     * pruefen.
     *
     * `ProfilAnsicht` enthaelt derzeit nichts Privates: der Dienst laedt es
     * gar nicht erst. Baute `baueOeffentlichesProfil` abziehend statt
     * aufzaehlend, fiele das deshalb **nicht** auf - die Mutationsprobe hat
     * genau das gezeigt, alle zehn Tests blieben gruen.
     *
     * Gefaehrlich wird es beim naechsten Feld, das jemand der Ansicht
     * hinzufuegt. Deshalb wird hier eines untergeschoben: kommt es durch,
     * ist die Allowlist keine mehr.
     */
    const mitZusatz = { ...ansicht, internerVermerk: 'darf niemals herausgehen' };
    const oeffentlich = profile.baueOeffentlichesProfil(
      mitZusatz as unknown as NonNullable<typeof ansicht>,
      'anna',
    );

    expect(JSON.stringify(oeffentlich)).not.toContain('darf niemals herausgehen');
    expect(JSON.stringify(oeffentlich)).not.toContain('internerVermerk');
  });

  it('antwortet auf unbekannte und ungueltige Adressen gleich', async () => {
    expect(await profile.ladeOeffentlichesProfil('gibtesnicht')).toBeNull();
    expect(await profile.ladeOeffentlichesProfil('UPPERCASE')).toBeNull();
    expect(await profile.ladeOeffentlichesProfil('../../etc/passwd')).toBeNull();
    expect(await profile.ladeOeffentlichesProfil('admin')).toBeNull();
    expect(await profile.ladeOeffentlichesProfil('')).toBeNull();
  });

  it('zeigt nur erreichte Auszeichnungen', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');

    const oeffentlich = await profile.ladeOeffentlichesProfil('anna');
    expect(oeffentlich?.auszeichnungen.every((eintrag) => eintrag.erreicht)).toBe(true);
  });

  it('macht aus dem oeffentlichen Profil eine Ansicht ohne Besitzerknoepfe', async () => {
    await spiegel(ANNA, 'Anna');
    await sichtbarkeit(ANNA, 'PUBLIC');

    const oeffentlich = await profile.ladeOeffentlichesProfil('anna');
    const ansicht = profile.alsAnsicht(oeffentlich!);

    expect(ansicht.eigenes).toBe(false);
    // Kein Hinweis auf verborgene Abschnitte: das ist eine Auskunft ueber
    // fremde Entscheidungen.
    expect(ansicht.verborgen).toEqual([]);
  });
});
