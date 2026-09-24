/**
 * Die stabile Adresse eines oeffentlichen Profils.
 *
 * ## Warum nicht der Discord-Name
 *
 * Er aendert sich. Ein Link, den jemand in eine Signatur schreibt oder in
 * einen Chat stellt, soll das ueberleben - und er soll nicht auf einmal auf
 * ein fremdes Profil zeigen, weil jemand anderes den frei gewordenen Namen
 * uebernommen hat. Der Slug entsteht **einmal** aus dem Namen und bleibt
 * danach stehen.
 *
 * ## Warum nicht die Discord-Kennung
 *
 * `/u/193847362019283746` ist keine Adresse, die man jemandem vorliest.
 * Intern bleibt die Kennung der Schluessel; in der Adresse steht ein Name.
 */

/** Was in einer Adresse stehen darf. Klein, ohne Umlaute, ohne Leerzeichen. */
const ERLAUBT = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/u;

/**
 * Adressen, die nicht als Slug vergeben werden duerfen.
 *
 * Unter `/u/` liegt heute nur das Profil. Die Liste steht trotzdem: sie
 * kostet nichts, und ein spaeter dazukommendes `/u/einstellungen` waere
 * sonst von einem Mitglied belegt, das sich frueh «einstellungen» genommen
 * hat.
 */
const GESPERRT = new Set([
  'admin',
  'api',
  'einstellungen',
  'hilfe',
  'impressum',
  'login',
  'logout',
  'me',
  'neu',
  'profil',
  'profile',
  'settings',
  'support',
  'system',
  'u',
]);

/** Ist das ein Slug, den wir vergeben oder nachschlagen wuerden? */
export function istGueltigerSlug(wert: string): boolean {
  return ERLAUBT.test(wert) && !GESPERRT.has(wert);
}

/**
 * Aus einem Namen einen Slug-Vorschlag machen.
 *
 * Umlaute werden ausgeschrieben und nicht weggeworfen: aus «Müller» wird
 * `mueller` und nicht `mller`. Alles andere, was nicht erlaubt ist, wird zu
 * einem Bindestrich; mehrere in Folge fallen zu einem zusammen.
 *
 * Bleibt nichts Brauchbares uebrig - ein Name aus lauter Zeichen, die es
 * nicht durch den Filter schaffen -, gibt es `null`. Der Aufrufer braucht
 * dann einen anderen Ausgangspunkt; hier etwas zu erfinden hiesse, jemandem
 * eine Adresse zu geben, die mit seinem Namen nichts zu tun hat.
 */
export function slugVorschlag(name: string): string | null {
  const ersetzt = name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    // Was die Normalisierung abgetrennt hat - Akzente und dergleichen.
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32)
    .replace(/-+$/u, '');

  if (ersetzt.length < 2 || GESPERRT.has(ersetzt)) {
    return null;
  }
  return ERLAUBT.test(ersetzt) ? ersetzt : null;
}

/**
 * Aus einem Vorschlag einen freien Slug machen.
 *
 * `istFrei` fragt die Datenbank. Bei einer Kollision kommt eine Zahl dazu -
 * `manu`, `manu-2`, `manu-3`. Nach zwanzig Versuchen gibt es `null`: wer
 * dann noch keinen freien gefunden hat, laeuft gegen etwas anderes als
 * Zufall, und eine Schleife ohne Ende waere die schlechtere Antwort.
 *
 * Die Eindeutigkeit in der Datenbank bleibt der eigentliche Riegel - zwei
 * gleichzeitige Anfragen koennen hier beide dasselbe «frei» sehen. Der
 * Aufrufer faengt P2002 ab und versucht es erneut.
 */
export async function findeFreienSlug(
  vorschlag: string,
  istFrei: (slug: string) => Promise<boolean>,
): Promise<string | null> {
  if (!istGueltigerSlug(vorschlag)) {
    return null;
  }
  if (await istFrei(vorschlag)) {
    return vorschlag;
  }
  for (let zaehler = 2; zaehler <= 20; zaehler += 1) {
    // Der Anhang darf die Laenge nicht sprengen.
    const gekuerzt = vorschlag.slice(0, 32 - String(zaehler).length - 1).replace(/-+$/u, '');
    const kandidat = `${gekuerzt}-${zaehler}`;
    if (istGueltigerSlug(kandidat) && (await istFrei(kandidat))) {
      return kandidat;
    }
  }
  return null;
}
