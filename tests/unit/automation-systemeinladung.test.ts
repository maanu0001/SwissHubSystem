import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCondition,
  getTemplate,
  istErlaubterPfad,
  leeresUmfeld,
  leseWert,
  listSystemVorlagen,
  listTemplates,
  render,
  systemFreigabe,
  vorlageVollstaendig,
  type AutomationContext,
} from '@swisshub/automation';
import { automation as automationModul } from '@swisshub/modules';
import { appUrl } from '@swisshub/config';
import { branding } from '@swisshub/config/client';

/**
 * Die Systemeinladung und die Bausteine, auf denen sie steht.
 *
 * Geprüft wird hier, was ohne Datenbank prüfbar ist: dass die Vorlage
 * vollständig ist, dass ihre Platzhalter wirklich aufgelöst werden, dass die
 * Adresse aus der Konfiguration kommt und nicht aus einem Text, und dass
 * nichts davon eine Discord-Kennung festschreibt.
 *
 * Was eine Datenbank braucht - die Bedingung «hat ein Konto», die
 * Abklingzeit, das Anlegen der Systemautomation - steht in
 * `tests/integration/automation-systemeinladung.test.ts`.
 */

const WURZEL = join(__dirname, '..', '..');

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

/** Kommentare weg: eine Erklärung ist kein Verhalten. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const GILDE = '900000000000000001';

function kontext(zusatz: Partial<AutomationContext> = {}): AutomationContext {
  return {
    runId: 'run-1',
    automationId: 'auto-1',
    guildId: GILDE,
    correlationId: 'corr-1',
    depth: 0,
    dryRun: false,
    gateway: {} as AutomationContext['gateway'],
    event: {
      id: 'evt-1',
      type: null,
      actorId: '100000000000000001',
      subjectId: '100000000000000002',
      entityId: null,
      occurredAt: new Date('2026-10-03T12:00:00Z'),
    },
    payload: {},
    steps: {},
    now: new Date('2026-10-03T12:00:00Z'),
    ...leeresUmfeld(GILDE),
    ...zusatz,
  } as AutomationContext;
}

describe('Die Platzhalter über das betroffene Mitglied', () => {
  it('erlaubt die vier neuen Wurzeln als Pfad', () => {
    for (const pfad of [
      'user.name',
      'user.mention',
      'user.istBot',
      'invoker.name',
      'guild.name',
      'system.name',
      'system.appUrl',
      'system.loginUrl',
    ]) {
      expect(istErlaubterPfad(pfad), pfad).toBe(true);
    }
  });

  it('lässt eine Wurzel, die es nicht gibt, weiterhin nicht durch', () => {
    // Die Freigabeliste bleibt eine Freigabeliste: vier Namen dazu heisst
    // nicht, dass jetzt alles erreichbar ist.
    for (const pfad of ['process.env', 'env.TOKEN', 'prisma.user', 'user.__proto__.x']) {
      expect(istErlaubterPfad(pfad), pfad).toBe(false);
    }
  });

  it('löst die Person, die Gilde und das System im Text auf', () => {
    const context = kontext({
      user: {
        id: '100000000000000002',
        name: 'Nina',
        mention: '<@100000000000000002>',
        istBot: false,
        beigetretenAm: '2026-01-05T08:00:00.000Z',
      },
      guild: { id: GILDE, name: 'SwissHub' },
    });

    const ergebnis = render('Hoi {{user.name}} uf {{guild.name}} - {{system.loginUrl}}', context);
    expect(ergebnis.text).toBe(`Hoi Nina uf SwissHub - ${appUrl('/login')}`);
    expect(ergebnis.fehlend).toEqual([]);
  });

  it('nimmt die Adresse aus der Konfiguration und nicht aus der Vorlage', () => {
    /*
     * Die Zusage dahinter: wer eine Automation baut, kann den Anmeldelink
     * nicht umbiegen. Er steht nicht in der Vorlage, sondern wird je Lauf
     * serverseitig gesetzt - eine Phishing-Adresse liesse sich damit nicht
     * unterschieben, ohne die Konfiguration des Servers zu ändern.
     */
    const umfeld = leeresUmfeld(GILDE);
    expect(umfeld.system.loginUrl).toBe(appUrl('/login'));
    expect(umfeld.system.appUrl).toBe(appUrl('/'));
    expect(umfeld.system.name).toBe(branding.name);

    const vorlage = getTemplate(
      automationModul.SYSTEM_EINLADUNG_KEY === 'system_invite' ? 'system-einladung' : '',
    );
    const text = JSON.stringify(vorlage?.steps ?? []);
    expect(text).toContain('{{system.loginUrl}}');
    expect(text).not.toContain('https://');
  });

  it('macht aus einer unbesetzten Person eine leere Zeichenkette und meldet sie', () => {
    // Ein Lauf ohne Betroffenen soll keinen Absturz und kein «undefined» in
    // einer Direktnachricht ergeben.
    const ergebnis = render('Hoi {{user.name}}', kontext());
    expect(ergebnis.text).toBe('Hoi ');
    expect(ergebnis.fehlend).toEqual(['user.name']);
  });

  it('gibt ein ganzes Objekt nicht als Text heraus', () => {
    const context = kontext({ guild: { id: GILDE, name: 'SwissHub' } });
    expect(leseWert(context, 'guild')).toEqual({ id: GILDE, name: 'SwissHub' });
    expect(render('{{guild}}', context).text).toBe('');
  });
});

describe('Die Vorlage «Systemeinladung»', () => {
  const vorlage = getTemplate('system-einladung');

  it('ist angemeldet und vollständig', () => {
    expect(vorlage).toBeDefined();
    // `vorlageVollstaendig` prüft, ob es jeden Baustein wirklich gibt. Ohne
    // diesen Test wäre eine Vorlage mit einer erfundenen Bedingung einfach
    // unsichtbar - und niemand erfährt, warum.
    expect(vorlageVollstaendig(vorlage!)).toBe(true);
    expect(listTemplates().map((eintrag) => eintrag.id)).toContain('system-einladung');
  });

  it('steht auf Bedingungen, die es gibt', () => {
    for (const typ of ['istBot', 'webappKonto', 'abklingzeit']) {
      expect(getCondition(typ), typ).toBeDefined();
    }
  });

  it('schickt nur an Leute ohne Konto und nicht an Bots', () => {
    const bedingungen = JSON.stringify(vorlage!.conditions);
    expect(bedingungen).toContain('"typ":"webappKonto","negiert":true');
    expect(bedingungen).toContain('"typ":"istBot","negiert":true');
  });

  it('hat eine Abklingzeit, damit niemand zweimal eingeladen wird', () => {
    const bedingungen = JSON.stringify(vorlage!.conditions);
    expect(bedingungen).toContain('"typ":"abklingzeit"');
    expect(bedingungen).toContain('"bezug":"mitglied"');
  });

  it('schreibt privat und nicht in einen Kanal', () => {
    const schritte = JSON.stringify(vorlage!.steps);
    expect(schritte).toContain('"typ":"nachricht.direkt"');
    expect(schritte).not.toContain('nachricht.kanal');
    expect(schritte).toContain('"wen":"subject"');
  });

  it('kommt ohne festgeschriebene Rolle und verlangt sie beim Einrichten', () => {
    /*
     * Der Kern der Berechtigungsfrage: wer den Befehl auslösen darf,
     * entscheidet die Gilde über die freigegebenen Rollen - und die Vorlage
     * liefert diese Liste bewusst leer aus. Eine vorbelegte Rolle wäre eine
     * Entscheidung, die der Code nicht treffen darf.
     */
    expect((vorlage!.triggerConfig as { rollen?: unknown }).rollen).toEqual([]);
    expect(vorlage!.auszufuellen?.map((feld) => feld.pfad)).toContain('triggerConfig.rollen');
    expect(JSON.stringify(vorlage)).not.toMatch(/['"]\d{17,20}['"]/u);
  });
});

describe('Die Systemautomation und ihr Abgleich', () => {
  it('kennt genau einen Schlüssel und holt die Vorlage aus der Registry', () => {
    const text = ohneKommentare(quelle('packages/modules/src/automation/system.ts'));
    expect(automationModul.SYSTEM_EINLADUNG_KEY).toBe('system_invite');
    expect(text).toContain('listSystemVorlagen(');
    /*
     * Keine zweite Beschreibung derselben Automation: was sie tut, steht in
     * der Vorlage. Auch keine zweite **Liste** - der Schlüssel steht an der
     * Vorlage, nicht hier. Stünde er doppelt, liefen die beiden irgendwann
     * auseinander, und der Abgleich fände die Vorlage nicht mehr.
     */
    expect(text).not.toContain('nachricht.direkt');
    expect(text).not.toContain("vorlage: '");
    expect(text).not.toMatch(/['"]\d{17,20}['"]/u);
  });

  it('verbindet die Vorlage mit dem Schlüssel, unter dem sie gespeichert wird', () => {
    /*
     * Die beiden Enden derselben Sache: die Zeile in der Datenbank trägt
     * `systemKey`, die Vorlage trägt denselben Wert. Davon hängt die Freigabe
     * ab - ohne diese Verbindung wüsste `aendereSystemfelder` nicht, welche
     * Felder zu dieser Automation freigegeben sind, und gäbe sicherheitshalber
     * keines frei.
     */
    const systemvorlagen = listSystemVorlagen();
    expect(systemvorlagen.map((eintrag) => eintrag.systemKey)).toContain(
      automationModul.SYSTEM_EINLADUNG_KEY,
    );
    expect(getTemplate('system-einladung')?.systemKey).toBe(automationModul.SYSTEM_EINLADUNG_KEY);
  });

  it('bringt ihre Gleichzeitigkeit selbst mit', () => {
    /*
     * Zwei gleichzeitige Einladungen an dieselbe Person wären zwei identische
     * Direktnachrichten. Diese Werte standen im Abgleich - und damit hätte
     * eine zweite Systemvorlage sie geerbt, ohne dass es jemandem auffällt.
     */
    const einladung = getTemplate('system-einladung');
    expect(einladung?.concurrency).toBe('SKIP_IF_RUNNING');
    expect(einladung?.concurrencyKey).toBe('{{event.subjectId}}');
    const text = ohneKommentare(quelle('packages/modules/src/automation/system.ts'));
    expect(text).not.toContain("'SKIP_IF_RUNNING'");
    expect(text).toContain('vorlage.concurrency');
  });

  it('gibt genau die Felder frei, die die Vorlage ausweist', () => {
    expect(systemFreigabe(automationModul.SYSTEM_EINLADUNG_KEY).map((feld) => feld.pfad)).toEqual([
      'triggerConfig.rollen',
    ]);
    /*
     * Leer heisst «nichts freigegeben», nicht «alles». Ein unbekannter
     * Schlüssel ist der gefährlichere Fall: ohne Vorlage ist nicht bekannt,
     * was vorgegeben ist - dann ist Sperren die richtige Antwort.
     */
    expect(systemFreigabe('gibt-es-nicht')).toEqual([]);
    expect(systemFreigabe(null)).toEqual([]);
  });

  it('lässt an einer Systemautomation nur Werte ausfüllen, nicht den Ablauf', () => {
    /*
     * Die Grenze, die nicht in der Vorlage steht. Stünde dort eines Tages
     * `steps.0.typ`, liesse sich die Aktion austauschen - aus einer
     * Direktnachricht würde ein Rollenentzug. Der Speicher prüft deshalb die
     * Gestalt des Pfads selbst.
     */
    const text = quelle('packages/automation/src/store.ts');
    const abschnitt = text.slice(text.indexOf('function setzePfad'));
    expect(abschnitt).toContain("teile[0] === 'triggerConfig'");
    expect(abschnitt).toContain("teile[2] === 'config'");
    expect(abschnitt).toContain('VERBOTENE_SCHLUESSEL');
  });

  it('verlangt für die freigegebenen Felder dieselbe Berechtigung wie das Einschalten', () => {
    // Wer eine Systemautomation einschalten darf, darf auch sagen, für wen
    // sie gilt; wer sie nicht einschalten darf, soll sie nicht vorbereiten.
    const text = quelle('apps/web/src/modules/automation/actions.ts');
    const abschnitt = text.slice(text.indexOf('export const aendereSystemautomationAction'));
    const ende = abschnitt.indexOf('export const loescheAutomationAction');
    expect(abschnitt.slice(0, ende)).toContain('can(ctx, P.systemManage)');
  });

  it('wird beim Start des Bots abgeglichen', () => {
    const text = ohneKommentare(quelle('apps/bot/src/index.ts'));
    expect(text).toContain('stelleSystemautomationenSicher(guildId)');
    // Mit Auffangnetz: eine fehlende Systemautomation darf den Bot nicht am
    // Starten hindern.
    expect(text).toMatch(/stelleSystemautomationenSicher\(guildId\)[\s\S]{0,200}?\.catch\(/u);
  });

  it('überschreibt beim Auffrischen die Einstellungen der Gilde nicht', () => {
    /*
     * Die gefährliche Stelle. `triggerConfig` enthält die Rollen, die ein
     * Teammitglied eingetragen hat. Stünde es im `update`, hätte jeder
     * Neustart die Liste mit der leeren Vorlage überschrieben - und niemand
     * hätte gemerkt, warum der Befehl plötzlich für niemanden mehr da ist.
     */
    const text = quelle('packages/automation/src/store.ts');
    const abschnitt = text.slice(text.indexOf('export async function stelleSystemautomationSicher'));
    const auffrischen = abschnitt.slice(abschnitt.indexOf('const unveraendert'));
    expect(auffrischen).not.toContain('triggerConfig:');
    expect(auffrischen).not.toContain('enabled:');
    // Die Bedingungen hingegen gehören SwissHub und werden abgeglichen.
    expect(auffrischen).toContain('conditions:');
    expect(auffrischen).toContain('JSON.stringify(vorhanden.conditions ?? null)');
  });

  it('legt eine Systemautomation abgeschaltet an und merkt sich den Zählschlüssel', () => {
    const text = quelle('packages/automation/src/store.ts');
    const anlegen = text.slice(
      text.indexOf('export async function stelleSystemautomationSicher'),
      text.indexOf('const unveraendert'),
    );
    expect(anlegen).toContain('enabled: false');
    expect(anlegen).toContain('concurrencyKey: eingabe.concurrencyKey ?? null');
  });
});

describe('Die Option «user» an /automation', () => {
  const text = quelle('apps/bot/src/commands/automation-commands.ts');

  it('gibt dem Lauf ein betroffenes Mitglied', () => {
    expect(ohneKommentare(text)).toContain("interaction.options.getUser('user')");
    expect(ohneKommentare(text)).toContain('subjectId: ziel?.id ?? null');
  });

  it('ändert nichts an der Berechtigungsprüfung', () => {
    /*
     * Wer eine Automation starten darf, entscheiden weiterhin die
     * freigegebenen Rollen an ihr - und zwar mit derselben Funktion, die
     * auch die Vorschlagsliste erzeugt. Die neue Option darf daran nicht
     * vorbeiführen.
     */
    const ohne = ohneKommentare(text);
    expect(ohne).toContain('const erlaubte = await listeDiscordStartbare(interaction.guildId, rollen)');
    expect(ohne).toContain('erlaubte.find(');
    expect(ohne).not.toMatch(/['"]\d{17,20}['"]/u);
  });

  it('hält fest, wen ein Lauf betraf', () => {
    expect(ohneKommentare(text)).toContain('zielDiscordId: ziel.id');
  });
});

describe('Die Bedingung «hat ein SwissHub-Konto»', () => {
  const text = ohneKommentare(quelle('packages/modules/src/automation/conditions.ts'));

  it('ist angemeldet und beantwortet nur ja oder nein', () => {
    expect(getCondition('webappKonto')).toBeDefined();
    expect(text).toContain('prisma.user.count(');
    // Kein Name, keine Adresse, kein Datum: es gibt nichts, was über einen
    // Platzhalter in eine Nachricht geraten könnte.
    expect(text).not.toContain('findUnique');
    expect(text).not.toContain('select:');
  });

  it('verändert nichts', () => {
    // Der Probelauf prüft Bedingungen echt. Eine Bedingung mit Nebenwirkung
    // machte ihn gefährlich statt hilfreich.
    for (const schreibend of ['create', 'update', 'delete', 'upsert']) {
      expect(text, schreibend).not.toContain(`prisma.user.${schreibend}`);
    }
  });
});
