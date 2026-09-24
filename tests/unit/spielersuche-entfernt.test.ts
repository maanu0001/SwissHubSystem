import { describe, expect, it } from 'vitest';

/**
 * Die Spielersuche ist weg - und bleibt es.
 *
 * ## Warum ein Test dafuer
 *
 * Ein entferntes Modul kommt nicht von selbst zurueck, aber seine Reste
 * schon: ein Eintrag in einer Berechtigungsvorlage, ein Link in der
 * Navigation, ein Job, der ins Leere laeuft. Jedes davon einzeln faellt
 * niemandem auf; zusammen ergeben sie ein Modul, das halb noch da ist.
 *
 * Geprueft wird deshalb die Abwesenheit, und zwar dort, wo sie sich messen
 * laesst: im Quelltext, in der Modulregistry, in der Permission Engine, in
 * der Liste der Slash Commands.
 *
 * Was ausdruecklich **nicht** geprueft wird: das Audit Log. Die Aktionen
 * `SPIELERSUCHE_*` stehen in vorhandenen Eintraegen und muessen lesbar
 * bleiben - eine Beweiskette streicht man nicht, weil ein Modul endet.
 */
const { existsSync, readFileSync, globSync } = await import('node:fs');
const { join } = await import('node:path');

function quelle(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

/** Alle Quelldateien der Anwendung - ohne Tests, ohne Erzeugtes. */
function alleQuellen(): string[] {
  return globSync(['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'], {
    cwd: process.cwd(),
  }).filter((pfad) => !pfad.includes('/.next/'));
}

describe('Das Modul selbst', () => {
  it('hat keine Dateien mehr', () => {
    for (const pfad of [
      'packages/modules/src/spielersuche',
      'apps/web/src/app/(app)/spielersuche',
      'apps/web/src/app/api/spielersuche',
      'apps/web/src/modules/spielersuche',
      'apps/web/src/server/spielersuche.ts',
      'apps/bot/src/commands/spielersuche-commands.ts',
      'apps/bot/src/spielersuche-buttons.ts',
      'apps/bot/src/spielersuche-voice.ts',
    ]) {
      expect(existsSync(join(process.cwd(), pfad)), pfad).toBe(false);
    }
  });

  it('steht in keiner Modulregistry mehr', async () => {
    const { listModuleDefinitions } = await import('@swisshub/modules');
    const ids = listModuleDefinitions().map((modul) => modul.id);
    expect(ids).not.toContain('spielersuche');
    // Die Gegenprobe: die Registry ist nicht etwa leer.
    expect(ids).toContain('spielwahl');
  });

  it('wird nirgends mehr importiert', () => {
    const treffer = alleQuellen().filter((pfad) => {
      const inhalt = quelle(pfad);
      return /from '[^']*spielersuche[^']*'|prisma\.spielersuche(Match|Participant|Usage|VoiceSession|Import|RolePing|Game)\b/u.test(
        inhalt,
      );
    });
    expect(treffer).toEqual([]);
  });
});

describe('Berechtigungen', () => {
  it('kennt keine Spielersuche-Berechtigung mehr', async () => {
    // Ueber `@swisshub/modules`, damit die Moduldefinitionen sich vorher
    // registriert haben - die Engine allein kennt nur die Kernrechte.
    await import('@swisshub/modules');
    const { listPermissions } = await import('@swisshub/permissions');
    const schluessel = listPermissions().map((eintrag) => eintrag.key);
    expect(schluessel.filter((key) => key.startsWith('spielersuche.'))).toEqual([]);
    expect(schluessel.filter((key) => key.includes('.spielersuche.'))).toEqual([]);
  });

  it('gibt keiner Vorlage mehr Spielersuche-Rechte', async () => {
    const { PERMISSION_PRESETS, resolvePreset } = await import('@swisshub/permissions');
    for (const vorlage of PERMISSION_PRESETS) {
      const rechte = resolvePreset(vorlage);
      expect(
        rechte.filter((key) => key.includes('spielersuche')),
        `Vorlage «${vorlage.label}»`,
      ).toEqual([]);
    }
  });

  it('lässt keine Rolle durch die Entfernung mehr können als vorher', async () => {
    /*
     * Der gefaehrliche Fall waere andersherum: eine Berechtigung, die es
     * nicht mehr gibt, faellt aus einer Vorlage - und eine Rolle bekaeme
     * dadurch mehr. Das kann hier nicht passieren, weil ausschliesslich
     * entfernt wurde. Geprueft wird es trotzdem, weil «kann nicht passieren»
     * kein Beleg ist.
     */
    const { PERMISSION_PRESETS, resolvePreset } = await import('@swisshub/permissions');
    const mitglied = PERMISSION_PRESETS.find((vorlage) => vorlage.id === 'mitglied');
    expect(mitglied).toBeDefined();

    const rechte = resolvePreset(mitglied!);
    for (const verwaltend of [
      'spielwahl.games.manage',
      'spielwahl.manage',
      'spielwahl.settings',
      'members.view.basic.all',
      'audit.view',
    ]) {
      expect(rechte, `«Mitglied» darf ${verwaltend} nicht`).not.toContain(verwaltend);
    }
  });
});

describe('Discord', () => {
  it('registriert den Slash Command nicht mehr', () => {
    /*
     * `client.application.commands.set(ALL_COMMANDS, guildId)` ersetzt die
     * Liste auf Discord **vollstaendig**. Ein Befehl, der hier nicht mehr
     * steht, verschwindet damit beim naechsten Start auch dort - es braucht
     * keine zusaetzliche Abmeldung.
     *
     * Genau deshalb haengt alles an dieser einen Liste, und genau deshalb
     * wird sie hier geprueft.
     */
    const register = quelle('apps/bot/src/commands/register.ts');
    expect(register).toContain('client.application.commands.set(ALL_COMMANDS, guildId)');
    expect(register).not.toContain('SPIELERSUCHE');
    expect(register).not.toContain('spielersuche');
    // Die Gegenprobe: «Was spielen wir?» steht weiterhin drin.
    expect(register).toContain('SPIELWAHL_COMMAND_DEFINITIONS');
  });

  it('fängt die Knöpfe alter Nachrichten ab', () => {
    /*
     * Eine Discord-Nachricht bleibt stehen, auch wenn der Code dahinter weg
     * ist. Ohne Handler bekaeme der Klickende «Diese Interaktion ist
     * fehlgeschlagen» - eine Fehlermeldung, die nichts erklaert.
     */
    const altlasten = quelle('apps/bot/src/altlasten.ts');
    for (const id of [
      'swisshub:spielersuche:join',
      'swisshub:spielersuche:leave',
      'swisshub:spielersuche:close',
      'swisshub:spielersuche:help',
      'swisshub_spielersuche:join',
    ]) {
      expect(altlasten, id).toContain(id);
    }
    expect(altlasten).toContain('MessageFlags.Ephemeral');
    // Er antwortet und veraendert nichts.
    expect(altlasten).not.toContain('prisma.');
    expect(quelle('apps/bot/src/index.ts')).toContain('registerAbgeschalteteKnoepfe(client)');
  });

  it('startet keinen Job des Moduls mehr', () => {
    const jobs = quelle('apps/bot/src/jobs.ts');
    expect(jobs).not.toContain('spielersuche');
    // Die Gegenprobe: es gibt weiterhin Jobs.
    expect(jobs).toContain("name: 'level-voice-xp'");
  });
});

describe('Navigation und Oberfläche', () => {
  it('verweist nirgends mehr auf eine Spielersuche-Adresse', () => {
    const treffer: string[] = [];
    for (const pfad of alleQuellen()) {
      if (/['"`]\/spielersuche/u.test(quelle(pfad))) {
        treffer.push(pfad);
      }
    }
    expect(treffer).toEqual([]);
  });

  it('kennt die Adresse auch in den zentralen Routen nicht mehr', () => {
    const routen = quelle('packages/shared/src/routes.ts');
    expect(routen).not.toContain('spielersuche');
    // Und die neue Verwaltung hat eine.
    expect(routen).toContain("spielekatalog: (): SystemRoute => '/was-spielen-wir/games'");
  });

  it('hält die historischen Audit-Namen lesbar', () => {
    /*
     * Die Ausnahme von allem oben. Wer diese Namen entfernt, macht Monate an
     * Protokolleintraegen unleserlich - und ein Audit Log, das seine eigene
     * Vergangenheit nicht mehr benennen kann, ist keines.
     */
    const labels = quelle('apps/web/src/modules/audit/labels.ts');
    for (const aktion of [
      'SPIELERSUCHE_CREATED',
      'SPIELERSUCHE_JOINED',
      'SPIELERSUCHE_CLOSED',
      'SPIELERSUCHE_GAME_CREATED',
    ]) {
      expect(labels, aktion).toContain(aktion);
    }
  });
});
