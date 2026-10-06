import { linksIn, nurText } from './inline';
import type { DokuBlock, DokuKategorie, DokuSeite, DokuWerk } from './typen';

/**
 * Nachschlagen, Inhaltsverzeichnis, Suchindex - alles aus derselben Quelle.
 *
 * Die Funktionen hier sind rein: sie bekommen ein `DokuWerk` und geben etwas
 * zurueck. Keine Datenbank, keine Dateien, kein Zustand. Das ist der Grund,
 * aus dem die Tests die Doku vollstaendig pruefen koennen, ohne eine Seite zu
 * rendern - und der Grund, aus dem die Suche ohne Abfrage auskommt.
 */

/** Eine Seite samt ihrer Kategorie - so, wie Navigation und Suche sie brauchen. */
export interface SeitenTreffer {
  kategorie: DokuKategorie;
  seite: DokuSeite;
}

/** Alle Seiten eines Werks, in der Reihenfolge des Inhaltsverzeichnisses. */
export function alleSeiten(werk: DokuWerk): SeitenTreffer[] {
  return werk.kategorien.flatMap((kategorie) => kategorie.seiten.map((seite) => ({ kategorie, seite })));
}

/** Die Seite zu einem Slug - oder nichts. */
export function seiteZu(werk: DokuWerk, slug: string): SeitenTreffer | null {
  return alleSeiten(werk).find((treffer) => treffer.seite.slug === slug) ?? null;
}

/** Die vollstaendige Adresse einer Seite. */
export function seitenHref(werk: DokuWerk, seite: DokuSeite): string {
  return `${werk.basis}/${seite.slug}`;
}

/**
 * Was «Auf dieser Seite» anzeigt.
 *
 * Nur die Ueberschriften, zwei Ebenen tief. Tiefer wird eine Seitenleiste zu
 * einer zweiten Navigation, und wer sie dann braucht, braucht eigentlich zwei
 * Seiten.
 */
export interface TocEintrag {
  anker: string;
  titel: string;
  ebene: 2 | 3;
}

export function inhaltsverzeichnis(seite: DokuSeite): TocEintrag[] {
  return seite.abschnitte.flatMap((abschnitt) => [
    { anker: abschnitt.anker, titel: abschnitt.titel, ebene: 2 as const },
    ...(abschnitt.unter ?? []).map((unter) => ({
      anker: unter.anker,
      titel: unter.titel,
      ebene: 3 as const,
    })),
  ]);
}

/**
 * Der Suchtext eines Blocks.
 *
 * Code zaehlt mit: wer nach `aufloeseAltlasten` sucht, meint meistens das
 * Beispiel und nicht den Absatz darueber. Tabellen zaehlen mit, weil dort die
 * Berechtigungen stehen.
 */
export function blockText(block: DokuBlock): string {
  switch (block.art) {
    case 'absatz':
      return nurText(block.text);
    case 'liste':
      return block.punkte.map(nurText).join(' ');
    case 'code':
      return [block.titel, block.inhalt].filter(Boolean).join(' ');
    case 'tabelle':
      return [...block.kopf, ...block.zeilen.flat()].map(nurText).join(' ');
    case 'hinweis':
      return [block.titel, nurText(block.text)].filter(Boolean).join(' ');
    case 'schritte':
      return block.punkte.map((punkt) => `${punkt.titel} ${nurText(punkt.text ?? '')}`).join(' ');
    case 'fluss':
      return block.stationen.map((station) => `${station.label} ${station.detail ?? ''}`).join(' ');
    case 'felder':
      return block.eintraege.map((eintrag) => `${eintrag.name} ${nurText(eintrag.text)}`).join(' ');
    case 'modulknopf':
      return block.label;
  }
}

/**
 * Ein Eintrag im Suchindex.
 *
 * Die Einheit ist der **Abschnitt** und nicht die Seite: eine Seite mit zehn
 * Abschnitten haette als ein Eintrag zwar alle Begriffe, koennte aber nur auf
 * ihren Anfang zeigen. Mit Ankern landet man dort, wo der Begriff steht.
 */
export interface SuchEintrag {
  /** Seitentitel - was im Ergebnis gross steht. */
  titel: string;
  /** Kategorie plus ggf. Abschnitt - die Herkunftszeile im Ergebnis. */
  bereich: string;
  /** Vollstaendige Adresse samt Anker. */
  href: string;
  /** Ein Satz Vorschau. */
  vorschau: string;
  /** Kleingeschriebener Suchtext. Wird nicht angezeigt. */
  text: string;
}

/** Schneidet eine Vorschau auf eine lesbare Laenge. */
function vorschauAus(text: string, grenze = 160): string {
  const sauber = text.replace(/\s+/gu, ' ').trim();
  if (sauber.length <= grenze) {
    return sauber;
  }
  const schnitt = sauber.slice(0, grenze);
  const letzte = schnitt.lastIndexOf(' ');
  return `${letzte > grenze * 0.6 ? schnitt.slice(0, letzte) : schnitt}…`;
}

/**
 * Der Suchindex eines Werks.
 *
 * Einmal gebaut und dann im Speicher: die Doku ist ueberschaubar, und eine
 * Abfrage je Tastendruck waere fuer eine Liste, die sich nur mit einem Deploy
 * aendert, der falsche Aufwand. Der Index geht als Prop an die Suche - sie
 * filtert im Browser.
 */
export function sucheIndex(werk: DokuWerk): SuchEintrag[] {
  const eintraege: SuchEintrag[] = [];

  for (const { kategorie, seite } of alleSeiten(werk)) {
    const basis = seitenHref(werk, seite);
    // Die Seite selbst - damit ein Treffer auf den Titel oben landet.
    eintraege.push({
      titel: seite.titel,
      bereich: kategorie.titel,
      href: basis,
      vorschau: vorschauAus(seite.kurz),
      text: `${seite.titel} ${seite.kurz} ${kategorie.titel} ${seite.bereich ?? ''}`.toLowerCase(),
    });

    for (const abschnitt of seite.abschnitte) {
      const eigen = abschnitt.blocks.map(blockText).join(' ');
      eintraege.push({
        titel: abschnitt.titel,
        bereich: `${kategorie.titel} · ${seite.titel}`,
        href: `${basis}#${abschnitt.anker}`,
        vorschau: vorschauAus(eigen || seite.kurz),
        text: `${abschnitt.titel} ${eigen}`.toLowerCase(),
      });

      for (const unter of abschnitt.unter ?? []) {
        const tiefer = unter.blocks.map(blockText).join(' ');
        eintraege.push({
          titel: unter.titel,
          bereich: `${seite.titel} · ${abschnitt.titel}`,
          href: `${basis}#${unter.anker}`,
          vorschau: vorschauAus(tiefer || abschnitt.titel),
          text: `${unter.titel} ${tiefer}`.toLowerCase(),
        });
      }
    }
  }

  return eintraege;
}

/**
 * Sucht im Index.
 *
 * Alle Begriffe muessen vorkommen, in beliebiger Reihenfolge - «slot symbol»
 * findet den Abschnitt ueber Symbol-Uploads im XP-Slot. Treffer im Titel
 * stehen vor Treffern im Text, denn wer «Permissions» eingibt, will die Seite
 * und nicht den Satz, in dem das Wort nebenbei steht.
 */
export function finde(index: readonly SuchEintrag[], anfrage: string, grenze = 12): SuchEintrag[] {
  const begriffe = anfrage.toLowerCase().split(/\s+/u).filter(Boolean);
  if (begriffe.length === 0) {
    return [];
  }
  return index
    .map((eintrag) => {
      if (!begriffe.every((begriff) => eintrag.text.includes(begriff))) {
        return null;
      }
      const titel = eintrag.titel.toLowerCase();
      const imTitel = begriffe.filter((begriff) => titel.includes(begriff)).length;
      return { eintrag, rang: imTitel };
    })
    .filter((treffer): treffer is { eintrag: SuchEintrag; rang: number } => treffer !== null)
    .sort((a, b) => b.rang - a.rang)
    .slice(0, grenze)
    .map((treffer) => treffer.eintrag);
}

/**
 * Alle Anker eines Werks, als `slug#anker`.
 *
 * Fuer den Test, der Eindeutigkeit und Linkziele prueft.
 */
export function alleAnker(werk: DokuWerk): string[] {
  return alleSeiten(werk).flatMap(({ seite }) =>
    inhaltsverzeichnis(seite).map((eintrag) => `${seite.slug}#${eintrag.anker}`),
  );
}

/** Alle internen Adressen, auf die ein Werk zeigt - fuer die Linkpruefung. */
export function alleLinkZiele(werk: DokuWerk): string[] {
  const aus = (block: DokuBlock): string[] => {
    switch (block.art) {
      case 'absatz':
        return linksIn(block.text);
      case 'liste':
        return block.punkte.flatMap(linksIn);
      case 'hinweis':
        return linksIn(block.text);
      case 'schritte':
        return block.punkte.flatMap((punkt) => linksIn(punkt.text ?? ''));
      case 'tabelle':
        return block.zeilen.flat().flatMap(linksIn);
      case 'felder':
        return block.eintraege.flatMap((eintrag) => linksIn(eintrag.text));
      case 'modulknopf':
        return [block.href];
      default:
        return [];
    }
  };

  return alleSeiten(werk).flatMap(({ seite }) =>
    seite.abschnitte.flatMap((abschnitt) => [
      ...abschnitt.blocks.flatMap(aus),
      ...(abschnitt.unter ?? []).flatMap((unter) => unter.blocks.flatMap(aus)),
    ]),
  );
}
