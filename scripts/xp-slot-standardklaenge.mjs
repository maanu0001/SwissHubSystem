/**
 * Erzeugt die mitgelieferten Klaenge des XP-Slots.
 *
 * ## Warum synthetisch und nicht eingekauft
 *
 * Weil fremde Spielassets eine Lizenzfrage sind, die niemand mehr beantworten
 * kann, sobald die Datei einmal im Repository liegt. Hier entsteht jeder Ton
 * aus Sinus, Rauschen und Huellkurven - ein vollstaendiger Satz, der dem
 * Projekt gehoert und den jeder nachrechnen kann.
 *
 * ## Was diesen Satz vom ersten unterscheidet
 *
 * Der erste Satz war eine Reihe nackter Dreiecksschwingungen: richtig, aber
 * duenn - er klang nach Tongenerator und nicht nach Automat. Drei Dinge sind
 * dazugekommen, und sie machen den ganzen Unterschied:
 *
 *  1. **Mehrere Teiltoene je Ton**, leicht verstimmt, mit eigenen
 *     Huellkurven. Ein Ton aus fuenf Teiltoenen klingt wie ein Instrument;
 *     einer aus einem klingt wie ein Piepser.
 *  2. **Ein Nachhall** (`raum`) - eine kurze Kette von Wiederholungen mit
 *     abnehmender Lautstaerke. Er stellt den Ton in einen Raum, statt ihn
 *     trocken abzuschneiden.
 *  3. **Weiche Saettigung** (`saettige`) statt harten Abschneidens. Eine
 *     Spitze, die ueber eins hinausgeht, wird gebogen und nicht gekappt;
 *     gekappt knackt sie.
 *
 * Dazu kommen die beiden Musikschleifen, die vorher fehlten - und gefehlt
 * haben sie hoerbar: ein Automat ohne Grundton klingt wie ein Prototyp.
 *
 * ## Warum WAV und nicht MP3
 *
 * Weil ein Encoder eine Abhaengigkeit waere. 22 050 Hz in Mono genuegen fuer
 * Spieltoene vollauf; der ganze Satz bleibt kleiner als zwei Pressefotos.
 * Jeder Browser spielt WAV ohne Umweg.
 *
 * ## Warum sie leise sind
 *
 * Ein Spielton, der beim ersten Spin erschreckt, wird abgeschaltet und nie
 * wieder eingeschaltet. Die Spitzen liegen bei etwa einem Drittel der
 * Vollaussteuerung, die Musik deutlich darunter; wer es lauter will, hat in
 * der Verwaltung je Slot einen Regler.
 *
 * Aufruf: `node scripts/xp-slot-standardklaenge.mjs`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const ZIEL = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'public',
  'xp-slot',
  'klaenge',
);

/** Ein Ton ist eine Funktion von der Zeit auf einen Wert zwischen -1 und 1. */
function puffer(sekunden, stimme) {
  const n = Math.round(RATE * sekunden);
  const daten = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    daten[i] = stimme(i / RATE, i / n);
  }
  return daten;
}

const TAU = Math.PI * 2;
const sinus = (t, hz, phase = 0) => Math.sin(TAU * hz * t + phase);
/** Dreieck klingt weicher als Rechteck und traegt weiter als Sinus. */
const dreieck = (t, hz) => 2 * Math.abs(2 * (t * hz - Math.floor(t * hz + 0.5))) - 1;
/** Saege: viel Obertonmaterial, gut fuer Baesse unter einem Filter. */
const saege = (t, hz) => 2 * (t * hz - Math.floor(t * hz + 0.5));

/**
 * Rauschen mit festem Startwert.
 *
 * Bewusst kein `Math.random()`: der Satz soll bei jedem Lauf exakt gleich
 * herauskommen, sonst zeigt `git diff` nach jeder Neuerzeugung vierundzwanzig
 * geaenderte Dateien ohne eine einzige geaenderte Entscheidung.
 */
function rauschen(saat) {
  let z = saat >>> 0;
  return () => {
    z = (z * 1_664_525 + 1_013_904_223) >>> 0;
    return (z / 0xffffffff) * 2 - 1;
  };
}

/** Anschlag und Ausklang. Ohne das knackt jeder Ton am Anfang und am Ende. */
const huelle = (p, anstieg = 0.02, abfall = 0.6) => {
  if (p <= 0) {
    return 0;
  }
  if (p < anstieg) {
    return p / anstieg;
  }
  const rest = (p - anstieg) / (1 - anstieg);
  return Math.pow(Math.max(0, 1 - rest), abfall * 6);
};

/**
 * Weiche Saettigung.
 *
 * `tanh` biegt grosse Werte, anstatt sie abzuschneiden. Das ist der
 * Unterschied zwischen «laut» und «verzerrt»: eine gekappte Spitze hat eine
 * Ecke, und eine Ecke hoert man als Knacken.
 */
const saettige = (wert, mass = 1.6) => Math.tanh(wert * mass) / Math.tanh(mass);

/**
 * Ein kurzer Nachhall.
 *
 * Keine Faltung mit einer Impulsantwort - die waere eine Datei, die wir nicht
 * haben. Stattdessen drei bis fuenf verzoegerte Kopien mit abnehmender
 * Lautstaerke. Das genuegt vollauf, um einen Ton in einen Raum zu stellen,
 * und es bleibt nachrechenbar.
 */
function raum(daten, { zeit = 0.085, anteil = 0.3, zahl = 4 } = {}) {
  const schritt = Math.round(RATE * zeit);
  const ergebnis = Float32Array.from(daten);
  for (let k = 1; k <= zahl; k += 1) {
    const pegel = anteil * Math.pow(0.55, k - 1);
    const versatz = schritt * k;
    for (let i = versatz; i < ergebnis.length; i += 1) {
      ergebnis[i] += daten[i - versatz] * pegel;
    }
  }
  return ergebnis;
}

/** Ein einpoliger Tiefpass - nimmt die Schaerfe aus Rauschen und Saege. */
function tiefpass(daten, hz) {
  const alpha = 1 - Math.exp((-TAU * hz) / RATE);
  const ergebnis = new Float32Array(daten.length);
  let wert = 0;
  for (let i = 0; i < daten.length; i += 1) {
    wert += alpha * (daten[i] - wert);
    ergebnis[i] = wert;
  }
  return ergebnis;
}

/** Ein einpoliger Hochpass - nimmt das Wummern aus einem Rauschanteil. */
function hochpass(daten, hz) {
  const tief = tiefpass(daten, hz);
  return daten.map((wert, i) => wert - tief[i]);
}

/**
 * Macht aus einem Puffer eine saubere Schleife.
 *
 * ## Warum das noetig ist
 *
 * Eine Schleife klackt bei jedem Umlauf, wenn der letzte Abtastwert nicht zum
 * ersten passt. Bei den Toenen hier stimmt die Grundperiode zwar - aber jede
 * Rauschlage ist unperiodisch, und schon ein Sprung von drei Prozent ist bei
 * einem leisen Flaechenklang ein hoerbares Ticken im Takt der Schleife.
 *
 * ## Wie
 *
 * Das Ende wird in den Anfang hineingeblendet und abgeschnitten: der neue
 * Anfang traegt damit die Fortsetzung des alten Endes. Die Blende ist kurz -
 * Millisekunden -, weil sie sonst die Musik selbst verformt.
 */
function schliesse(daten, fadeSekunden = 0.02) {
  const f = Math.min(Math.round(RATE * fadeSekunden), Math.floor(daten.length / 4));
  const n = daten.length - f;
  const ergebnis = Float32Array.from(daten.subarray(0, n));
  for (let i = 0; i < f; i += 1) {
    const w = i / f;
    ergebnis[i] = ergebnis[i] * w + daten[n + i] * (1 - w);
  }
  return ergebnis;
}

function mische(...spuren) {
  const laenge = Math.max(...spuren.map((spur) => spur.length));
  const ergebnis = new Float32Array(laenge);
  for (const spur of spuren) {
    for (let i = 0; i < spur.length; i += 1) {
      ergebnis[i] += spur[i];
    }
  }
  return ergebnis;
}

function skaliere(daten, pegel) {
  return daten.map((wert) => wert * pegel);
}

/**
 * Ein gespielter Ton mit Teiltoenen.
 *
 * `teile` sind Vielfache der Grundfrequenz mit Pegel und Verstimmung. Die
 * Verstimmung ist der Grund, weshalb es nach Instrument klingt: zwei exakt
 * gleiche Frequenzen sind ein Ton, zwei um ein Promille verschiedene sind ein
 * Chor.
 */
function ton(hz, dauer, { pegel = 0.25, anstieg = 0.01, abfall = 0.9, teile = null, form = sinus } = {}) {
  const partialen = teile ?? [
    [1, 1, 0],
    [2, 0.42, 1.002],
    [3, 0.2, 0.998],
    [4.01, 0.1, 1],
    [5.98, 0.05, 1.001],
  ];
  return puffer(dauer, (t, p) => {
    let wert = 0;
    for (const [vielfach, anteil, verstimmung] of partialen) {
      wert += form(t, hz * vielfach * verstimmung) * anteil;
    }
    return saettige(wert * huelle(p, anstieg, abfall) * pegel);
  });
}

/** Eine aufsteigende Folge - der Klang von «es wird besser». */
function fanfare(hz_folge, dauer, { pegel = 0.26, glanz = 1, nachhall = {} } = {}) {
  const schritt = dauer / hz_folge.length;
  const spuren = hz_folge.map((hz, index) => {
    const start = Math.round(index * schritt * RATE);
    const stimme = ton(hz, dauer - index * schritt, {
      pegel: pegel * (1 - index * 0.04),
      anstieg: 0.008,
      abfall: 0.75,
      teile: [
        [1, 1, 0],
        [2, 0.5 * glanz, 1.003],
        [3, 0.26 * glanz, 0.997],
        [5, 0.12 * glanz, 1.001],
        [8, 0.05 * glanz, 1],
      ],
    });
    const spur = new Float32Array(Math.round(dauer * RATE));
    for (let i = 0; i < stimme.length && start + i < spur.length; i += 1) {
      spur[start + i] = stimme[i];
    }
    return spur;
  });
  return raum(mische(...spuren), { zeit: 0.07, anteil: 0.26, zahl: 4, ...nachhall });
}

/** Ein Schlag: Rauschen durch einen Filter, sehr kurz. */
function schlag(saat, dauer, { hz = 2200, pegel = 0.3, abfall = 2.2, koerper = 0 } = {}) {
  const r = rauschen(saat);
  const roh = puffer(
    dauer,
    (t, p) =>
      r() * huelle(p, 0.002, abfall) +
      (koerper > 0 ? sinus(t, koerper) * huelle(p, 0.002, abfall * 0.7) * 0.6 : 0),
  );
  return skaliere(hochpass(tiefpass(roh, hz), 180), pegel);
}

const toene = {};

// --- Oberflaeche ---------------------------------------------------------

/*
 * Der Knopf: zwei Teiltoene und ein Hauch Nachhall.
 *
 * Ein Klick ist der haeufigste Ton des Spiels - er muss im Hintergrund
 * bleiben und darf nach dem hundertsten Mal nicht nerven. Deshalb kurz, leise
 * und ohne Tonhoehe, die sich einpraegt.
 */
toene.ui_button = raum(
  mische(
    skaliere(
      ton(1180, 0.05, {
        pegel: 0.13,
        anstieg: 0.004,
        abfall: 2.6,
        teile: [
          [1, 1, 0],
          [2.02, 0.3, 1],
        ],
      }),
      1,
    ),
    schlag(11, 0.03, { hz: 5200, pegel: 0.07, abfall: 3 }),
  ),
  { zeit: 0.03, anteil: 0.18, zahl: 2 },
);

/**
 * Die Hintergrundmusik.
 *
 * ## Warum es sie ueberhaupt gibt
 *
 * Sie fehlte, und das war der auffaelligste Mangel am Klangbild: ohne
 * Grundton steht das Spiel in der Stille, und jeder Effekt kommt aus dem
 * Nichts. Mit einer leisen Schleife darunter wirken dieselben Effekte
 * gewollt.
 *
 * ## Warum sie so unauffaellig ist
 *
 * Weil sie stundenlang laufen kann. Eine Melodie merkt man sich und schaltet
 * sie dann ab; eine Flaeche mit wenigen Toenen und einem ruhigen Puls laeuft
 * im Hintergrund weiter. Moll, der Grundton bleibt liegen, und die Toene
 * darueber sind so gewaehlt, dass der Uebergang vom letzten zum ersten
 * Abtastwert nicht hoerbar ist.
 *
 * ## Warum die Laenge genau so ist
 *
 * `TAKTE * 4 * SCHLAG` ergibt ein ganzes Vielfaches jeder beteiligten
 * Periode. Eine Schleife, deren Ende nicht zum Anfang passt, klackt bei jedem
 * Umlauf - und dieses Klacken hoert man nach zwei Minuten mehr als die Musik.
 */
toene.musik = (() => {
  const SCHLAG = 0.5; // 120 bpm
  const TAKTE = 4;
  const dauer = TAKTE * 4 * SCHLAG; // 8 Sekunden
  const grund = 55; // A1
  // a-Moll-Septime, gebrochen: Grundton, Quinte, Terz, Septime.
  const akkord = [1, 1.5, 1.2, 1.78];
  const r = rauschen(4711);

  const flaeche = puffer(dauer, (t) => {
    let wert = 0;
    for (const [index, faktor] of akkord.entries()) {
      // Die Teiltoene liegen bewusst tief; das obere Ende gehoert den Effekten.
      const hz = grund * faktor * (index === 0 ? 1 : 2);
      const atem = 0.5 + 0.5 * Math.sin((TAU * t) / dauer + index);
      wert += sinus(t, hz) * 0.22 * (0.55 + 0.45 * atem);
      wert += sinus(t, hz * 2.003) * 0.07 * atem;
    }
    return wert;
  });

  // Ein ruhiger Puls auf jeder Zaehlzeit - er haelt das Tempo, ohne zu treiben.
  const puls = puffer(dauer, (t) => {
    const imSchlag = (t % SCHLAG) / SCHLAG;
    const betont = Math.floor(t / SCHLAG) % 4 === 0;
    return saege(t, grund / 2) * huelle(imSchlag, 0.004, 3.4) * (betont ? 0.3 : 0.16);
  });

  // Ein Hauch Luft, damit die Flaeche nicht wie ein Testton klingt.
  const luft = skaliere(
    hochpass(
      puffer(dauer, () => r()),
      2600,
    ),
    0.012,
  );

  const gemischt = mische(skaliere(tiefpass(flaeche, 1400), 0.5), skaliere(tiefpass(puls, 600), 0.5), luft);
  return schliesse(skaliere(gemischt, 0.5), 0.05);
})();

// --- Walzen --------------------------------------------------------------

toene.spin_start = (() => {
  // Ein Aufwaertswisch mit Anschlag: der Hebel, dann das Anlaufen.
  const wisch = puffer(0.3, (t, p) => {
    const hz = 180 + Math.pow(p, 0.7) * 620;
    return saettige((dreieck(t, hz) * 0.7 + sinus(t, hz * 2.01) * 0.3) * huelle(p, 0.012, 1.0) * 0.26);
  });
  return raum(mische(wisch, schlag(3, 0.06, { hz: 3200, pegel: 0.14, abfall: 2.4, koerper: 140 })), {
    zeit: 0.05,
    anteil: 0.22,
    zahl: 3,
  });
})();

/*
 * Der Walzenlauf laeuft in einer Schleife.
 *
 * Deshalb muss der letzte Abtastwert zum ersten passen, sonst klackt es bei
 * jedem Umlauf. Die Laenge ist darum ein ganzes Vielfaches der Grundfrequenz,
 * und es gibt keine Huellkurve - eine Schleife mit Ausklang waere ein
 * Pulsieren.
 *
 * Neu darin: ein leises Rattern im Takt der durchlaufenden Symbole. Ein
 * reiner Dauerton klingt nach Motor, ein Rattern nach Walze.
 */
toene.reel_loop = (() => {
  const grund = 150;
  const dauer = 24 / grund; // 0,16 s - ganzzahlig in der Grundperiode
  const r = rauschen(7);
  const rohes = puffer(dauer, (t) => {
    const ratter = Math.pow(1 - ((t * 25) % 1), 2.2);
    return (
      sinus(t, grund) * 0.4 +
      sinus(t, grund * 2) * 0.16 +
      sinus(t, grund * 3.01) * 0.07 +
      r() * 0.45 * (0.5 + ratter * 0.5)
    );
  });
  return schliesse(skaliere(tiefpass(hochpass(rohes, 90), 2600), 0.13), 0.015);
})();

toene.reel_stop = (() => {
  /*
   * Das Einrasten.
   *
   * Zwei Lagen: ein kurzer Anschlag fuer das Mechanische und ein gedaempfter
   * Ton fuer das Gewicht. Die Dauer ist knapp - bei fuenf Walzen in Folge
   * duerfen sich die Stopps nicht ueberlagern, sonst wird daraus ein Brei.
   */
  const koerper = ton(165, 0.12, {
    pegel: 0.26,
    anstieg: 0.003,
    abfall: 2.6,
    teile: [
      [1, 1, 0],
      [2.4, 0.3, 1],
      [4.2, 0.12, 1],
    ],
  });
  return raum(mische(koerper, schlag(23, 0.05, { hz: 4200, pegel: 0.2, abfall: 3.2 })), {
    zeit: 0.035,
    anteil: 0.2,
    zahl: 2,
  });
})();

// --- Gewinn --------------------------------------------------------------

// Kein Gewinn: zwei Toene abwaerts. Kurz, nicht traurig, nicht laut.
toene.no_win = fanfare([330, 247], 0.26, { pegel: 0.13, glanz: 0.5, nachhall: { anteil: 0.18 } });
toene.win_small = fanfare([523, 659], 0.34, { pegel: 0.2, glanz: 0.7 });
toene.win_normal = fanfare([523, 659, 784], 0.5, { pegel: 0.24, glanz: 0.85 });
toene.win_big = fanfare([392, 523, 659, 784, 1047], 0.8, { pegel: 0.27, glanz: 1 });
toene.win_mega = fanfare([392, 523, 659, 784, 1047, 1319, 1568], 1.25, {
  pegel: 0.28,
  glanz: 1.15,
  nachhall: { zeit: 0.1, anteil: 0.34, zahl: 5 },
});
toene.jackpot = (() => {
  // Der Jackpot: die lange Fanfare plus ein Glockenschlag darueber.
  const basis = fanfare([392, 523, 659, 784, 1047, 1319, 1568, 2093], 1.8, {
    pegel: 0.28,
    glanz: 1.2,
    nachhall: { zeit: 0.12, anteil: 0.38, zahl: 5 },
  });
  const glocke = ton(1568, 1.8, {
    pegel: 0.12,
    anstieg: 0.004,
    abfall: 0.35,
    teile: [
      [1, 1, 0],
      [2.76, 0.45, 1],
      [5.4, 0.2, 1],
      [8.9, 0.08, 1],
    ],
  });
  return mische(basis, raum(glocke, { zeit: 0.14, anteil: 0.3, zahl: 4 }));
})();
toene.premium_win = fanfare([659, 880, 1109, 1319, 1760], 0.9, { pegel: 0.25, glanz: 1.1 });

// --- Bonus ---------------------------------------------------------------

toene.bonus_trigger = (() => {
  const basis = fanfare([440, 554, 659, 880, 1109], 0.95, { pegel: 0.26, glanz: 1.05 });
  return mische(basis, schlag(31, 0.5, { hz: 900, pegel: 0.1, abfall: 0.8, koerper: 70 }));
})();

/*
 * Der Sweat steigt.
 *
 * Er laeuft, waehrend die letzte Walze noch dreht, und wird zum Schluss
 * schneller und hoeher - das ist die ganze Spannung der Bonusrunde in einem
 * Ton. Die Lautstaerke steigt mit, aber gedeckelt: sonst ist genau dieser
 * Moment der lauteste des Spiels.
 */
toene.bonus_sweat = (() => {
  const roh = puffer(1.0, (t, p) => {
    const hz = 260 + p * p * 820;
    const zittern = 1 + 0.05 * sinus(t, 6 + p * 20);
    const herz = Math.pow(1 - ((t * (2 + p * 3)) % 1), 3);
    return saettige(
      (dreieck(t, hz * zittern) * 0.6 + sinus(t, hz * 0.5) * 0.4 * herz) *
        (0.09 + p * 0.17) *
        Math.min(1, (1 - p) * 9),
    );
  });
  return raum(roh, { zeit: 0.06, anteil: 0.24, zahl: 3 });
})();

toene.bonus_reveal = fanfare([784, 1047, 1319, 1568], 0.6, { pegel: 0.25, glanz: 1 });

// --- Freispiele ----------------------------------------------------------

toene.freespin_start = fanfare([523, 784, 1047, 1319, 1568], 1.0, { pegel: 0.27, glanz: 1.1 });
toene.freespin_end = fanfare([880, 659, 494, 392], 0.7, { pegel: 0.2, glanz: 0.7 });
toene.retrigger = fanfare([880, 1109, 1319, 1760], 0.55, { pegel: 0.25, glanz: 1 });

/**
 * Die Freispielmusik.
 *
 * Dieselbe Bauart wie die Hintergrundmusik und bewusst eine eigene Stimmung:
 * eine Stufe hoeher, in Dur, mit einem doppelt so dichten Puls. Es soll sich
 * anders anfuehlen als der Grundzustand - sonst merkt niemand, dass die
 * Freispiele laufen, wenn er gerade nicht auf die Zahl schaut.
 */
toene.freespin_loop = (() => {
  const SCHLAG = 0.4; // 150 bpm - etwas draengender
  const dauer = 16 * SCHLAG; // 6,4 Sekunden
  const grund = 73.42; // D2
  const akkord = [1, 1.5, 1.26, 1.89];
  const r = rauschen(2027);

  const flaeche = puffer(dauer, (t) => {
    let wert = 0;
    for (const [index, faktor] of akkord.entries()) {
      const hz = grund * faktor * (index === 0 ? 1 : 2);
      const atem = 0.5 + 0.5 * Math.sin((TAU * 2 * t) / dauer + index * 1.3);
      wert += sinus(t, hz) * 0.2 * (0.6 + 0.4 * atem);
      wert += sinus(t, hz * 3.004) * 0.05 * atem;
    }
    return wert;
  });

  const puls = puffer(dauer, (t) => {
    const imSchlag = (t % (SCHLAG / 2)) / (SCHLAG / 2);
    const betont = Math.floor(t / (SCHLAG / 2)) % 4 === 0;
    return saege(t, grund) * huelle(imSchlag, 0.004, 3.8) * (betont ? 0.26 : 0.12);
  });

  const funkeln = puffer(dauer, (t) => {
    const imSchritt = (t % (SCHLAG * 2)) / (SCHLAG * 2);
    const stufe = Math.floor(t / (SCHLAG * 2)) % 4;
    const hz = grund * 8 * [1, 1.26, 1.5, 1.26][stufe];
    return sinus(t, hz) * huelle(imSchritt, 0.01, 2.6) * 0.05;
  });

  const gemischt = mische(
    skaliere(tiefpass(flaeche, 1800), 0.5),
    skaliere(tiefpass(puls, 700), 0.5),
    funkeln,
    skaliere(
      hochpass(
        puffer(dauer, () => r()),
        3000,
      ),
      0.01,
    ),
  );
  return schliesse(skaliere(gemischt, 0.55), 0.05);
})();

// --- Risiko --------------------------------------------------------------

toene.gamble_start = (() => {
  // Ein Herzschlag: zwei Stoesse, dann Stille. Danach faellt die Entscheidung.
  const roh = puffer(0.6, (t, p) => {
    const schlagend = p < 0.16 || (p > 0.3 && p < 0.48);
    const imStoss = (p % 0.16) / 0.16;
    return saettige(
      (sinus(t, 64) * 0.8 + sinus(t, 128) * 0.2) * (schlagend ? 1 : 0) * huelle(imStoss, 0.04, 1.4) * 0.34,
    );
  });
  return raum(roh, { zeit: 0.09, anteil: 0.22, zahl: 3 });
})();

/**
 * Das drehende Rad.
 *
 * Eine Schleife mit einem Klicken je Segment - das ist der Klang, den ein
 * Rad mit einem Zeiger macht, und er traegt die ganze Spannung. Die Laenge
 * ist ein ganzes Vielfaches des Klickabstands, damit die Schleife sauber
 * umlaeuft; schneller wird das Rad dadurch nicht - das macht die Animation,
 * indem sie die Schleife frueher beendet.
 */
toene.gamble_spin = (() => {
  const klicks = 8;
  const dauer = 0.56; // 8 Klicks zu 70 ms
  const abstand = dauer / klicks;
  const spuren = [];
  for (let k = 0; k < klicks; k += 1) {
    const start = Math.round(k * abstand * RATE);
    const stimme = schlag(101 + k, 0.045, { hz: 5200, pegel: 0.2, abfall: 3.4 });
    const spur = new Float32Array(Math.round(dauer * RATE));
    for (let i = 0; i < stimme.length && start + i < spur.length; i += 1) {
      spur[start + i] = stimme[i];
    }
    spuren.push(spur);
  }
  // Ein leiser Grundton darunter, damit es nicht nach Tippen klingt.
  const brummen = puffer(dauer, (t) => sinus(t, 110) * 0.06 + sinus(t, 220) * 0.02);
  return schliesse(skaliere(mische(...spuren, brummen), 0.9), 0.01);
})();

/**
 * Die Spannung vor der Entscheidung.
 *
 * Ein steigender Ton, der am Ende abbricht. Er laeuft, waehrend das Rad
 * langsamer wird - und hoert genau dann auf, wenn der Zeiger steht. Danach
 * kommt das Ergebnis, und das soll in die Stille fallen.
 */
toene.gamble_tension = (() => {
  const roh = puffer(1.4, (t, p) => {
    const hz = 180 + Math.pow(p, 1.6) * 520;
    const tremolo = 1 + 0.08 * sinus(t, 5 + p * 14);
    return saettige(
      (sinus(t, hz * tremolo) * 0.55 + dreieck(t, hz * 2) * 0.2 + sinus(t, hz * 0.5) * 0.25) *
        (0.07 + p * 0.16) *
        Math.min(1, (1 - p) * 12),
    );
  });
  return raum(roh, { zeit: 0.07, anteil: 0.26, zahl: 3 });
})();

toene.gamble_win = (() => {
  const basis = fanfare([659, 880, 1319, 1760], 0.7, { pegel: 0.27, glanz: 1.1 });
  return mische(basis, schlag(53, 0.3, { hz: 7000, pegel: 0.08, abfall: 1.6 }));
})();

toene.gamble_lose = (() => {
  // Abwaerts und ins Leere - das Gegenstueck zum Aufwaertswisch des Starts.
  const roh = puffer(0.7, (t, p) => {
    const hz = 400 - Math.pow(p, 0.8) * 280;
    return saettige((dreieck(t, hz) * 0.6 + sinus(t, hz * 0.5) * 0.4) * huelle(p, 0.01, 0.75) * 0.24);
  });
  return raum(roh, { zeit: 0.1, anteil: 0.26, zahl: 4 });
})();

/** 16-Bit-PCM-Mono, der kleinste gemeinsame Nenner aller Browser. */
function alsWav(daten) {
  const kopf = Buffer.alloc(44);
  const koerper = Buffer.alloc(daten.length * 2);
  for (let i = 0; i < daten.length; i += 1) {
    const wert = Math.max(-1, Math.min(1, daten[i]));
    koerper.writeInt16LE(Math.round(wert * 32_767), i * 2);
  }
  kopf.write('RIFF', 0);
  kopf.writeUInt32LE(36 + koerper.length, 4);
  kopf.write('WAVE', 8);
  kopf.write('fmt ', 12);
  kopf.writeUInt32LE(16, 16);
  kopf.writeUInt16LE(1, 20); // PCM
  kopf.writeUInt16LE(1, 22); // Mono
  kopf.writeUInt32LE(RATE, 24);
  kopf.writeUInt32LE(RATE * 2, 28);
  kopf.writeUInt16LE(2, 32);
  kopf.writeUInt16LE(16, 34);
  kopf.write('data', 36);
  kopf.writeUInt32LE(koerper.length, 40);
  return Buffer.concat([kopf, koerper]);
}

mkdirSync(ZIEL, { recursive: true });
let gesamt = 0;
for (const [name, daten] of Object.entries(toene)) {
  const wav = alsWav(daten);
  writeFileSync(join(ZIEL, `${name}.wav`), wav);
  gesamt += wav.length;
  process.stdout.write(`${name}.wav  ${(wav.length / 1024).toFixed(1)} KB\n`);
}
process.stdout.write(`\n${Object.keys(toene).length} Dateien, ${(gesamt / 1024).toFixed(0)} KB gesamt\n`);
