import { fragt, getModuleSettings, branding } from '@swisshub/modules';
import { heller, normalisiereFarbe, sanitizeText } from '@swisshub/shared';
import { STANDARD_AKZENT, STANDARD_AKZENT_HELL, type FolienMarke } from './social-folie';

/**
 * Farbe, Zeichen und Zusatztext der Grafiken - vom Entwurf, sonst vom Modul.
 *
 * ## Die Root Cause, die hier steht
 *
 * Diese Funktion las ausschliesslich die **Moduleinstellungen**. Farbe,
 * Zeichen und Zusatztext waren damit Servereinstellungen unter
 * «Einstellungen -> Module -> SwissHub fragt» und galten fuer jeden Export.
 *
 * Verlangt war etwas anderes: **im Content Studio, je Export**. Zweimal wurde
 * die Aufgabe als erledigt gemeldet, und zweimal war die Funktion dafuer an
 * der falschen Stelle gebaut - es gab keine Spalte am Entwurf, kein Feld im
 * Studio und kein Attribut in der Ansicht. Aus Sicht des Nutzers ist die
 * Funktion im Studio also nie erschienen.
 *
 * Jetzt nimmt sie den Entwurf dazu. Ein Wert am Entwurf gewinnt; steht dort
 * `null`, gilt die Moduleinstellung. Die Serverfarbe bleibt damit die Vorgabe
 * und wird nicht ersetzt - wer im Studio nichts einstellt, bekommt genau das,
 * was er vorher bekam.
 *
 * ## Warum das eine Stelle ist
 *
 * Weil es drei Wege zu einem Bild gibt - die Vorschau im Studio, das
 * Einzelbild und das ZIP - und alle drei dasselbe Bild ergeben muessen. Die
 * Vorschau ist dabei kein Sonderfall, sondern dieselbe Route wie das
 * Einzelbild; das ist der Grund, warum «Vorschau = Export» hier nichts kostet.
 *
 * Zwei Stellen, die Einstellungen in eine Marke uebersetzen, waeren zwei
 * Uebersetzungen - und die zweite waere die, die man beim naechsten Feld
 * vergisst.
 *
 * Und weil hier **geprueft** wird. Alle drei Werte kommen aus einem Formular,
 * also aus fremder Hand, und sie landen in einer Grafik:
 *
 *   - Die Farbe geht durch `normalisiereFarbe` und ist danach entweder
 *     `#rrggbb` aus sechs Hexziffern oder nicht vorhanden. Sie wird nicht
 *     bereinigt, sie wird umgewandelt - es gibt keinen Weg, durch den eine
 *     Eingabe unveraendert in ein `style`-Attribut gelangt.
 *   - Das Zeichen ist eines von drei Woertern, nie ein Pfad. Ein manipulierter
 *     Logopfad kann deshalb nicht entstehen; es gibt keinen.
 *   - Der Zusatztext geht durch `sanitizeText` und ist danach reiner Text mit
 *     Laengengrenze. Satori stellt ohnehin kein HTML dar, aber die Grenze
 *     gehoert an den Eingang und nicht an die Darstellung.
 *
 * ## Warum das Logo als Bytes kommt
 *
 * Satori wuerde eine Adresse abrufen. Der Export haengt dann an einem Server,
 * der antworten muss, waehrend jemand auf eine PNG-Datei wartet. Die Bytes
 * kommen deshalb von der Platte - durch `readUpload`, das den Dateinamen
 * streng prueft und den aufgeloesten Pfad im Upload-Verzeichnis haelt - und
 * stehen als `data:`-URI fertig in der Komponente.
 *
 * Fehlt das Logo, obwohl es eingestellt ist (geloescht, Verzeichnis weg), gibt
 * es das Signet und nicht einen Fehler: eine Grafik ohne Logo ist brauchbar,
 * eine Fehlermeldung statt einer Grafik nicht.
 */
/**
 * Was `folienMarke` vom Entwurf braucht.
 *
 * Absichtlich die **lose** Form mit `string | null` und nicht
 * `fragt.ExportMarke`: so passt eine Prisma-Zeile unverändert hinein, und die
 * Prüfung bleibt da, wo sie ohnehin stattfinden muss. Ein strenger Typ hier
 * hiesse, dass die Route eine Zusicherung behauptet, die sie aus einer
 * `TEXT`-Spalte nicht hat - und eine behauptete Zusicherung ist schlechter als
 * eine geprüfte.
 */
export interface MarkenQuelle {
  exportAkzentfarbe?: string | null;
  exportLogo?: string | null;
  exportZusatztext?: string | null;
}

export async function folienMarke(entwurf?: MarkenQuelle | null): Promise<FolienMarke> {
  const einstellungen = await getModuleSettings<fragt.FragtSettings>(fragt.FRAGT_MODULE_ID);

  /*
   * Der Entwurf gewinnt, wenn er etwas sagt.
   *
   * `??` und nicht `||`: eine leere Zeichenkette im Zusatztext ist eine
   * Aussage («keine Fusszeile»), kein fehlender Wert. Mit `||` faellt sie auf
   * die Moduleinstellung zurueck, und der Nutzer sieht seinen geloeschten
   * Text wieder auftauchen.
   */
  const rohFarbe = entwurf?.exportAkzentfarbe ?? einstellungen.exportAkzentfarbe;
  const rohLogo = entwurf?.exportLogo ?? einstellungen.exportLogo;
  const rohZusatz = entwurf?.exportZusatztext ?? einstellungen.exportZusatztext ?? '';

  const akzent = normalisiereFarbe(rohFarbe) ?? STANDARD_AKZENT;
  const zusatz = sanitizeText(rohZusatz, 80).trim();

  return {
    akzent,
    /*
     * Der hellere Ton.
     *
     * Bei der Standardfarbe der von Hand gewaehlte Wert `#b81219` - er ist
     * abgestimmt und soll nicht durch eine Rechnung ersetzt werden, die ihn um
     * eine Nuance verfehlt. Bei jeder anderen Farbe die Rechnung, denn eine
     * zweite Farbe einzustellen waere eine Frage zu viel.
     */
    akzentHell: akzent === STANDARD_AKZENT ? STANDARD_AKZENT_HELL : heller(akzent),
    logo: await logoFuerFolie(rohLogo),
    zusatztext: zusatz === '' ? null : zusatz,
  };
}

/**
 * Die Vorgabe des Moduls - fuer die Beschriftung im Studio.
 *
 * Das Studio soll neben «wie im Modul» sagen, **was** das gerade ist. Eine
 * Auswahl «wie im Modul» ohne diese Angabe ist eine Wahl ins Ungewisse.
 *
 * Bewusst dieselbe Normalisierung wie oben und keine zweite: was hier steht,
 * ist genau das, was ohne Uebersteuerung gezeichnet wuerde.
 */
export async function markenVorgabe(): Promise<{
  akzent: string;
  logo: fragt.ExportLogoWahl;
  zusatztext: string;
}> {
  const einstellungen = await getModuleSettings<fragt.FragtSettings>(fragt.FRAGT_MODULE_ID);
  return {
    akzent: normalisiereFarbe(einstellungen.exportAkzentfarbe) ?? STANDARD_AKZENT,
    logo: einstellungen.exportLogo,
    zusatztext: sanitizeText(einstellungen.exportZusatztext ?? '', 80).trim(),
  };
}

/** Das Zeichen oben links: nichts, das Branding-Logo als Bytes, oder das Signet. */
async function logoFuerFolie(
  wahl: fragt.FragtSettings['exportLogo'] | string | null,
): Promise<FolienMarke['logo']> {
  if (wahl === 'keins') {
    return 'keins';
  }
  if (wahl !== 'serverlogo') {
    return null;
  }

  const konfiguration = await branding.getBrandingConfig();
  if (!konfiguration.logoPath) {
    // Eingestellt, aber nie eines hochgeladen: das Signet. Eine leere Stelle
    // waere eine Grafik, der man nicht ansieht, dass etwas fehlt.
    return null;
  }

  const datei = await branding.readUpload(konfiguration.logoPath);
  if (!datei) {
    return null;
  }
  return `data:${branding.CONTENT_TYPE[datei.format]};base64,${datei.data.toString('base64')}`;
}
