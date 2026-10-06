import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_permission_altlasten');

/**
 * Die Aufräumung der toten Rechtezeilen - an der echten Datenbank.
 *
 * ## Warum nicht nur ein Unit-Test
 *
 * `aufloeseAltlasten` entscheidet richtig, das ist anderswo geprüft. Hier
 * geht es um die Zeilen selbst: ob die Migration genau die acht Schlüssel der
 * entfernten Spielersuche wegnimmt und jede andere Zuordnung stehen lässt.
 * Das ist die Frage, bei der ein Irrtum teuer wäre - eine zu grosszügige
 * Bedingung nimmt einer Rolle Rechte weg, die sie braucht.
 *
 * Der Test führt das SQL der Migration selbst aus, nicht eine Kopie davon.
 * Eine Kopie würde prüfen, ob der Test funktioniert.
 */
const { prisma } = await import('@swisshub/database');
const { aufloeseAltlasten, isKnownPermission } = await import('@swisshub/permissions');
const { permissionGesundheit } = await import('@/modules/configuration/permission-gesundheit');
await import('@swisshub/modules');

const ROLLE = '900000000000000011';
const ANDERE = '900000000000000012';

const ALTLASTEN = [
  'members.view.spielersuche.all',
  'members.view.spielersuche.own',
  'spielersuche.closeOwn',
  'spielersuche.create',
  'spielersuche.join',
  'spielersuche.module.view',
  'spielersuche.stats.viewOwn',
  'spielersuche.view',
];
const ECHTE = ['dashboard.view', 'members.view', 'level.xpslot.play'];

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'packages/database/prisma/migrations/20261027080000_spielersuche_rechte_aufraeumen/migration.sql',
  ),
  'utf8',
);

describeWithDatabase('Tote Rechtezeilen aufräumen', () => {
  beforeAll(async () => {
    await pushSchema();
    /*
     * Der Startzustand wird hergestellt, nicht angenommen: `pushSchema`
     * bringt das Schema auf den Stand, nicht die Zeilen, und das Testschema
     * behält die Daten des letzten Laufs.
     */
    await prisma.rolePermission.deleteMany({ where: { discordRoleId: { in: [ROLLE, ANDERE] } } });
    await prisma.managedRole.deleteMany({ where: { discordRoleId: { in: [ROLLE, ANDERE] } } });

    for (const [discordRoleId, label] of [
      [ROLLE, 'Mitglied'],
      [ANDERE, 'Moderation'],
    ] as const) {
      await prisma.managedRole.create({ data: { discordRoleId, label } });
    }
    // Eine Rolle mit Altlasten und echten Rechten, eine nur mit echten.
    await prisma.rolePermission.createMany({
      data: [
        ...ALTLASTEN.map((permission) => ({ discordRoleId: ROLLE, permission, effect: 'ALLOW' as const })),
        ...ECHTE.map((permission) => ({ discordRoleId: ROLLE, permission, effect: 'ALLOW' as const })),
        ...ECHTE.map((permission) => ({ discordRoleId: ANDERE, permission, effect: 'ALLOW' as const })),
        // Eine Ausnahme, damit auch DENY-Zeilen im Blick sind.
        { discordRoleId: ANDERE, permission: 'moderation.execute', effect: 'DENY' as const },
      ],
    });
  });

  it('findet vorher genau die acht toten Zeilen', async () => {
    const zeilen = await prisma.rolePermission.findMany({ where: { discordRoleId: ROLLE } });
    const tot = zeilen.filter((zeile) => !isKnownPermission(zeile.permission));
    expect(tot.map((zeile) => zeile.permission).sort()).toEqual([...ALTLASTEN].sort());
  });

  it('blockierte vorher das Speichern der ganzen Rolle', () => {
    /*
     * Die alte Prüfung wies jeden Schlüssel ab, den die Registry nicht kennt.
     * Das ist der Zustand, aus dem die Fehlermeldung kam - hier einmal
     * nachgestellt, damit sichtbar bleibt, was behoben wurde.
     */
    const ausDerDatenbank = [...ALTLASTEN, ...ECHTE];
    const alteAbweisung = ausDerDatenbank.filter((key) => !isKnownPermission(key));
    expect(alteAbweisung.length).toBeGreaterThan(0);

    // Und derselbe Stand durch die neue Auflösung: nichts Unbekanntes mehr.
    const ergebnis = aufloeseAltlasten(ausDerDatenbank);
    expect(ergebnis.unbekannt).toEqual([]);
    expect(ergebnis.gueltig.sort()).toEqual([...ECHTE].sort());
    expect(ergebnis.entfernt.sort()).toEqual([...ALTLASTEN].sort());
  });

  /*
   * Die Diagnose - vor der Aufräumung, denn danach gibt es nichts zu zeigen.
   *
   * Sie macht sichtbar, was sonst erst auffällt, wenn es das Speichern
   * blockiert: der Fehler dieser Runde lag ein Jahr in der Datenbank, und
   * niemand konnte ihn sehen.
   */
  it('zeigt die toten Zeilen in der Diagnose, getrennt nach benannt und nicht', async () => {
    // Ein Schlüssel, den weder die Registry noch die Altlastenliste kennt.
    await prisma.rolePermission.create({
      data: { discordRoleId: ANDERE, permission: 'gibt.es.nicht', effect: 'ALLOW' },
    });

    const stand = await permissionGesundheit();
    expect(stand.registriert).toBeGreaterThan(300);
    expect(stand.altlasten.map((eintrag) => eintrag.key).sort()).toEqual([...ALTLASTEN].sort());
    expect(stand.altlasten[0]?.grund).toContain('Spielersuche');
    expect(stand.unbenannt).toEqual([{ key: 'gibt.es.nicht', zeilen: 1 }]);

    // Gültige Zuordnungen kommen in keiner der beiden Listen vor.
    const genannt = [...stand.altlasten, ...stand.unbenannt].map((eintrag) => eintrag.key);
    for (const key of ECHTE) {
      expect(genannt, key).not.toContain(key);
    }

    await prisma.rolePermission.deleteMany({ where: { permission: 'gibt.es.nicht' } });
  });

  it('nimmt mit der Migration genau diese acht weg', async () => {
    const anweisung = migrationSql
      .split('\n')
      .filter((zeile) => !zeile.trimStart().startsWith('--'))
      .join('\n');
    await prisma.$executeRawUnsafe(anweisung);

    const uebrig = await prisma.rolePermission.findMany({ where: { discordRoleId: ROLLE } });
    expect(uebrig.map((zeile) => zeile.permission).sort()).toEqual([...ECHTE].sort());
  });

  it('lässt die andere Rolle vollständig stehen', async () => {
    const andere = await prisma.rolePermission.findMany({ where: { discordRoleId: ANDERE } });
    expect(andere.map((zeile) => zeile.permission).sort()).toEqual([...ECHTE, 'moderation.execute'].sort());
    // Auch die Wirkung bleibt, wie sie war.
    expect(andere.find((zeile) => zeile.permission === 'moderation.execute')?.effect).toBe('DENY');
  });

  it('lässt die Rollen selbst unangetastet', async () => {
    const rollen = await prisma.managedRole.findMany({
      where: { discordRoleId: { in: [ROLLE, ANDERE] } },
    });
    expect(rollen.length).toBe(2);
  });

  it('schweigt in der Diagnose, sobald aufgeräumt ist', async () => {
    /*
     * Der Gegentest. Eine Diagnose, die immer etwas meldet, ist keine - und
     * der Kasten auf der Berechtigungsseite erscheint nur, wenn beide Listen
     * etwas enthalten.
     */
    const stand = await permissionGesundheit();
    expect(stand.altlasten).toEqual([]);
    expect(stand.unbenannt).toEqual([]);
    expect(stand.zuordnungen).toBeGreaterThan(0);
  });

  it('lässt sich zweimal ausführen', async () => {
    /*
     * Eine Aufräumung, die beim zweiten Lauf etwas anderes tut, ist eine
     * Zeitbombe - und Migrationen laufen auf Kopien, in Restore-Tests und in
     * der Entwicklung mehrfach.
     */
    const anweisung = migrationSql
      .split('\n')
      .filter((zeile) => !zeile.trimStart().startsWith('--'))
      .join('\n');
    await prisma.$executeRawUnsafe(anweisung);
    const uebrig = await prisma.rolePermission.findMany({ where: { discordRoleId: ROLLE } });
    expect(uebrig.map((zeile) => zeile.permission).sort()).toEqual([...ECHTE].sort());
  });
});
