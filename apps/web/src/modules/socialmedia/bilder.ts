import { branding } from '@swisshub/modules';
import type { socialmedia } from '@swisshub/modules';
import { ladeSignet } from './mitgeliefert';
import type { PostBilder } from './post-folie';

/**
 * Die Bilder eines Posts als `data:`-URI.
 *
 * ## Warum Bytes und keine Adresse
 *
 * Satori wuerde eine Adresse abrufen. Der Export haengt dann an einem Server,
 * der antworten muss, waehrend jemand auf eine Datei wartet - und bei einer
 * Adresse aus fremder Hand waere es ein Abruf, den jemand anderes bestimmt
 * (§37). Die Bytes kommen deshalb von der Platte, gelesen durch `readUpload`,
 * das den Dateinamen streng prueft und den aufgeloesten Pfad im
 * Upload-Verzeichnis haelt.
 *
 * ## Warum nicht das Original
 *
 * Weil base64 ein Drittel aufschlaegt und ein Post bis zu elf Bilder fuehren
 * kann. Bei 40 bis 50 MB je Datei waeren das ueber ein halbes Gigabyte an
 * Zeichenketten, und dazu je Bild die entpackte Bitmap - ein 8000 x 8000
 * grosses Bild sind 256 MB, unabhaengig von der Dateigroesse. Gespeichert
 * bleibt das Original; gezeichnet wird mit einem Abbild in der Groesse, die
 * ein Export von 1080 x 1920 ueberhaupt nutzen kann.
 *
 * ## Warum ein fehlendes Bild kein Fehler ist
 *
 * Weil eine Grafik ohne Motiv brauchbar ist und eine Fehlermeldung statt
 * einer Grafik nicht. Wurde die Datei geloescht, zeichnet das Geruest den
 * Fall ohne Bild - genau so, wie es ihn auch zeichnet, wenn nie eines
 * ausgewaehlt wurde.
 */
async function alsDatenUri(dateiname: string | undefined): Promise<string | undefined> {
  if (!dateiname) {
    return undefined;
  }
  const datei = await branding.leseBildFuerExport(dateiname);
  if (!datei) {
    return undefined;
  }
  return `data:${branding.CONTENT_TYPE[datei.format]};base64,${datei.data.toString('base64')}`;
}

/**
 * Alle Bilder eines Posts - in einem Durchgang.
 *
 * `Promise.all` und nicht hintereinander: sie wissen nichts voneinander, und
 * sechs Dateien nacheinander zu lesen waere die Summe der Wartezeiten statt
 * der laengsten. Beim ZIP-Export wird diese Funktion **einmal** aufgerufen
 * und das Ergebnis fuer alle drei Formate benutzt - dreimal dieselben Bytes
 * von der Platte zu holen waere zweimal zu viel, und es ist ausserdem die
 * Zusage, dass alle drei Dateien dasselbe Motiv tragen, auch wenn jemand
 * waehrend des Exports etwas austauscht.
 */
export async function ladeBilder(inhalt: socialmedia.PostInhalt): Promise<PostBilder> {
  const [bild, hintergrundbild, logo, teamLogoA, teamLogoB, signet, ...sponsoren] = await Promise.all([
    alsDatenUri(inhalt.bild),
    alsDatenUri(inhalt.hintergrundbild),
    alsDatenUri(inhalt.logo),
    alsDatenUri(inhalt.teams?.logoA),
    alsDatenUri(inhalt.teams?.logoB),
    /*
     * Das SwissHub-Signet kommt **immer** mit.
     *
     * Nicht weil jeder Post es zeigt, sondern damit die Zeichenquelle die
     * Entscheidung treffen kann, ohne selbst Dateien zu lesen - sie beschreibt
     * ein Bild und faehrt nicht auf die Platte. Ob es erscheint, entscheidet
     * der Schalter `branding`; womit es erscheint, entscheidet sich hier.
     *
     * Es laeuft durch dieselbe Funktion wie jedes andere Motiv und wird zur
     * selben Art Wert: eine zweite Bildpipeline gibt es nicht.
     */
    ladeSignet(),
    ...(inhalt.sponsoren ?? []).map((name) => alsDatenUri(name)),
  ]);

  const vorhandeneSponsoren = sponsoren.filter((eintrag): eintrag is string => eintrag !== undefined);

  return {
    ...(bild ? { bild } : {}),
    ...(hintergrundbild ? { hintergrundbild } : {}),
    ...(logo ? { logo } : {}),
    ...(teamLogoA ? { teamLogoA } : {}),
    ...(teamLogoB ? { teamLogoB } : {}),
    ...(signet ? { signet } : {}),
    ...(vorhandeneSponsoren.length > 0 ? { sponsoren: vorhandeneSponsoren } : {}),
  };
}
