/**
 * Erzeugt die mitgelieferten Klaenge des XP-Slots.
 *
 * ## Warum synthetisch und nicht eingekauft
 *
 * Weil fremde Spielassets eine Lizenzfrage sind, die niemand mehr beantworten
 * kann, sobald die Datei einmal im Repository liegt. Hier entsteht jeder Ton
 * aus Sinus, Rauschen und einer Huellkurve - zwanzig Dateien, die dem Projekt
 * gehoeren und die jeder nachrechnen kann.
 *
 * ## Warum WAV und nicht MP3
 *
 * Weil ein Encoder eine Abhaengigkeit waere. Die Toene sind kurz und laufen
 * mit 22 050 Hz in Mono; der ganze Satz bleibt damit kleiner als ein einziges
 * Symbolfoto in voller Aufloesung. Jeder Browser spielt WAV ohne Umweg.
 *
 * ## Warum sie leise sind
 *
 * Ein Spielton, der beim ersten Spin erschreckt, wird abgeschaltet und nie
 * wieder eingeschaltet. Die Spitzen liegen deshalb bei etwa einem Drittel der
 * Vollaussteuerung; wer es lauter will, hat in der Verwaltung je Slot einen
 * Regler.
 *
 * Aufruf: `node scripts/xp-slot-standardklaenge.mjs`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const ZIEL = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'xp-slot', 'klaenge');

/** Ein Ton ist eine Funktion von der Zeit auf einen Wert zwischen -1 und 1. */
function puffer(sekunden, stimme) {
  const n = Math.round(RATE * sekunden);
  const daten = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    daten[i] = stimme(i / RATE, i / n);
  }
  return daten;
}

const sinus = (t, hz) => Math.sin(2 * Math.PI * hz * t);
/** Dreieck klingt weicher als Rechteck und traegt weiter als Sinus. */
const dreieck = (t, hz) => 2 * Math.abs(2 * (t * hz - Math.floor(t * hz + 0.5))) - 1;

/**
 * Rauschen mit festem Startwert.
 *
 * Bewusst kein `Math.random()`: der Satz soll bei jedem Lauf exakt gleich
 * herauskommen, sonst zeigt `git diff` nach jeder Neuerzeugung zwanzig
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
  if (p < anstieg) {
    return p / anstieg;
  }
  const rest = (p - anstieg) / (1 - anstieg);
  return Math.pow(1 - rest, abfall * 6);
};

/** Eine aufsteigende Folge - der Klang von «es wird besser». */
function fanfare(toene, dauer, form = dreieck, pegel = 0.3) {
  return puffer(dauer, (t, p) => {
    const schritt = Math.min(toene.length - 1, Math.floor(p * toene.length));
    const imSchritt = (p * toene.length) % 1;
    return form(t, toene[schritt]) * huelle(imSchritt, 0.04, 0.9) * pegel * (1 - p * 0.25);
  });
}

function klick(hz, dauer, pegel, abfall = 1.4) {
  return puffer(dauer, (t, p) => sinus(t, hz) * huelle(p, 0.005, abfall) * pegel);
}

const toene = {};

// --- Oberflaeche ---------------------------------------------------------
toene.ui_button = klick(880, 0.06, 0.18, 2.2);

// --- Walzen --------------------------------------------------------------
toene.spin_start = puffer(0.26, (t, p) => {
  // Ein Aufwaertswisch: die Tonhoehe steigt, waehrend der Ton verklingt.
  const hz = 240 + p * 520;
  return dreieck(t, hz) * huelle(p, 0.01, 1.1) * 0.26;
});

/*
 * Der Walzenlauf laeuft in einer Schleife.
 *
 * Deshalb muss der letzte Abtastwert zum ersten passen, sonst klackt es bei
 * jedem Umlauf. Die Laenge ist darum ein ganzes Vielfaches der Grundfrequenz,
 * und es gibt keine Huellkurve - eine Schleife mit Ausklang waere ein Pulsieren.
 */
toene.reel_loop = (() => {
  const grund = 140;
  const dauer = 12 / grund;
  const r = rauschen(7);
  let gefiltert = 0;
  return puffer(dauer, (t) => {
    gefiltert = gefiltert * 0.82 + r() * 0.18;
    return (sinus(t, grund) * 0.5 + sinus(t, grund * 2) * 0.2 + gefiltert * 0.5) * 0.12;
  });
})();

toene.reel_stop = (() => {
  const r = rauschen(23);
  return puffer(0.13, (t, p) => (sinus(t, 190) * 0.7 + r() * 0.3) * huelle(p, 0.004, 1.8) * 0.3);
})();

// --- Gewinn --------------------------------------------------------------
// Kein Gewinn: zwei Toene abwaerts. Kurz, nicht traurig, nicht laut.
toene.no_win = fanfare([330, 262], 0.22, sinus, 0.14);
toene.win_small = fanfare([523, 659], 0.26, dreieck, 0.22);
toene.win_normal = fanfare([523, 659, 784], 0.4, dreieck, 0.26);
toene.win_big = fanfare([523, 659, 784, 1047], 0.62, dreieck, 0.3);
toene.win_mega = fanfare([392, 523, 659, 784, 1047, 1319], 0.95, dreieck, 0.32);
toene.jackpot = fanfare([523, 659, 784, 1047, 1319, 1568, 2093], 1.45, dreieck, 0.34);
toene.premium_win = fanfare([659, 880, 1109, 1319], 0.7, sinus, 0.28);

// --- Bonus ---------------------------------------------------------------
toene.bonus_trigger = fanfare([440, 554, 659, 880], 0.72, dreieck, 0.3);

/*
 * Der Sweat steigt.
 *
 * Er laeuft, waehrend die letzte Walze noch dreht, und wird zum Schluss
 * schneller und hoeher - das ist die ganze Spannung der Bonusrunde in einem
 * Ton. Die Lautstaerke steigt mit, aber gedeckelt: sonst ist genau dieser
 * Moment der lauteste des Spiels.
 */
toene.bonus_sweat = puffer(0.9, (t, p) => {
  const hz = 300 + p * p * 700;
  const zittern = 1 + 0.06 * sinus(t, 7 + p * 18);
  return dreieck(t, hz * zittern) * (0.1 + p * 0.18) * Math.min(1, (1 - p) * 8);
});

toene.bonus_reveal = fanfare([784, 1047, 1319], 0.5, sinus, 0.28);

// --- Freispiele ----------------------------------------------------------
toene.freespin_start = fanfare([523, 784, 1047, 1319], 0.8, sinus, 0.3);
toene.freespin_end = fanfare([784, 587, 440], 0.55, sinus, 0.22);
toene.retrigger = fanfare([880, 1109, 1319], 0.42, dreieck, 0.28);

// --- Risiko --------------------------------------------------------------
toene.gamble_start = puffer(0.5, (t, p) => {
  // Ein Herzschlag: zwei Stoesse, dann Stille. Danach faellt die Entscheidung.
  const schlag = p < 0.18 || (p > 0.34 && p < 0.52) ? 1 : 0;
  return sinus(t, 72) * schlag * 0.34 * huelle((p % 0.18) / 0.18, 0.05, 1.2);
});
toene.gamble_win = fanfare([659, 880, 1319], 0.5, dreieck, 0.3);
toene.gamble_lose = puffer(0.55, (t, p) => {
  // Abwaerts und ins Leere - das Gegenstueck zum Aufwaertswisch des Starts.
  const hz = 420 - p * 260;
  return dreieck(t, hz) * huelle(p, 0.01, 0.8) * 0.24;
});

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
