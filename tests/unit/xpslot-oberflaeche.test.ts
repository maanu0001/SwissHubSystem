import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { level } from '@swisshub/modules';

/**
 * Der Befehl und die Oberflaeche - geprueft an der Quelle.
 *
 * ## Warum am Quelltext und nicht an einem gerenderten Bild
 *
 * Weil die Zusicherungen hier **struktureller** Art sind: dass im Browser
 * kein Spin entsteht, dass ein Tonproblem nichts abbricht, dass es genau eine
 * Auto-Spin-Schleife gibt, dass der Einsatz nie stillschweigend abgewertet
 * wird. Das sind Aussagen darueber, was im Code **nicht** vorkommt - und
 * dafuer ist der Quelltext die Wahrheit, nicht ein Screenshot.
 *
 * Diese Tests sind bewusst grob: sie fangen den Rueckschritt, nicht den
 * Tippfehler. Ein Entwurf, der die Walzen im Browser auswuerfelt, faellt hier
 * auf - und das ist der Fehler, auf den es ankommt.
 */

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');

/**
 * Derselbe Kniff wie in den uebrigen Quelltests: Kommentare weg, bevor
 * gesucht wird. Sonst prueft der Test die Erklaerung statt den Code - und ein
 * Satz wie «hier steht kein Math.random» liesse ihn durchfallen.
 */
const ohneKommentare = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

const BEFEHL = 'apps/bot/src/commands/xpslot-commands.ts';
const REGISTER = 'apps/bot/src/commands/register.ts';
const SPIEL = 'apps/web/src/modules/level/xpslot/components/spiel.tsx';
const KLANG = 'apps/web/src/modules/level/xpslot/components/klang.ts';
const WALZEN = 'apps/web/src/modules/level/xpslot/components/walzen.tsx';
const CSS = 'apps/web/src/modules/level/xpslot/xpslot.css';
/*
 * Eine Ebene hoeher als die uebrigen Slot-Dateien, und das mit Absicht:
 * `tests/unit/action-authorization.test.ts` sucht Server Actions mit einem
 * Glob, das nur eine Ebene tief greift. Unter `xpslot/actions.ts` waere die
 * Datei dieser Pruefung entgangen - siehe den Kopf der Datei selbst.
 */
const ACTIONS = 'apps/web/src/modules/level/xpslot-actions.ts';

describe('/xp-slot', () => {
  it('ist registriert und wird verteilt', () => {
    const register = lies(REGISTER);
    expect(register).toContain('XPSLOT_COMMAND_DEFINITIONS');
    expect(register).toContain('handleXpSlotCommand');
    expect(register).toContain('XPSLOT_COMMAND_NAMES.has(interaction.commandName)');
  });

  it('heisst xp-slot und nimmt keine Optionen', () => {
    expect(level.xpslot).toBeDefined();
    const quelle = lies(BEFEHL);
    expect(quelle).toContain("name: 'xp-slot'");
    expect(quelle).toContain('options: []');
  });

  it('schickt einen Link-Knopf auf die zentrale WebApp-Adresse', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    // `appUrl` statt eines Hostnamens im Code: auf dem naechsten Server waere
    // ein fester Host falsch.
    expect(quelle).toContain("appUrl('/level/xp-slot')");
    expect(quelle).not.toMatch(/https?:\/\/[a-z]/u);
    // Ein Link-Knopf (style 5) und keine `custom_id` - sonst waere es ein
    // Knopf, der auf Discord etwas ausloest.
    expect(quelle).toContain('style: 5');
    expect(quelle).not.toContain('custom_id');
  });

  it('spielt auf Discord nicht', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    for (const verboten of ['dreheSpin', 'applyXp', 'nimmFreispiele', 'riskiere', 'testlauf']) {
      expect(quelle).not.toContain(verboten);
    }
  });

  it('prüft Modulstatus, Slotstatus und Berechtigung', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).toContain('isModuleEnabled(level.LEVEL_MODULE_ID)');
    expect(quelle).toContain('istSpielbar(konfiguration)');
    expect(quelle).toContain('actor.can(level.LEVEL_PERMISSIONS.xpslotPlay)');
    expect(quelle).toContain('NO_PERMISSION');
  });

  it('nennt keine festen Rollenkennungen', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).not.toMatch(/\d{17,20}/u);
  });

  it('antwortet nur dem Aufrufer', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).toContain('MessageFlags.Ephemeral');
  });

  it('nimmt die Zahlen im Embed aus der Konfiguration', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).toContain('ansicht.einsaetze.join');
    expect(quelle).toContain('w.jackpotMultiplikator');
    expect(quelle).toContain('ansicht.rtp');
  });
});

describe('Berechtigungen', () => {
  it('gibt es in den vier vorgesehenen Formen', () => {
    const P = level.LEVEL_PERMISSIONS;
    expect(P.xpslotPlay).toBe('level.xpslot.play');
    expect(P.xpslotManage).toBe('level.xpslot.manage');
    expect(P.xpslotStats).toBe('level.xpslot.stats');
    expect(P.xpslotFreespinsManage).toBe('level.xpslot.freespins.manage');
  });

  it('hängt jede Server Action an eine davon', () => {
    const quelle = lies(ACTIONS);
    const aktionen = [...quelle.matchAll(/name: 'level\.xpslot\.[a-z.]+'/gu)];
    // Der Test soll nicht leer durchlaufen, wenn die Datei umgebaut wird.
    expect(aktionen.length).toBeGreaterThan(15);
    const berechtigungen = [...quelle.matchAll(/permission: P\.xpslot[A-Za-z]*/gu)];
    expect(berechtigungen.length).toBe(aktionen.length);
  });

  it('verlangt für Freispiele die eigene Berechtigung', () => {
    const quelle = lies(ACTIONS);
    expect(quelle).toContain('permission: P.xpslotFreespinsManage');
  });

  it('begrenzt jede Action mit einem Rate Limit', () => {
    const quelle = lies(ACTIONS);
    const aktionen = [...quelle.matchAll(/name: 'level\.xpslot\.[a-z.]+'/gu)];
    const limits = [...quelle.matchAll(/rateLimit: '(slotSpin|slotAdmin|slotUpload)'/gu)];
    expect(limits.length).toBe(aktionen.length);
  });
});

describe('Die Oberfläche entscheidet nichts', () => {
  it('holt jedes Ergebnis über eine Server Action', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('await spinAction(');
    expect(quelle).toContain('bonusNehmenAction');
    expect(quelle).toContain('bonusRiskierenAction');
  });

  it('würfelt im Browser keine Symbole und keinen Gewinn aus', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    for (const verboten of ['werteAus', 'dreheWalzen', 'ziehSymbol', 'besterLinien']) {
      expect(quelle).not.toContain(verboten);
    }
  });

  it('nutzt Math.random nur für den Schlüssel gegen Doppelklicks', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    const treffer = [...quelle.matchAll(/Math\.random\(\)/gu)];
    expect(treffer).toHaveLength(1);
    // Und zwar in der Zeile, die den Schluessel baut.
    const zeile = quelle.split('\n').find((eintrag) => eintrag.includes('Math.random()')) ?? '';
    expect(zeile).toContain('schluessel');
  });

  it('zeigt während des Laufs Füllsymbole und nicht das Ergebnis', () => {
    const quelle = ohneKommentare(lies(WALZEN));
    expect(quelle).toContain('fuellung(');
    expect(quelle).toContain('laeuft');
  });

  it('wertet den Einsatz nie stillschweigend ab', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    // Es gibt keine Stelle, die den Einsatz verkleinert.
    expect(quelle).not.toMatch(/Math\.min\([^)]*einsatz/iu);
    // Der wirksame Einsatz kommt entweder aus dem Paket oder aus der Wahl.
    expect(quelle).toContain('const wirksamerEinsatz = festerEinsatz ?? einsatz;');
  });

  it('sperrt die Einsatzwahl, solange Freispiele laufen', () => {
    const quelle = lies(SPIEL);
    expect(quelle).toContain('disabled={beschaeftigt || festerEinsatz !== null}');
  });
});

describe('Auto-Spin', () => {
  it('läuft genau einmal - ein Riegel gegen die zweite Schleife', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('const laeuftRef = useRef(false)');
    // Beide Einstiege pruefen den Riegel.
    const pruefungen = [...quelle.matchAll(/if \(laeuftRef\.current\) \{/gu)];
    expect(pruefungen.length).toBeGreaterThanOrEqual(2);
  });

  it('lässt sich jederzeit anhalten', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('abbrechenRef');
    expect(quelle).toContain('Stop (');
  });

  it('hält bei Bonus, Jackpot, Premium und grossen Gewinnen', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('spin.bonusAusgeloest ||');
    expect(quelle).toContain('spin.jackpot ||');
    expect(quelle).toContain('spin.premiumTage > 0 ||');
    expect(quelle).toContain("spin.stufe === 'gross'");
    expect(quelle).toContain("spin.stufe === 'mega'");
  });

  it('hält bei einem Fehler - etwa zu wenig XP oder eine erreichte Grenze', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toMatch(/if \(grund\) \{[\s\S]{0,120}break;/u);
  });

  it('bietet nur die eingestellten Zahlen und nie unbegrenzt', () => {
    const quelle = lies(SPIEL);
    expect(quelle).toContain('ansicht.autoSpinZahlen.map');
    expect(quelle).not.toMatch(/unbegrenzt|Infinity|while \(true\)/u);
    expect(level.xpslot.AUTO_SPIN_VORGABEN).toEqual([10, 25, 50, 100]);
  });
});

describe('Ton', () => {
  it('bricht nie etwas ab - jedes play() ist abgefangen', () => {
    const quelle = ohneKommentare(lies(KLANG));
    expect(quelle).not.toContain('throw');
    const abspielen = [...quelle.matchAll(/\.play\(\)/gu)];
    expect(abspielen.length).toBeGreaterThan(0);
    for (const treffer of abspielen) {
      const danach = quelle.slice(treffer.index ?? 0, (treffer.index ?? 0) + 60);
      expect(danach).toContain('.catch(');
    }
  });

  it('lädt erst nach einer Berührung', () => {
    const quelle = ohneKommentare(lies(KLANG));
    expect(quelle).toContain('if (!freigegeben');
    expect(quelle).toContain('freigeben');
  });

  it('ist still, wenn ein Slot keine Datei hat', () => {
    const quelle = ohneKommentare(lies(KLANG));
    expect(quelle).toContain('if (!eintrag)');
  });

  it('hat zwei Regler mit eigenem Schalter und merkt sie sich', () => {
    const quelle = lies(KLANG);
    expect(quelle).toContain('musikAn');
    expect(quelle).toContain('effekteAn');
    expect(quelle).toContain('musikLaut');
    expect(quelle).toContain('effekteLaut');
    expect(quelle).toContain('localStorage');
  });

  it('übersteht einen gesperrten Speicher', () => {
    const quelle = ohneKommentare(lies(KLANG));
    const zugriffe = [...quelle.matchAll(/localStorage/gu)];
    expect(zugriffe.length).toBeGreaterThan(0);
    // Jeder Zugriff steht in einem `try`.
    expect(quelle.split('try {').length - 1).toBeGreaterThanOrEqual(zugriffe.length);
  });
});

describe('Klangslots', () => {
  it('deckt die im Konzept verlangten Stellen ab', () => {
    const slots = level.xpslot.KLANG_SLOT_KEYS;
    for (const noetig of [
      'ui_button',
      'spin_start',
      'reel_loop',
      'reel_stop',
      'no_win',
      'win_small',
      'win_normal',
      'win_big',
      'win_mega',
      'jackpot',
      'bonus_trigger',
      'bonus_sweat',
      'bonus_reveal',
      'freespin_start',
      'freespin_loop',
      'freespin_end',
      'retrigger',
      'premium_win',
      'gamble_start',
      'gamble_win',
      'gamble_lose',
    ]) {
      expect(slots).toContain(noetig);
    }
  });

  it('weist einen unbekannten Slot ab', () => {
    expect(level.xpslot.istKlangSlot('jackpot')).toBe(true);
    expect(level.xpslot.istKlangSlot('erfunden')).toBe(false);
  });

  it('kennt die Schleifen getrennt von den Effekten', () => {
    expect(level.xpslot.MUSIK_SLOTS).toContain('musik');
    expect(level.xpslot.MUSIK_SLOTS).toContain('freespin_loop');
    expect(level.xpslot.MUSIK_SLOTS).not.toContain('reel_stop');
  });
});

describe('Quick Spin', () => {
  it('verkürzt nur die Inszenierung', () => {
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('schnellGrund');
    expect(quelle).toContain('schnellStaffel');
    // Quick Spin taucht in keiner Anfrage auf - der Server erfaehrt davon nichts.
    expect(quelle).not.toMatch(/spinAction\(\{[^}]*schnell/u);
  });

  it('merkt sich die Einstellung im Browser', () => {
    const quelle = lies(SPIEL);
    expect(quelle).toContain('SCHNELL_SPEICHER');
    expect(quelle).toContain('localStorage');
  });
});

describe('Bewegung und Mobil', () => {
  it('berücksichtigt prefers-reduced-motion im Stil und im Verhalten', () => {
    expect(lies(CSS)).toContain('@media (prefers-reduced-motion: reduce)');
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).toContain('useWenigerBewegung()');
    expect(quelle).toContain('!wenigerBewegung');
  });

  it('schaltet bei weniger Bewegung Partikel und Zittern ab, nicht das Spiel', () => {
    const css = lies(CSS);
    const abschnitt = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(abschnitt).toContain('.slot-partikel');
    expect(abschnitt).toContain('animation: none');
    // Die Walzen laufen weiter - nur kuerzer.
    expect(abschnitt).toContain('animation-duration');
  });

  it('reduziert mobil die Inszenierung und behält das Spielfeld', () => {
    const css = lies(CSS);
    expect(css).toContain('@media (max-width: 640px)');
    const abschnitt = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(abschnitt).toContain('.slot-partikel');
    // Kein Eingriff in die Rasterform: fuenf Walzen bleiben fuenf Walzen.
    expect(abschnitt).not.toContain('grid-template-columns');
  });

  it('animiert nur transform und opacity', () => {
    const css = ohneKommentare(lies(CSS));
    const keyframes = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/gu)];
    expect(keyframes.length).toBeGreaterThan(5);
    for (const block of keyframes) {
      const inhalt = block[1] ?? '';
      for (const teuer of ['top:', 'left:', 'width:', 'height:', 'margin:']) {
        expect(inhalt).not.toContain(teuer);
      }
    }
  });
});

describe('Die Infotafel', () => {
  it('nennt alles, was über einen Gewinn entscheidet', () => {
    const quelle = lies('apps/web/src/modules/level/xpslot/components/infotafel.tsx');
    for (const noetig of [
      'Gewinnlinien',
      'Wild',
      'Bonus',
      'Risikoleiter',
      'Freispiele',
      'Jackpot',
      'Höchstgewinn',
      'Auszahlungsquote',
      'Einsätze',
    ]) {
      expect(quelle).toContain(noetig);
    }
  });

  it('nimmt die Zahlen aus der Konfiguration und nicht aus einem Text', () => {
    const quelle = ohneKommentare(lies('apps/web/src/modules/level/xpslot/components/infotafel.tsx'));
    expect(quelle).toContain('ansicht.jackpotMultiplikator');
    expect(quelle).toContain('ansicht.rtp');
    expect(quelle).toContain('ansicht.bonusAusloeser');
    expect(quelle).toContain('ansicht.leiter');
  });

  it('gibt einen zurückhaltenden Hinweis zum bewussten Spielen', () => {
    const quelle = lies('apps/web/src/modules/level/xpslot/components/infotafel.tsx');
    expect(quelle).toContain('Spiele bewusst mit deinen XP');
  });
});

describe('Die Ansicht verrät keine Gewichte', () => {
  it('schickt kein Symbolgewicht in den Browser', () => {
    const quelle = ohneKommentare(lies('packages/modules/src/level/xpslot/ansicht.ts'));
    // In der Symbolansicht kommt `gewicht` nicht vor - nur beim Filtern, ob
    // ein Symbol ueberhaupt auf den Walzen liegt.
    const abschnitt = quelle.slice(quelle.indexOf('const symbole: SymbolAnsicht[]'));
    const zeilen = abschnitt.split('\n').filter((zeile) => zeile.includes('gewicht'));
    expect(zeilen.every((zeile) => zeile.includes('?? 0) > 0'))).toBe(true);
  });

  it('nennt dafür Quote, Einsätze, Höchstgewinn und Grenzen', () => {
    const quelle = lies('packages/modules/src/level/xpslot/ansicht.ts');
    expect(quelle).toContain('rtp: rtp.rtp');
    expect(quelle).toContain('maxGewinnMultiplikator');
    expect(quelle).toContain('maxTagesverlust');
  });
});

describe('Kein Math.random in der Spiellogik', () => {
  it('zieht ausschliesslich über die zentrale Zufallsquelle', () => {
    for (const datei of [
      'packages/modules/src/level/xpslot/regeln.ts',
      'packages/modules/src/level/xpslot/spin.ts',
      'packages/modules/src/level/xpslot/bonus.ts',
      'packages/modules/src/level/xpslot/testlauf.ts',
      'packages/modules/src/level/xpslot/auswertung.ts',
    ]) {
      expect(ohneKommentare(lies(datei))).not.toContain('Math.random');
    }
  });

  it('nutzt im Betrieb die kryptographisch sichere Quelle', () => {
    const quelle = ohneKommentare(lies('packages/modules/src/level/xpslot/spin.ts'));
    expect(quelle).toContain('eingabe.random ?? secureRandom');
  });
});

describe('Zahlen und Zeiten laufzeitunabhängig', () => {
  /*
   * Diese Pruefung ist aus einem echten Fehler entstanden.
   *
   * Der Browser-Smoke meldete vier Mal React #418 - einen
   * Hydration-Fehler. Ursache war `toLocaleString('de-CH')` in der
   * Spieloberflaeche: Node und der Browser bringen unterschiedliche
   * ICU-Fassungen mit und setzen mal den geraden Apostroph, mal den
   * typografischen. Derselbe Wert faellt dann serverseitig anders aus als im
   * Browser, und React verwirft die serverseitige Fassung. Genau dafuer gibt
   * es `formatSwissNumber` in `packages/shared/src/format.ts`. Der Fehler
   * war unsichtbar - kein Test und kein Typecheck greift ihn, nur die
   * Browserkonsole -, darum steht er jetzt hier.
   */
  const OBERFLAECHE = [
    SPIEL,
    WALZEN,
    'apps/web/src/modules/level/xpslot/components/infotafel.tsx',
    'apps/web/src/modules/level/xpslot/components/leiter.tsx',
    'apps/web/src/modules/level/xpslot/components/verwaltung.tsx',
  ];

  it('formatiert keine Zahl über die Laufzeit-Locale', () => {
    for (const datei of OBERFLAECHE) {
      expect(ohneKommentare(lies(datei))).not.toContain('toLocaleString');
    }
  });

  it('formatiert auch kein Datum über die Laufzeit-Locale', () => {
    for (const datei of OBERFLAECHE) {
      const quelle = ohneKommentare(lies(datei));
      expect(quelle).not.toContain('toLocaleDateString');
      expect(quelle).not.toContain('toLocaleTimeString');
    }
  });

  it('nimmt dafür die gemeinsamen Helfer und baut keine eigenen', () => {
    expect(lies(SPIEL)).toContain("import { formatSwissNumber } from '@swisshub/shared'");
    const verwaltung = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    expect(verwaltung).toContain("from '@swisshub/shared'");
    // Der Zeitstempel kommt aus dem Level-Modul, das ihn schon
    // laufzeitunabhaengig zusammensetzt - kein zweiter Formatierer.
    expect(verwaltung).toContain('formatDateTime(eintrag.zeit)');
  });
});
