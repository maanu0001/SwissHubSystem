import { existsSync, readFileSync } from 'node:fs';
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
/*
 * Der reine Walzenbaum - seit dem Schnitt eine eigene Datei.
 *
 * `walzen.tsx` fasst den Browser an (`window`, `ResizeObserver`,
 * `getBoundingClientRect`), `walzenbild.tsx` nicht. Erst dadurch laesst sich
 * der Walzenaufbau im Test wirklich **rendern** statt lesen - siehe
 * `xpslot-walzenaufbau.test.ts`. Die Zusagen hier sind unveraendert; sie
 * stehen nur in der Datei, in der der Code jetzt liegt.
 */
const WALZENBILD = 'apps/web/src/modules/level/xpslot/components/walzenbild.tsx';
/** Beide Haelften zusammen - die Zusagen laufen ueber Messung **und** Baum. */
const WALZEN_GANZ = [WALZEN, WALZENBILD];
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
    /*
     * Zwei Argumente, seit die Verwaltung im Wartungsmodus weiterspielen
     * darf: die Konfiguration und das Verwaltungsrecht. Darum nicht mehr
     * `istSpielbar(konfiguration)` als ganzer Aufruf - der Prettier-Umbruch
     * setzt die Argumente auf eigene Zeilen.
     */
    expect(quelle).toContain('istSpielbar(');
    expect(quelle).toContain('actor.can(level.LEVEL_PERMISSIONS.xpslotManage)');
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

  it('zeigt ausschliesslich das eingestellte Embed - und keine Spielzahlen', () => {
    /*
     * Hier stand das Gegenteil: der Befehl haengte Einsaetze, Jackpot,
     * Bonusausloeser und die theoretische Quote als Felder unter das Embed.
     * Genau das soll er nicht mehr. Die Quelle der Wahrheit ist das, was im
     * XP-Slot-Dashboard eingestellt wurde - Titel, Beschreibung, Farbe,
     * Bild, Fusszeile, Knopftext und Link.
     *
     * Der Test prueft weiter an der Quelle, aber mit umgekehrtem Vorzeichen:
     * dass diese Werte nirgends mehr in die Antwort geraten.
     */
    const quelle = ohneKommentare(lies(BEFEHL));
    for (const verboten of [
      'fields:',
      'einsaetze',
      'jackpotMultiplikator',
      'bonusAusloeser',
      'rtp',
      'slotAnsicht',
    ]) {
      expect(quelle, verboten).not.toContain(verboten);
    }

    // Und dass das Eingestellte wirklich alles traegt, was das Embed zeigt.
    for (const feld of ['embed.titel', 'embed.beschreibung', 'embed.farbe', 'embed.fusszeile']) {
      expect(quelle, feld).toContain(feld);
    }
    expect(quelle).toContain('label: embed.knopf');
    expect(quelle).toContain('url: embed.adresse');
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
    const quelle = WALZEN_GANZ.map((pfad) => ohneKommentare(lies(pfad))).join('\n');
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
    /*
     * Geprueft wird die Bedingung, nicht die Schreibweise: der Waehler ist
     * inzwischen ein Schrittknopf statt einer Reihe, und beide Knoepfe tragen
     * zusaetzlich ihre eigene Grenze (Anfang und Ende der Liste). Fest bleibt,
     * dass `festerEinsatz !== null` jeden der beiden sperrt - sonst koennte
     * jemand den Einsatz eines laufenden Freispiels aendern.
     */
    const quelle = lies(SPIEL);
    const schritte = [...quelle.matchAll(/slot-einsatz__schritt[\s\S]{0,400}?disabled=\{([^}]+)\}/gu)];
    expect(schritte).toHaveLength(2);
    for (const schritt of schritte) {
      expect(schritt[1]).toContain('beschaeftigt');
      expect(schritt[1]).toContain('festerEinsatz !== null');
    }
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
    // Quick Spin taucht in keiner Anfrage auf - der Server erfaehrt davon nichts.
    expect(quelle).not.toMatch(/spinAction\(\{[^}]*schnell/u);
  });

  it('hält bei Quick Spin alle fünf Walzen zusammen an', () => {
    /*
     * Hier stand `schnellStaffel`: eine verkuerzte Staffelzeit, mit der die
     * Walzen bei Quick Spin immer noch nacheinander hielten - nur schneller.
     * Gefordert ist etwas anderes: sie halten gemeinsam. Darum gibt es die
     * Staffelzeit fuer Quick Spin nicht mehr, sondern einen Aufruf, der alle
     * fuenf auf einmal stellt.
     */
    const quelle = ohneKommentare(lies(SPIEL));
    expect(quelle).not.toContain('schnellStaffel');
    expect(quelle).toContain('haltAlles()');

    /*
     * Die eine Ausnahme bleibt der Bonus Sweat: steht der Bonus noch offen,
     * darf die entscheidende Walze laenger laufen - auch im Quick Spin.
     *
     * Und zwar **nur** sie: `haltBis(sweatAb)` haelt die Walzen davor und
     * laesst den Rest drehen. Hier stand einmal `haltAlle(0)`, was alle fuenf
     * anhielt - danach lief der Sweat-Klang ueber ein stehendes Bild, und der
     * Moment, auf den es ankommt, war keiner mehr.
     */
    expect(quelle).toContain('schnellSweat');
    expect(quelle).toContain('sweatAb');
    expect(quelle).toContain('haltBis(sweatAb)');
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
    /*
     * Kein Eingriff in die Rasterform des Spielfelds: fuenf Walzen bleiben
     * fuenf Walzen, mobil wird nur die Zelle kleiner. Geprueft wird jetzt
     * genau das Raster der Walzen - das HUD darf mobil durchaus von vier auf
     * zwei Spalten gehen, und eine Pruefung auf «irgendwo steht
     * grid-template-columns» hielte das faelschlich fuer einen Verstoss.
     */
    const walzenMobil = abschnitt.slice(
      abschnitt.indexOf('.slot-walzen {'),
      abschnitt.indexOf('}', abschnitt.indexOf('.slot-walzen {')),
    );
    expect(walzenMobil).toContain('--slot-zelle:');
    expect(walzenMobil).not.toContain('grid-template-columns');
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

describe('Standard-Assets', () => {
  /*
   * Die Rueckfall-Logik ist der Kern dieser Anforderung: ohne hochgeladenes
   * Asset soll der Slot trotzdem vollstaendig aussehen. Geprueft wird beides -
   * die Entscheidung (welche Adresse kommt heraus) und die Datei dahinter.
   * Eine Entscheidung, die auf eine fehlende Datei zeigt, waere ein kaputtes
   * Bild statt eines Platzhalters, und genau das war die Vorgabe nicht.
   */
  const SYMBOL_KEYS = ['eins', 'drei', 'fuenf', 'zehn', 'logo', 'wild', 'bonus', 'premium'];

  const adressen = lies('apps/web/src/modules/level/xpslot/adressen.ts');

  it('liefert für jedes der acht Symbole ein mitgeliefertes Bild', () => {
    for (const key of SYMBOL_KEYS) {
      expect(adressen).toContain(`${key}: '/xp-slot/symbole/${key}.svg'`);
      expect(existsSync(`apps/web/public/xp-slot/symbole/${key}.svg`)).toBe(true);
    }
  });

  it('liefert für jeden Klangslot der Vorgabe eine mitgelieferte Datei', () => {
    /*
     * Die beiden Musikslots sind bewusst ausgenommen: eine Hintergrundschleife
     * ist Geschmack, und als mitgelieferte Datei waere sie groesser als alle
     * Effekte zusammen. Alle uebrigen Slots muessen einen Standard haben.
     */
    const ohneMusik = level.xpslot.KLANG_SLOTS.filter((slot) => !level.xpslot.MUSIK_SLOTS.includes(slot.key));
    for (const slot of ohneMusik) {
      expect(adressen).toContain(`${slot.key}: '/xp-slot/klaenge/${slot.key}.wav'`);
      expect(existsSync(`apps/web/public/xp-slot/klaenge/${slot.key}.wav`)).toBe(true);
    }
    expect(ohneMusik.length).toBeGreaterThanOrEqual(17);
  });

  it('liefert die mitgelieferten Dateien lokal aus - kein fremder Host', () => {
    for (const treffer of adressen.matchAll(/'(\/xp-slot\/[^']+)'/gu)) {
      expect(treffer[1]!.startsWith('/xp-slot/')).toBe(true);
    }
    expect(adressen).not.toContain('http://');
    expect(adressen).not.toContain('https://');
  });

  it('zieht das eigene Bild dem Standard vor und fällt danach zurück', () => {
    // Die Reihenfolge im Quelltext ist die Entscheidung: erst `quelle`
    // (hochgeladen oder fremde Adresse), dann das mitgelieferte.
    expect(adressen).toContain(
      'return quelle(symbol.bildPfad, symbol.bildUrl) ?? STANDARD_SYMBOLE[symbol.key] ?? null;',
    );
    expect(adressen).toContain('if (dateiname) {\n    return dateiAdresse(dateiname);\n  }');
  });

  it('kopiert kein Standardasset in den Upload-Bereich', () => {
    /*
     * Zuruecksetzen heisst, die Referenz zu loeschen - nicht, eine Datei
     * zurueckzukopieren. Darum darf die Verwaltung beim Zuruecksetzen nur
     * `null` schicken.
     */
    const verwaltung = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    expect(verwaltung).toContain('bildPfad: null,\n                        bildUrl: null,');
    expect(verwaltung).toContain('Auf Standard zurücksetzen');
  });

  it('zeigt in der Verwaltung, ob ein Asset eigen oder Standard ist', () => {
    const verwaltung = lies('apps/web/src/modules/level/xpslot/components/verwaltung.tsx');
    expect(verwaltung).toContain("{eigenes ? 'Eigenes' : 'Standard'}");
    expect(verwaltung).toContain("{klang.dateiname ? 'Eigener' : standard ? 'Standard' : 'Leer'}");
  });

  it('spielt im Browser den Standard, wenn kein eigener Klang eingerichtet ist', () => {
    const klang = ohneKommentare(lies('apps/web/src/modules/level/xpslot/components/klang.ts'));
    // Erst die Standards in die Karte, dann die der Verwaltung darueber.
    const standardZuerst = klang.indexOf('Object.keys(STANDARD_KLAENGE)');
    const custom = klang.indexOf('for (const eintrag of klaenge)');
    expect(standardZuerst).toBeGreaterThan(0);
    expect(custom).toBeGreaterThan(standardZuerst);
  });
});

describe('Feste Walzengeometrie', () => {
  /*
   * Der Fehler, den diese Pruefungen festhalten: die Walze war inhaltshoch.
   * Gestoppt drei Zellen, laufend sechs - und damit verdoppelte sie beim Spin
   * ihre Hoehe. Ein Test am Quelltext kann das nicht messen, aber er kann die
   * drei Eigenschaften festhalten, ohne die es wieder passieren wuerde. Die
   * Messung selbst macht der Browser-Smoke.
   */
  const css = lies(CSS);

  it('gibt der Walze eine feste Breite und eine Höhe aus genau drei Zellen', () => {
    expect(css).toContain('width: var(--slot-zelle);');
    expect(css).toContain('height: calc(var(--slot-zelle) * 3);');
  });

  it('legt beide Bänder absolut in das Walzenfenster', () => {
    const block = css.slice(css.indexOf('.slot-stand,'), css.indexOf('.slot-zelle {'));
    expect(block).toContain('position: absolute;');
    expect(block).toContain('grid-auto-rows: var(--slot-zelle);');
  });

  it('gibt der Zelle keine inhaltsabhängige Höhe mehr', () => {
    // `aspect-ratio` an der Zelle war die Ursache: sie machte die Hoehe der
    // Walze zu einer Funktion der Zellenzahl.
    const zelle = css.slice(css.indexOf('.slot-zelle {'), css.indexOf('.slot-zelle__bild'));
    expect(zelle).not.toContain('aspect-ratio');
    expect(zelle).toContain('height: var(--slot-zelle);');
  });

  it('bewegt beim Stopp das Band und nicht die Walze', () => {
    expect(css).toContain('.slot-walze--stopp .slot-stand {');
    expect(css).not.toMatch(/\.slot-walze--stopp\s*\{\s*animation/u);
  });

  it('skaliert die Maschine nicht, sondern rechnet in echten Längen', () => {
    // `transform: scale` auf dem ganzen Spielfeld waere unscharfer Text und
    // verschobene Klickflaechen - ausdruecklich nicht gewollt.
    const walzenBlock = css.slice(css.indexOf('.slot-walzen {'), css.indexOf('.slot-walze {'));
    expect(walzenBlock).toContain('clamp(');
    expect(walzenBlock).not.toContain('scale(');
  });

  it('bindet die Zellgröße an die Breite des Spielfelds und an die Fensterhöhe', () => {
    /*
     * Beides, und in dieser Reihenfolge.
     *
     * Vorher stand hier `clamp(42px, min(7.4vw, 9.4vh), 96px)` - also die
     * Breite des **Fensters**. Auf dem iPad ergab das Zellen von knapp 60
     * Pixeln in einem Panel von siebenhundert, und der Slot sah schmal aus.
     * Jetzt kommt die Breite aus dem Kasten selbst (`cqw` gegen das
     * Spielfeld) und die Hoehe weiter aus dem Fenster, damit das Feld auf
     * einem 768er-Laptop neben die Steuerung passt. Der Weg fuehrt ueber
     * zwei eigene Variablen, deshalb wird hier auf beide geprueft.
     */
    expect(css).toMatch(/--slot-zelle:\s*clamp\(\s*\d+px,\s*min\(var\(--slot-breit\), var\(--slot-hoch\)\)/u);
    expect(css).toMatch(/--slot-breit:\s*calc\(\(100cqw/u);
    expect(css).toMatch(/--slot-hoch:\s*calc\(\(100vh/u);
    // Und der Kasten, gegen den `cqw` rechnet, muss es auch wirklich sein.
    expect(css).toContain('container-type: inline-size');
  });
});

/**
 * Die Nachricht von `/xp-slot` ist einstellbar.
 *
 * Geprueft wird hier das Strukturelle: dass der Befehl keine eigene Kopie des
 * Textes mehr hat, dass die Vorschau in der Verwaltung dieselbe
 * Rueckfallregel rechnet wie der Bot, und dass die Adresse des Knopfs
 * nirgends eintippbar ist. Die Wirkung selbst - welcher Text am Ende
 * herauskommt - steht in `tests/integration/xpslot-befehl-embed.test.ts`.
 */
describe('/xp-slot Nachricht einstellbar', () => {
  const VERWALTUNG = 'apps/web/src/modules/level/xpslot/components/verwaltung.tsx';

  it('liest den Text bei jedem Aufruf aus der Einstellung', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).toContain('level.xpslot.befehlsEmbed()');
    // Kein Zwischenspeicher im Modul des Befehls: wer den Text aendert, soll
    // ihn beim naechsten Aufruf sehen und keinen Neustart brauchen.
    expect(quelle).not.toMatch(/const\s+\w*[Cc]ache\w*\s*=/u);
  });

  it('nimmt die Felder aus dem Embed und nicht aus festem Text', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    for (const feld of ['embed.titel', 'embed.beschreibung', 'embed.farbe', 'embed.knopf', 'embed.adresse']) {
      expect(quelle).toContain(feld);
    }
    // Die alte feste Farbe ist weg - sonst waere die Einstellung eine
    // Einstellung, die nichts tut.
    expect(quelle).not.toMatch(/const FARBE\s*=/u);
  });

  it('faellt beim Lesefehler auf die Vorgaben zurueck', () => {
    const quelle = ohneKommentare(lies(BEFEHL));
    expect(quelle).toContain('.catch(() => null)');
    expect(quelle).toContain('BEFEHL_VORGABEN');
  });

  it('hat Vorgaben für jedes gestaltbare Feld', () => {
    const V = level.xpslot.BEFEHL_VORGABEN;
    for (const wert of [V.titel, V.beschreibung, V.farbe, V.knopf, V.fusszeile]) {
      expect(typeof wert).toBe('string');
      expect(wert.trim()).not.toBe('');
    }
    expect(V.farbe).toMatch(/^#[0-9a-f]{6}$/iu);
  });

  it('macht die Adresse des Knopfs nicht einstellbar', () => {
    const schema = lies('packages/database/prisma/schema.prisma');
    const block = schema.slice(schema.indexOf('model XpSlotConfig {'));
    const ende = block.indexOf('\n}');
    // Kein `commandUrl`, kein `commandLink`: die Adresse kommt aus `appUrl`.
    expect(block.slice(0, ende)).not.toMatch(/command(Url|Link)/u);
    expect(Object.keys(level.xpslot.befehlSchema.shape)).not.toContain('adresse');
  });

  it('zeigt eine Vorschau mit derselben Rückfallregel wie der Bot', () => {
    const quelle = lies(VERWALTUNG);
    const kasten = quelle.slice(quelle.indexOf('function BefehlsKasten('));
    expect(kasten).toContain('Vorschau');
    // Dieselbe Regel wie in `befehlsEmbed`: leeres Feld heisst Vorgabe, und
    // zwar je Feld einzeln.
    expect(kasten).toContain('werte.titel.trim() || VORGABEN.titel');
    expect(kasten).toContain('werte.beschreibung.trim() || VORGABEN.beschreibung');
    expect(kasten).toContain('werte.knopf.trim() || VORGABEN.knopf');
    // Und eine kaputte Farbe ergibt auch in der Vorschau die Vorgabe.
    expect(kasten).toMatch(/\/\^#\[0-9a-f\]\{6\}\$\/iu\.test/u);
  });

  it('nennt in der Verwaltung den Ort der Befehlsrechte statt eigener', () => {
    const quelle = lies(VERWALTUNG);
    const kasten = quelle.slice(quelle.indexOf('function BefehlsKasten('));
    expect(kasten).toContain('Befehlsverwaltung');
    // Keine zweite Rollenverwaltung in diesem Kasten.
    expect(kasten).not.toMatch(/roleId|rollen/iu);
  });

  it('speichert über eine Action mit der Verwaltungsberechtigung', () => {
    const quelle = lies(ACTIONS);
    const stelle = quelle.indexOf("name: 'level.xpslot.befehl'");
    expect(stelle).toBeGreaterThan(-1);
    const block = quelle.slice(stelle, stelle + 400);
    expect(block).toContain('permission: P.xpslotManage');
    expect(block).toContain("freshness: 'critical'");
  });
});

describe('Der Sprung - der zweite Klick auf Spin', () => {
  const quelle = ohneKommentare(lies(SPIEL));

  it('löst niemals einen zweiten Spin aus', () => {
    /*
     * Die wichtigste Zusage dieses Knopfes, und die einzige, deren Verletzung
     * echtes Geld kostet: ein zweiter Klick waehrend der Drehung darf keinen
     * Einsatz buchen. Darum gibt es im ganzen Spiel genau **einen** Aufruf
     * der Spin-Action, und der Sprung fasst ihn nicht an - er zieht einen
     * Zeitgeber vorzeitig ab und sonst nichts.
     */
    expect([...quelle.matchAll(/await spinAction\(/gu)]).toHaveLength(1);

    const anfang = quelle.indexOf('const ueberspringen = useCallback');
    expect(anfang).toBeGreaterThan(-1);
    const block = quelle.slice(anfang, quelle.indexOf('}, []);', anfang));
    expect(block).toContain('uebersprungenRef.current = true');
    expect(block).toContain('sprungRef.current?.()');
    expect(block).not.toContain('spinAction');
    expect(block).not.toContain('dreheEinmal');
    expect(block).not.toContain('setSpieler');
  });

  it('springt nur, solange wirklich etwas läuft', () => {
    // Ohne diesen Riegel wuerde ein Klick nach dem Spin die naechste
    // Inszenierung ueberspringen, bevor sie begonnen hat.
    expect(quelle).toContain('if (!laeuftRef.current || uebersprungenRef.current)');
    expect(quelle).toContain('const springbar = laufend.some(Boolean)');
  });

  it('beschriftet den Knopf nach dem, was er tut', () => {
    // «Spin» auf einem Knopf, der abbricht, waere eine Luege - und jemand
    // wuerde darauf klicken, um einen zweiten Spin zu bekommen.
    expect(quelle).toContain("springbar ? 'Stop' : imFreispiel ? 'Freispiel' : 'Spin'");
    expect(quelle).toContain('disabled={(beschaeftigt && !springbar)');
  });

  it('gibt den Sprung nach den Walzen wieder frei', () => {
    /*
     * Was er abkuerzen sollte, ist dann vorbei. Die Gewinnlinien danach
     * laufen normal - sie sind nicht das Warten, das jemand ueberspringen
     * wollte, sondern das, worauf er gewartet hat.
     */
    const stopps = quelle.indexOf("melde({ art: 'reelsFinished' })");
    const frei = quelle.indexOf('uebersprungenRef.current = false', stopps);
    const linien = quelle.indexOf("melde({ art: 'winLineShown'");
    expect(stopps).toBeGreaterThan(-1);
    expect(frei).toBeGreaterThan(stopps);
    expect(linien).toBeGreaterThan(frei);
  });

  it('hält jede Walze einzeln an und meldet jeden Stopp', () => {
    expect(quelle).toContain("melde({ art: 'reelStopped', walze })");
    expect(quelle).toContain("melde({ art: 'spinSkipped', walzen: ansicht.walzen })");
    // Beim Sprung mitten in der Staffel nur die, die noch liefen.
    expect(quelle).toContain("melde({ art: 'spinSkipped', walzen: ansicht.walzen - walze })");
  });
});

describe('Die XP je Gewinnlinie', () => {
  const spiel = ohneKommentare(lies(SPIEL));
  const walzen = WALZEN_GANZ.map((pfad) => ohneKommentare(lies(pfad))).join('\n');

  it('gibt der gezeigten Linie ihren eigenen Wert mit', () => {
    expect(spiel).toContain('linienGewinn={linienGewinn}');
    expect(spiel).toContain('linienDauerMs={ZEITEN.linie}');
    // Der Wert kommt aus dem Treffer und nicht aus der Gesamtsumme.
    expect(spiel).toContain('.find((treffer) => treffer.linie === sichtbareLinie)?.gewinn');
  });

  it('setzt das Schild aus der gemessenen Geometrie an die Linie', () => {
    expect(walzen).toContain('function LinienSchild');
    // Dieselben Punkte wie der Pfad - sonst stuende es daneben.
    expect(walzen).toContain('zellen.map((index) => mitten[index])');
    expect(walzen).toContain('slot-linien-schild');
    // Und es weicht nach unten aus, wenn oben kein Platz ist.
    expect(walzen).toContain('nachUnten');
  });

  it('lässt das Schild wieder verschwinden', () => {
    // «Nicht permanent»: die Dauer kommt vom Element, damit sie dieselbe ist
    // wie die Zeit, die eine Linie steht.
    expect(walzen).toContain('animationDuration: `${dauerMs}ms`');
    const css = lies(CSS);
    expect(css).toContain('@keyframes slot-schild-auf');
    expect(css).toContain('@keyframes slot-schild-ab');
  });

  it('spielt je Linie einen Klang und keinen für die Summe', () => {
    const einzeln = spiel.indexOf('const einzelneLinien =');
    expect(einzeln).toBeGreaterThan(-1);
    expect(spiel).toContain("} else if (!einzelneLinien) {\n      melde({ art: 'spinResult'");
    expect(spiel).toContain("melde({ art: 'winLineShown', stufe: treffer.stufe })");
  });

  it('nimmt die Stufe je Linie vom Server und rechnet sie nicht selbst', () => {
    /*
     * Die Schwellen fuer «gross» und «mega» gehoeren zur Konfiguration. Sie
     * im Browser noch einmal auszurechnen waere dieselbe Frage an zwei
     * Stellen - und die gehen irgendwann auseinander.
     */
    expect(spiel).toContain('treffer.stufe');
    expect(spiel).not.toContain('gewinnstufe(');
    const spin = ohneKommentare(lies('packages/modules/src/level/xpslot/spin.ts'));
    expect(spin).toContain('function trefferMitStufe');
  });
});

describe('Die grossen Meldungen', () => {
  const spiel = ohneKommentare(lies(SPIEL));
  const meldung = ohneKommentare(lies('apps/web/src/modules/level/xpslot/components/meldung.tsx'));

  it('zeigt Geschenk, Abschluss und Radausgang über dieselbe Komponente', () => {
    // Fuenf Momente, eine Form: sonst hat dasselbe Spiel fuenf Handschriften.
    expect(meldung).toContain('export function SlotOverlay');
    expect([...spiel.matchAll(/<SlotOverlay/gu)].length).toBe(5);
  });

  it('vermerkt jede Meldung serverseitig als gesehen', () => {
    /*
     * Nicht im `localStorage`: ein geschenktes Bonusspiel soll einmal
     * angekuendigt werden - einmal insgesamt und nicht einmal je Browser.
     */
    expect(spiel).toContain('meldungGesehenAction({ csrfToken, art, id })');
    expect(spiel).not.toMatch(/localStorage[^\n]*meldung/iu);
    for (const art of ['freispiel-intro', 'freispiel-ende', 'bonus-intro', 'bonus-ende']) {
      expect(spiel, art).toContain(`'${art}'`);
    }
  });

  it('startet aus der Bonusankündigung die gewöhnliche Bonusrunde', () => {
    expect(spiel).toContain('bonusGeschenkStartenAction({ csrfToken, grantId })');
    expect(spiel).toContain('knopf="Bonus starten"');
  });

  it('nimmt die Abschlusszahlen aus der Antwort und summiert nichts selbst', () => {
    expect(spiel).toContain('if (spin.bonusEnde) {');
    expect(spiel).toContain('bonusEnde: spin.bonusEnde');
    expect(spiel).toContain('meldungen.bonusEnde.gewinn');
    // Keine eigene Rundensumme im Browser.
    expect(spiel).not.toMatch(/bonusSumme|rundenGewinn\s*\+=/u);
  });

  it('zeigt höchstens eine Meldung gleichzeitig', () => {
    // Eine Kette aus `? :` und keine fuenf unabhaengigen Bedingungen: zwei
    // Overlays uebereinander sind keine Feier.
    expect(spiel).toContain('{radAusgang ? (');
    expect(spiel).toContain(') : meldungen.bonusEnde ? (');
    expect(spiel).toContain(') : meldungen.freispielEnde ? (');
    expect(spiel).toContain(') : meldungen.bonusIntro ? (');
    expect(spiel).toContain(') : meldungen.freispielIntro ? (');
  });

  it('ist kein Browser-Alert', () => {
    const css = lies(CSS);
    expect(css).toContain('.slot-meldung__karte');
    expect(css).toContain('@keyframes slot-meldung-auf');
    expect(css).toContain('@keyframes slot-meldung-zahl');
    // Verdunkelter Hintergrund, Glanz, Hochzaehlen, ein Knopf.
    expect(css).toContain('.slot-meldung__schleier');
    expect(meldung).toContain('<Hochzaehlen');
    expect(meldung).toContain('slot-meldung__knopf');
    // Und mit der Tastatur bedienbar.
    expect(meldung).toContain("ereignis.key === 'Escape'");
  });

  it('feiert einen Verlust nicht', () => {
    expect(meldung).toContain("stimmung !== 'verlust' && !ruhig ? <Partikel");
    const css = lies(CSS);
    expect(css).toContain('.slot-meldung__karte--verlust');
  });
});
