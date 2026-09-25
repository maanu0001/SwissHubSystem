import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_berechnete_auszeichnungen');

/**
 * Gerechnete Auszeichnungen verwalten - und die Grenze, die dabei bleibt.
 *
 * ## Die beiden Haelften
 *
 * **Verwaltbar** sind Beschriftung, Beschreibung, Symbol, Stufe,
 * Schwellenwert und der Schalter «aktiv». **Nicht verwaltbar** ist, was
 * gezaehlt wird - das steht im Code, und von hier aus fuehrt kein Weg
 * dorthin. Damit gibt es kein Feld, ueber das ein Ausdruck in die
 * Auswertung gelangen koennte.
 *
 * **Nie vergeben.** Eine gerechnete Auszeichnung entsteht daraus, dass
 * jemand ein Turnier gewinnt. Der wichtigste Test hier ist deshalb der, der
 * beweist, dass es keinen Weg gibt, sie von Hand zu setzen - auch nicht
 * ueber eine Anfrage, die am Formular vorbeigeht.
 */
const { prisma } = await import('@swisshub/database');
const { profile } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000009', username: 'adminin' };

const grundlage = (teil: Partial<profile.Grundlage> = {}): profile.Grundlage => ({
  beitrittAm: new Date('2024-01-01T00:00:00Z'),
  level: 1,
  hoechstlevel: false,
  turniere: { teilgenommen: 0, podeste: 0, siege: 0 },
  clips: { eingereicht: 0, treppchen: 0, siege: 0, erhalteneStimmen: 0 },
  events: 0,
  spielprofile: 0,
  boostet: false,
  jetzt: new Date('2026-01-01T00:00:00Z'),
  ...teil,
});

const eingabe = (teil: Partial<profile.BerechneteArtEingabe> = {}): profile.BerechneteArtEingabe => ({
  label: 'Seriensieger',
  beschreibung: 'Drei Turniere gewonnen.',
  symbol: 'Trophy',
  stufe: 'gold',
  schwelle: 3,
  aktiv: true,
  ...teil,
});

describeWithDatabase('Gerechnete Auszeichnungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.computedAwardOverride.deleteMany({});
    await prisma.memberAward.deleteMany({});
    await prisma.awardDefinition.deleteMany({});
    await prisma.auditLog.deleteMany({});
  });

  // --- Ohne Anpassung -----------------------------------------------------

  it('gibt ohne Anpassung genau die Vorgaben aus dem Code', async () => {
    /*
     * Ein fehlender Eintrag heisst «unveraendert». Jede Vorgabe als Kopie in
     * die Datenbank zu schreiben hiesse, sie zweimal zu fuehren - und ein
     * spaeter verbesserter Text erreichte dann niemanden mehr.
     */
    const arten = await profile.berechneteArten();
    expect(arten).toEqual(profile.alleAuszeichnungsArten());
    expect(await prisma.computedAwardOverride.count()).toBe(0);
  });

  it('zeigt in der Verwaltung, was gezaehlt wird', async () => {
    const liste = await profile.berechneteArtenZurVerwaltung();
    const sieger = liste.find((art) => art.key === 'turnier-seriensieger');
    expect(sieger).toMatchObject({
      schwelleEinstellbar: true,
      schwelle: 3,
      schwelleVorgabe: 3,
      messwert: 'Turniersiege',
      aktiv: true,
      angepasst: false,
    });
  });

  it('kennt bei einem Ja-Nein-Merkmal keinen Schwellenwert', async () => {
    const liste = await profile.berechneteArtenZurVerwaltung();
    const booster = liste.find((art) => art.key === 'booster');
    expect(booster).toMatchObject({ schwelleEinstellbar: false, schwelle: null, schwelleVorgabe: null });
  });

  // --- Bearbeiten ---------------------------------------------------------

  it('uebernimmt Beschriftung, Symbol und Stufe', async () => {
    await profile.aendereBerechneteArt(
      'turnier-seriensieger',
      eingabe({ label: 'Turnierlegende', symbol: 'Crown', stufe: 'silber' }),
      ADMIN,
    );

    const art = (await profile.berechneteArten()).find((e) => e.key === 'turnier-seriensieger');
    expect(art).toMatchObject({ label: 'Turnierlegende', symbol: 'Crown', stufe: 'silber' });
  });

  it('macht einen geaenderten Schwellenwert sofort wirksam', async () => {
    /*
     * Kein Abgleichlauf danach - und das ist der Punkt. Gerechnete
     * Auszeichnungen stehen in keiner Tabelle; sie entstehen bei jeder
     * Anzeige neu. Ein geaenderter Schwellenwert wirkt deshalb ueberall
     * gleichzeitig, und es gibt nichts nachzuziehen.
     */
    const zweiSiege = grundlage({ turniere: { teilgenommen: 5, podeste: 2, siege: 2 } });

    const vorher = profile.bewerte(zweiSiege, await profile.berechneteArten());
    expect(vorher.find((a) => a.key === 'turnier-seriensieger')?.erreicht).toBe(false);

    await profile.aendereBerechneteArt('turnier-seriensieger', eingabe({ schwelle: 2 }), ADMIN);

    const nachher = profile.bewerte(zweiSiege, await profile.berechneteArten());
    expect(nachher.find((a) => a.key === 'turnier-seriensieger')?.erreicht).toBe(true);
  });

  it('rechnet den Fortschritt gegen den neuen Schwellenwert', async () => {
    await profile.aendereBerechneteArt('turnier-seriensieger', eingabe({ schwelle: 10 }), ADMIN);
    const bewertet = profile.bewerte(
      grundlage({ turniere: { teilgenommen: 9, podeste: 4, siege: 4 } }),
      await profile.berechneteArten(),
    );
    expect(bewertet.find((a) => a.key === 'turnier-seriensieger')?.fortschritt).toEqual({
      erreicht: 4,
      noetig: 10,
    });
  });

  it('verwirft einen Schwellenwert an einem Ja-Nein-Merkmal', async () => {
    await profile.aendereBerechneteArt(
      'booster',
      eingabe({ label: 'Booster', beschreibung: 'Boostet.', symbol: 'Rocket', schwelle: 99 }),
      ADMIN,
    );
    const art = (await profile.berechneteArten()).find((e) => e.key === 'booster');
    expect(art?.bedingung).toEqual({ art: 'flagge', flagge: 'boostet' });
  });

  it('weist ein unbekanntes Symbol ab', async () => {
    await expect(
      profile.aendereBerechneteArt('turnier-sieg', eingabe({ symbol: 'GibtEsNicht' }), ADMIN),
    ).rejects.toThrow();
  });

  it('weist einen Schwellenwert ausserhalb der Grenzen ab', async () => {
    await expect(
      profile.aendereBerechneteArt('turnier-sieg', eingabe({ schwelle: 0 }), ADMIN),
    ).rejects.toThrow();
    await expect(
      profile.aendereBerechneteArt('turnier-sieg', eingabe({ schwelle: 2_000_000 }), ADMIN),
    ).rejects.toThrow();
  });

  it('weist eine Auszeichnung ab, die es im Code nicht gibt', async () => {
    await expect(profile.aendereBerechneteArt('erfunden', eingabe(), ADMIN)).rejects.toThrow();
  });

  it('protokolliert die Aenderung', async () => {
    await profile.aendereBerechneteArt('turnier-seriensieger', eingabe({ schwelle: 7 }), ADMIN);
    const eintrag = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PROFILE_COMPUTED_AWARD_EDITED' },
    });
    expect(eintrag.actorDiscordId).toBe(ADMIN.discordId);
  });

  // --- Abschalten ---------------------------------------------------------

  it('nimmt eine abgeschaltete Auszeichnung aus jedem Profil', async () => {
    const mitSieg = grundlage({ turniere: { teilgenommen: 1, podeste: 1, siege: 1 } });
    expect(
      profile.bewerte(mitSieg, await profile.berechneteArten()).some((a) => a.key === 'turnier-sieg'),
    ).toBe(true);

    await profile.archiviereBerechneteArt('turnier-sieg', ADMIN);

    expect(
      profile.bewerte(mitSieg, await profile.berechneteArten()).some((a) => a.key === 'turnier-sieg'),
    ).toBe(false);
  });

  it('holt sie unveraendert zurueck', async () => {
    /*
     * Es geht nichts verloren, weil nie etwas gespeichert war: die
     * Auszeichnung entsteht aus dem Turniersieg, und der bleibt.
     */
    const mitSieg = grundlage({ turniere: { teilgenommen: 1, podeste: 1, siege: 1 } });
    await profile.archiviereBerechneteArt('turnier-sieg', ADMIN);
    await profile.holeBerechneteArtZurueck('turnier-sieg', ADMIN);

    const wieder = profile.bewerte(mitSieg, await profile.berechneteArten());
    expect(wieder.find((a) => a.key === 'turnier-sieg')?.erreicht).toBe(true);
  });

  it('schaltet auch ueber den Schalter «aktiv» ab', async () => {
    await profile.aendereBerechneteArt('turnier-sieg', eingabe({ schwelle: 1, aktiv: false }), ADMIN);
    const arten = await profile.berechneteArten();
    expect(arten.find((a) => a.key === 'turnier-sieg')?.aus).toBe(true);
  });

  it('setzt alles auf die Vorgabe zurueck', async () => {
    await profile.aendereBerechneteArt(
      'turnier-seriensieger',
      eingabe({ label: 'Irgendwas', schwelle: 42 }),
      ADMIN,
    );
    await profile.setzeBerechneteArtZurueck('turnier-seriensieger', ADMIN);

    const art = (await profile.berechneteArten()).find((e) => e.key === 'turnier-seriensieger');
    expect(art?.label).toBe('Seriensieger');
    expect(art?.bedingung).toEqual({ art: 'schwelle', messwert: 'turnierSiege', wert: 3 });
    expect(await prisma.computedAwardOverride.count()).toBe(0);
  });

  // --- Die Grenze ---------------------------------------------------------

  it('laesst eine gerechnete Auszeichnung nicht von Hand vergeben', async () => {
    /*
     * Der Kern der ganzen Trennung. Geprueft wird die Dienstebene, nicht
     * das Formular: eine manipulierte Anfrage kommt hier genauso an wie
     * eine ordentliche, und sie muss hier scheitern.
     */
    await expect(
      profile.verleihe(
        { discordId: ADMIN.discordId, username: ADMIN.username },
        { discordId: '100000000000000001', key: 'turnier-sieg' },
      ),
    ).rejects.toThrow(/gerechnet/u);
    expect(await prisma.memberAward.count()).toBe(0);
  });

  it('laesst sie auch dann nicht vergeben, wenn eine gleichnamige Definition existiert', async () => {
    /*
     * Der Fall, den die Pruefung beim Anlegen nicht abdeckt: sie greift,
     * wenn jemand eine verleihbare Art mit einem gerechneten Schluessel
     * anlegen will. Sie greift **nicht** rueckwirkend - kaeme spaeter eine
     * gerechnete Auszeichnung mit einem laengst vergebenen Schluessel dazu,
     * waere sie ploetzlich von Hand vergebbar.
     *
     * Hier wird genau dieser Zustand hergestellt, an der Pruefung vorbei.
     */
    await prisma.awardDefinition.create({
      data: {
        key: 'turnier-sieg',
        label: 'Turniersieg (gefaelscht)',
        description: 'Sollte es nicht geben.',
        symbol: 'Trophy',
        tier: 'gold',
      },
    });

    await expect(
      profile.verleihe(
        { discordId: ADMIN.discordId, username: ADMIN.username },
        { discordId: '100000000000000001', key: 'turnier-sieg' },
      ),
    ).rejects.toThrow(/gerechnet/u);
    expect(await prisma.memberAward.count()).toBe(0);
  });

  it('laesst eine abgeschaltete gerechnete Auszeichnung erst recht nicht vergeben', async () => {
    await profile.archiviereBerechneteArt('turnier-sieg', ADMIN);
    await expect(
      profile.verleihe(
        { discordId: ADMIN.discordId, username: ADMIN.username },
        { discordId: '100000000000000001', key: 'turnier-sieg' },
      ),
    ).rejects.toThrow();
  });

  it('laesst verleihbare Auszeichnungen unberuehrt', async () => {
    await prisma.awardDefinition.create({
      data: {
        key: 'og-member',
        label: 'OG Member',
        description: 'Von Anfang an dabei.',
        symbol: 'Star',
        tier: 'gold',
      },
    });
    expect(
      await profile.verleihe(
        { discordId: ADMIN.discordId, username: ADMIN.username },
        { discordId: '100000000000000001', key: 'og-member' },
      ),
    ).toBe(true);
  });
});
