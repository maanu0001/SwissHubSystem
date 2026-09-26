import { BUTTON_STYLE, type DiscordActionRow, type DiscordEmbed } from '@swisshub/discord';
import { FRAGT_ACCENT_COLOR } from './config';
import { berechneErgebnis, type Ergebnis, type StimmenZeile } from './ergebnis';

/**
 * Wie eine Frage und ihr Ergebnis auf Discord aussehen.
 *
 * Nur Darstellung: was gilt, entscheidet `abstimmung.ts`. Diese Datei baut
 * Embeds und Buttons und rechnet nichts aus, was nicht schon berechnet ist.
 */

/** Das Praefix, an dem der Bot einen Klick aus diesem Modul erkennt. */
const PRAEFIX = 'fragt';

/**
 * Die Kennung eines Antwort-Buttons.
 *
 * Form: `fragt:<abstimmungId>:<optionId>`.
 *
 * ## Warum beide Kennungen darin stehen
 *
 * Die Option allein wuerde genuegen, um die Antwort zu finden - sie haengt an
 * der Frage, und die Frage an der Abstimmung. Aber eine Frage kann mehrfach
 * gestellt worden sein, und dann zeigen die Buttons von letztem Monat auf
 * dieselben Optionen wie die von heute. Ein Klick auf eine alte Nachricht
 * wuerde in der laufenden Abstimmung landen.
 *
 * Mit der Abstimmungskennung im Button gehoert jeder Klick zu genau der
 * Abstimmung, unter der er steht - und ein Klick unter einer geschlossenen
 * bekommt die Antwort, die er verdient: «diese Abstimmung ist beendet».
 *
 * ## Warum das kurz bleiben muss
 *
 * Discord erlaubt 100 Zeichen. Zwei cuid (je 25) plus Praefix und Trenner
 * ergeben 57 - genug Luft, und geprueft wird es unten trotzdem.
 */
export function buttonId(abstimmungId: string, optionId: string): string {
  const id = `${PRAEFIX}:${abstimmungId}:${optionId}`;
  if (id.length > 100) {
    throw new Error(`Button-Kennung zu lang fuer Discord (${id.length} Zeichen): ${id}`);
  }
  return id;
}

/**
 * Einen Klick zuordnen - oder `null`, wenn er nicht hierher gehoert.
 *
 * `null` und kein Fehler: der Bot bekommt jeden Button-Klick des Servers zu
 * sehen, auch die der anderen Module. Eine Ausnahme je fremdem Klick waere ein
 * Fehlerlog, das sich selbst fuellt.
 */
export function parseButtonId(customId: string): { abstimmungId: string; optionId: string } | null {
  const teile = customId.split(':');
  if (teile.length !== 3 || teile[0] !== PRAEFIX) {
    return null;
  }
  const [, abstimmungId, optionId] = teile;
  // cuid: beginnt mit `c`, danach Kleinbuchstaben und Ziffern.
  const muster = /^c[a-z0-9]{20,30}$/u;
  if (!abstimmungId || !optionId || !muster.test(abstimmungId) || !muster.test(optionId)) {
    return null;
  }
  return { abstimmungId, optionId };
}

export interface FrageAnzeige {
  abstimmungId: string;
  frageText: string;
  untertitel: string | null;
  optionen: Array<{ id: string; label: string; position: number }>;
  closesAt: Date;
  /** Bildadresse, falls die Frage einen Anhang hat. */
  bildUrl?: string | null;
}

/**
 * Wie lange noch - in Worten, nicht als Zeitstempel.
 *
 * Discord kann Zeitstempel selbst darstellen (`<t:…:R>`), und genau das wird
 * hier benutzt: der Browser des Lesenden rechnet in seine Zeitzone um. Eine
 * selbst formatierte Dauer waere fuer jemanden in einer anderen Zone falsch,
 * und sie waere eine Minute nach dem Senden veraltet.
 */
function endeInWorten(closesAt: Date): string {
  const sekunden = Math.floor(closesAt.getTime() / 1000);
  return `Die Abstimmung endet <t:${sekunden}:R> (<t:${sekunden}:f>).`;
}

/** Das Embed einer laufenden Frage. */
export function frageEmbed(
  anzeige: FrageAnzeige,
  zwischenstand: Ergebnis | null,
): { embed: DiscordEmbed; komponenten: DiscordActionRow[] } {
  const zeilen: string[] = [];
  if (anzeige.untertitel) {
    zeilen.push(anzeige.untertitel, '');
  }

  if (zwischenstand && zwischenstand.gesamt > 0) {
    /*
     * Der Zwischenstand, wenn er eingeschaltet ist.
     *
     * Als Balken aus Blockzeichen und nicht als Zahlenkolonne: im
     * Nachrichtenverlauf eines Telefons ist ein Balken in einer halben Sekunde
     * gelesen, eine Tabelle nicht.
     */
    for (const zeile of zwischenstand.zeilen) {
      zeilen.push(`${balken(zeile.prozent)} **${zeile.prozent} %** · ${zeile.label}`);
    }
    zeilen.push('', `${zwischenstand.gesamt} ${zwischenstand.gesamt === 1 ? 'Stimme' : 'Stimmen'}`);
  } else {
    // Ohne Zwischenstand stehen die Antworten nur auf den Buttons - sie hier
    // zu wiederholen waere dieselbe Liste zweimal untereinander.
    zeilen.push('_Die Ergebnisse erscheinen nach Abstimmungsende._');
  }

  zeilen.push('', endeInWorten(anzeige.closesAt));

  return {
    embed: {
      // «SWISSHUB FRAGT» als Autorzeile und der Fragetext als Titel: damit ist
      // die Frage das Grosse und die Marke das Kleine.
      author: { name: 'SWISSHUB FRAGT' },
      title: anzeige.frageText,
      description: zeilen.join('\n'),
      color: FRAGT_ACCENT_COLOR,
      ...(anzeige.bildUrl ? { image: { url: anzeige.bildUrl } } : {}),
      footer: { text: 'Eine Stimme pro Person · du kannst sie bis zum Ende ändern' },
    },
    komponenten: antwortReihen(anzeige.abstimmungId, anzeige.optionen),
  };
}

/**
 * Die Buttons - eine Reihe, hoechstens fuenf.
 *
 * Discord erlaubt fuenf Buttons je Reihe und fuenf Reihen. Mehr als fuenf
 * Antworten laesst dieses Modul nicht zu (siehe `typen.ts`), deshalb genuegt
 * eine Reihe - und eine Reihe ist auf dem Telefon eine Zeile statt eines
 * Blocks.
 */
function antwortReihen(
  abstimmungId: string,
  optionen: Array<{ id: string; label: string; position: number }>,
): DiscordActionRow[] {
  const sortiert = [...optionen].sort((links, rechts) => links.position - rechts.position);
  return [
    {
      type: 1,
      components: sortiert.map((option) => ({
        type: 2 as const,
        style: BUTTON_STYLE.SECONDARY,
        label: option.label.slice(0, 80),
        custom_id: buttonId(abstimmungId, option.id),
      })),
    },
  ];
}

/** Zehn Blockzeichen, gefuellt nach Prozent. */
function balken(prozent: number): string {
  const voll = Math.round(prozent / 10);
  return '█'.repeat(voll) + '░'.repeat(10 - voll);
}

/**
 * Das Embed einer geschlossenen Abstimmung.
 *
 * Ersetzt das Embed der Frage, sobald geschlossen wird - dieselbe Nachricht,
 * damit im Kanal nicht zwei Beitraege zur gleichen Frage stehen und der
 * zweite dem ersten widerspricht. Die Buttons verschwinden dabei; ein Knopf,
 * der nur noch «zu spaet» sagt, ist eine Einladung zum Klicken.
 */
export function ergebnisEmbed(
  anzeige: { frageText: string; untertitel: string | null },
  ergebnis: Ergebnis,
): DiscordEmbed {
  const zeilen: string[] = [];
  if (anzeige.untertitel) {
    zeilen.push(anzeige.untertitel, '');
  }

  if (ergebnis.gesamt === 0) {
    zeilen.push('Diesmal hat niemand abgestimmt.');
  } else {
    for (const zeile of ergebnis.zeilen) {
      const markierung = zeile.fuehrt ? '**' : '';
      zeilen.push(
        `${balken(zeile.prozent)} ${markierung}${zeile.prozent} %${markierung} · ${zeile.label} _(${zeile.stimmen})_`,
      );
    }
    zeilen.push('', `${ergebnis.gesamt} ${ergebnis.gesamt === 1 ? 'Stimme' : 'Stimmen'} insgesamt.`);

    if (ergebnis.gewinner) {
      zeilen.push('', `**${ergebnis.gewinner.label}** hat gewonnen.`);
    } else if (ergebnis.gleichstand.length > 0) {
      // Kein kuenstlicher Gewinner. Ein Gleichstand ist ein Ergebnis.
      zeilen.push('', `Gleichstand: ${ergebnis.gleichstand.map((zeile) => zeile.label).join(' und ')}.`);
    }
  }

  return {
    author: { name: 'SWISSHUB FRAGT · ERGEBNIS' },
    title: anzeige.frageText,
    description: zeilen.join('\n'),
    color: FRAGT_ACCENT_COLOR,
    footer: { text: 'Die SwissHub Community hat entschieden.' },
  };
}

/** Die Ergebnismeldung als eigener Beitrag, wenn ein Ergebniskanal gesetzt ist. */
export function ergebnisMeldung(
  anzeige: { frageText: string; untertitel: string | null },
  ergebnis: Ergebnis,
  erwaehnung: string | null,
): { content?: string; embeds: DiscordEmbed[] } {
  return {
    ...(erwaehnung ? { content: erwaehnung } : {}),
    embeds: [ergebnisEmbed(anzeige, ergebnis)],
  };
}

/** Kurzform fuer Aufrufer, die nur Stimmen haben. */
export function ergebnisAusZeilen(zeilen: StimmenZeile[]): Ergebnis {
  return berechneErgebnis(zeilen);
}
