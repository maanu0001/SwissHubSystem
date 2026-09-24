#!/usr/bin/env node
/**
 * Erzeugt `packages/modules/src/level/dejavu-metriken.ts`.
 *
 * ## Wozu
 *
 * Die Levelkarte wird als SVG gebaut und im Bot mit `sharp` zu PNG gerastert.
 * Gezeichnet wird dabei in DejaVu Sans - der einzigen Schrift, die im
 * Bot-Abbild installiert ist (siehe `font-dejavu` im Dockerfile). Damit die
 * Karte weiss, wie breit ein Name wird, bevor sie ihn setzt, liest dieses
 * Skript die Vorschubbreiten direkt aus den Schriftdateien.
 *
 * ## Warum ein eigener TTF-Leser
 *
 * Gebraucht werden zwei Tabellen: `hmtx` (Vorschubbreiten je Glyphe) und
 * `cmap` (Codepunkt zu Glyphe). Beides sind ein paar Dutzend Zeilen. Eine
 * Abhaengigkeit dafuer aufzunehmen, die anschliessend nie wieder laeuft -
 * das Ergebnis liegt ja als erzeugte Datei im Repository -, waere ein
 * schlechtes Tauschgeschaeft.
 *
 * ## Aufruf
 *
 *     node scripts/dejavu-metriken.mjs
 *
 * Braucht die Schriftdateien unter `/usr/share/fonts/truetype/dejavu`
 * (Debian/Ubuntu: `apt install fonts-dejavu-core`, Alpine: `apk add
 * font-dejavu`). Ein anderer Ort laesst sich als Argument uebergeben.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Die Bereiche, deren Breiten in die Tabelle wandern. */
const BEREICHE = [
  [0x20, 0x24f], // Basis-Latein, Latin-1, Latin Extended-A und -B
  [0x2b0, 0x2ff], // Modifikatoren
  [0x370, 0x52f], // Griechisch und Kyrillisch
  [0x2000, 0x206f], // Allgemeine Interpunktion
  [0x20a0, 0x20bf], // Waehrungszeichen
  [0x2100, 0x21ff], // Buchstabenaehnliche Zeichen und Pfeile
  [0x2500, 0x25ff], // Rahmen und geometrische Formen
  [0x2600, 0x27bf], // Symbole und Dingbats
];

function lies(pfad) {
  const d = readFileSync(pfad);
  const anzahl = d.readUInt16BE(4);
  const tabellen = new Map();
  for (let i = 0; i < anzahl; i += 1) {
    const off = 12 + 16 * i;
    tabellen.set(d.toString('latin1', off, off + 4), d.readUInt32BE(off + 8));
  }

  const head = tabellen.get('head');
  const einheiten = d.readUInt16BE(head + 18);

  const hhea = tabellen.get('hhea');
  const metriken = d.readUInt16BE(hhea + 34);

  const hmtx = tabellen.get('hmtx');
  const breiten = [];
  for (let i = 0; i < metriken; i += 1) {
    breiten.push(d.readUInt16BE(hmtx + 4 * i));
  }
  // Nach `numberOfHMetrics` folgen nur noch Seitenabstaende; alle weiteren
  // Glyphen haben die Breite der letzten.
  const breite = (glyphe) => breiten[Math.min(glyphe, metriken - 1)];

  // cmap, Untertabelle fuer Unicode.
  const cmap = tabellen.get('cmap');
  let ziel = null;
  const untertabellen = d.readUInt16BE(cmap + 2);
  for (let i = 0; i < untertabellen; i += 1) {
    const off = cmap + 4 + 8 * i;
    const plattform = d.readUInt16BE(off);
    const kodierung = d.readUInt16BE(off + 2);
    const paar = `${plattform}/${kodierung}`;
    if (['3/1', '3/10', '0/3', '0/4'].includes(paar)) {
      ziel = cmap + d.readUInt32BE(off + 4);
      if (paar === '3/1') break;
    }
  }
  if (ziel === null || d.readUInt16BE(ziel) !== 4) {
    throw new Error(`${pfad}: keine cmap im Format 4 gefunden`);
  }

  const zuordnung = new Map();
  const segmente = d.readUInt16BE(ziel + 6) / 2;
  const ende = ziel + 14;
  const start = ende + segmente * 2 + 2;
  const delta = start + segmente * 2;
  const bereich = delta + segmente * 2;
  for (let s = 0; s < segmente; s += 1) {
    const bis = d.readUInt16BE(ende + 2 * s);
    const von = d.readUInt16BE(start + 2 * s);
    if (von === 0xffff) continue;
    const versatz = d.readInt16BE(delta + 2 * s);
    const zeiger = d.readUInt16BE(bereich + 2 * s);
    for (let c = von; c <= bis; c += 1) {
      let g;
      if (zeiger === 0) {
        g = (c + versatz) & 0xffff;
      } else {
        const i = bereich + 2 * s + zeiger + 2 * (c - von);
        if (i + 2 > d.length) continue;
        g = d.readUInt16BE(i);
        if (g) g = (g + versatz) & 0xffff;
      }
      if (g) zuordnung.set(c, g);
    }
  }

  return { einheiten, breite, zuordnung, ersatz: breite(0) };
}

/** Zusammenhaengende Bereiche gleicher Breite als `start:laenge:breite`. */
function laufliste(schrift) {
  const laeufe = [];
  let lauf = null;
  const gesehen = new Set();
  for (const [von, bis] of BEREICHE) {
    for (let cp = von; cp <= bis; cp += 1) {
      if (gesehen.has(cp)) continue;
      gesehen.add(cp);
      const glyphe = schrift.zuordnung.get(cp);
      if (glyphe === undefined) {
        lauf = null;
        continue;
      }
      const w = schrift.breite(glyphe);
      if (lauf && lauf[2] === w && lauf[1] === cp - 1) {
        lauf[1] = cp;
      } else {
        lauf = [cp, cp, w];
        laeufe.push(lauf);
      }
    }
  }
  return laeufe.map(([a, b, w]) => `${a.toString(16)}:${(b - a).toString(16)}:${w.toString(16)}`).join(',');
}

/** Umbruch an Kommagrenzen, damit die erzeugte Datei lesbar bleibt. */
function umbrich(text, breite = 104) {
  const zeilen = [];
  let rest = text;
  while (rest.length > breite) {
    const schnitt = rest.lastIndexOf(',', breite) + 1;
    zeilen.push(rest.slice(0, schnitt));
    rest = rest.slice(schnitt);
  }
  zeilen.push(rest);
  return `\n  '${zeilen.join("' +\n  '")}'`;
}

const verzeichnis = process.argv[2] ?? '/usr/share/fonts/truetype/dejavu';
const regulaer = lies(join(verzeichnis, 'DejaVuSans.ttf'));
const fett = lies(join(verzeichnis, 'DejaVuSans-Bold.ttf'));

if (regulaer.einheiten !== fett.einheiten || regulaer.ersatz !== fett.ersatz) {
  throw new Error('Die beiden Schnitte weichen in Geviert oder Ersatzbreite voneinander ab.');
}

console.log(
  `DejaVu Sans: ${regulaer.zuordnung.size} Zeichen, Geviert ${regulaer.einheiten}, Ersatzbreite ${regulaer.ersatz}`,
);

const ziel = join(process.cwd(), 'packages/modules/src/level/dejavu-metriken.ts');
const alt = readFileSync(ziel, 'utf8');
const neu = alt
  .replace(/const LAEUFE_NORMAL =[\s\S]*?;\n/u, `const LAEUFE_NORMAL =${umbrich(laufliste(regulaer))};\n`)
  .replace(/const LAEUFE_FETT =[\s\S]*?;\n/u, `const LAEUFE_FETT =${umbrich(laufliste(fett))};\n`)
  .replace(/const EINHEITEN_JE_GEVIERT = \d+;/u, `const EINHEITEN_JE_GEVIERT = ${regulaer.einheiten};`)
  .replace(/const ERSATZBREITE = \d+;/u, `const ERSATZBREITE = ${regulaer.ersatz};`);

writeFileSync(ziel, neu);
console.log(`Geschrieben: ${ziel}`);
