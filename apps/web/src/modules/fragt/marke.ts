import { fragt, getModuleSettings, branding } from '@swisshub/modules';
import { heller, normalisiereFarbe, sanitizeText } from '@swisshub/shared';
import { STANDARD_AKZENT, STANDARD_AKZENT_HELL, type FolienMarke } from './social-folie';

/**
 * Farbe, Zeichen und Zusatztext der Grafiken - aus den Moduleinstellungen.
 *
 * ## Warum das eine Stelle ist
 *
 * Weil es zwei Export-Routen gibt (Einzelbild und ZIP) und beide dasselbe Bild
 * ergeben muessen. Zwei Stellen, die Einstellungen in eine Marke uebersetzen,
 * waeren zwei Uebersetzungen - und die zweite waere die, die man beim naechsten
 * Feld vergisst.
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
export async function folienMarke(): Promise<FolienMarke> {
  const einstellungen = await getModuleSettings<fragt.FragtSettings>(fragt.FRAGT_MODULE_ID);

  const akzent = normalisiereFarbe(einstellungen.exportAkzentfarbe) ?? STANDARD_AKZENT;
  const zusatz = sanitizeText(einstellungen.exportZusatztext ?? '', 80).trim();

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
    logo: await logoFuerFolie(einstellungen.exportLogo),
    zusatztext: zusatz === '' ? null : zusatz,
  };
}

/** Das Zeichen oben links: nichts, das Branding-Logo als Bytes, oder das Signet. */
async function logoFuerFolie(wahl: fragt.FragtSettings['exportLogo']): Promise<FolienMarke['logo']> {
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
