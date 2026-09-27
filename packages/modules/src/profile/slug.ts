/**
 * Die stabile Adresse eines oeffentlichen Profils.
 *
 * ## Warum nicht der Discord-Name
 *
 * Er aendert sich. Ein Link, den jemand in eine Signatur schreibt oder in
 * einen Chat stellt, soll das ueberleben - und er soll nicht auf einmal auf
 * ein fremdes Profil zeigen, weil jemand anderes den frei gewordenen Namen
 * uebernommen hat. Der Slug entsteht **einmal** aus dem Namen; danach aendert
 * ihn nur, wer ihn selbst aendert.
 *
 * ## Warum nicht die Discord-Kennung
 *
 * `/u/193847362019283746` ist keine Adresse, die man jemandem vorliest.
 * Intern bleibt die Kennung der Schluessel; in der Adresse steht ein Name.
 *
 * ## Und was beim Aendern passiert
 *
 * Der alte Slug bleibt als Alias stehen und leitet weiter - ein Link in einer
 * Twitch-Bio oder ein gedruckter QR-Code lassen sich nicht einsammeln. Er wird
 * dabei **nie wieder vergeben**: waere er frei, koennte jemand anders ihn
 * nehmen, und ein alter Link fuehrte auf ein fremdes Profil. Das ist der
 * eigentliche Grund fuer `MemberProfileSlugAlias`, nicht die Weiterleitung.
 */

/**
 * Was in einer Adresse stehen darf. Klein, ohne Umlaute, ohne Leerzeichen.
 *
 * Zwei bis 32 Zeichen, Anfang und Ende alphanumerisch, Bindestriche nur
 * dazwischen. Das ist genau, was die Grenzen unten sagen - und einmal war es
 * das nicht: die frueherer Fassung `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$`
 * liess ein **einzelnes** Zeichen durch und lehnte dafuer jeden Slug mit
 * genau zwei ab. Ein Mitglied namens «Ab» bekam deshalb `mitglied-<zufall>`,
 * und ein einbuchstabiger Slug liess sich nachschlagen, obwohl keiner
 * entstehen konnte. `tests/unit/profil-url.test.ts` haelt beides fest.
 */
const ERLAUBT = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/u;

/** Die Grenzen, die auch die Oberflaeche nennt. */
export const SLUG_MIN_LAENGE = 2;
export const SLUG_MAX_LAENGE = 32;

/**
 * Adressen, die nicht als Slug vergeben werden duerfen.
 *
 * ## Woraus die Liste besteht
 *
 * Erstens aus allem, was neben `/u/` liegt: die oeffentlichen Bereiche der
 * Anwendung. Zweitens aus den internen Bereichen unter `(app)` - heute liegen
 * sie nicht unter `/u/`, aber ein Mitglied, das `dashboard` heisst, ist eine
 * Verwechslung, die niemand braucht. Drittens aus Namen, die nach SwissHub
 * selbst klingen: wer `swisshub` oder `admin` heisst, kann sich als die
 * Plattform ausgeben.
 *
 * `tests/unit/profil-url.test.ts` vergleicht die erste Gruppe mit den
 * tatsaechlichen Ordnern in `apps/web/src/app`. Ein neuer oeffentlicher
 * Bereich faellt damit auf, statt still von einem Mitglied belegt zu sein.
 */
const GESPERRT = new Set([
  // Oeffentliche Bereiche neben `/u/`.
  '403',
  'access-denied',
  'api',
  'discord-unavailable',
  'entbannung',
  'leaderboard',
  'login',
  'premium',
  'setup',
  'streamer',
  'turniere',
  'u',
  'wrapped',
  'wrapped-buehne',
  // Interne Bereiche unter `(app)`.
  'analytics',
  'appeals',
  'audit',
  'automationen',
  'clips',
  'communication',
  'dashboard',
  'entdecken',
  'fragt',
  'jail',
  'kalender',
  'level',
  'members',
  'migrate',
  'moderation',
  'modules',
  'musik',
  'profil',
  'profile',
  'server',
  'settings',
  'spieler',
  'streamer-hub',
  'system',
  'tickets',
  'verifikation',
  'voice',
  'vorschau',
  'vote-jail',
  'was-spielen-wir',
  'xp-gluecksrad',
  // Namen, unter denen sich jemand als die Plattform ausgeben koennte.
  'admin',
  'administrator',
  'help',
  'hilfe',
  'impressum',
  'me',
  'mod',
  'moderator',
  'neu',
  'offiziell',
  'official',
  'robots',
  'root',
  'sitemap',
  'support',
  'swisshub',
  'team',
]);

/** Die gesperrten Namen - fuer die Pruefung im Test und die Anzeige im Editor. */
export function gesperrteSlugs(): readonly string[] {
  return [...GESPERRT].sort();
}

/** Ist das ein Slug, den wir vergeben oder nachschlagen wuerden? */
export function istGueltigerSlug(wert: string): boolean {
  return ERLAUBT.test(wert) && !GESPERRT.has(wert);
}

/**
 * Warum ein Wunschslug nicht geht - als Satz fuer die Person davor.
 *
 * `null` heisst: er geht. Getrennt von `istGueltigerSlug`, weil die Pruefung
 * beim **Nachschlagen** keinen Text braucht (dort gibt es nur 404) und die
 * Pruefung beim **Aendern** ohne Text nutzlos ist - «ungueltig» sagt niemandem,
 * was zu tun ist.
 */
export function slugBeanstandung(roh: string): string | null {
  const wert = roh.trim().toLowerCase();
  if (wert.length === 0) {
    return 'Gib eine Adresse an.';
  }
  if (wert.length < SLUG_MIN_LAENGE) {
    return `Die Adresse braucht mindestens ${SLUG_MIN_LAENGE} Zeichen.`;
  }
  if (wert.length > SLUG_MAX_LAENGE) {
    return `Die Adresse darf höchstens ${SLUG_MAX_LAENGE} Zeichen haben.`;
  }
  if (GESPERRT.has(wert)) {
    return 'Diese Adresse ist für SwissHub reserviert.';
  }
  if (!ERLAUBT.test(wert)) {
    return 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche - nicht am Anfang oder Ende.';
  }
  return null;
}

/**
 * Eine Eingabe in die Form bringen, in der sie gespeichert wird.
 *
 * Nur Kleinschreibung und Rand-Leerzeichen: hier wird **nicht** geraten. Wer
 * «Manu Müller» eintippt, soll eine Beanstandung lesen und nicht stillschweigend
 * `manu-mueller` bekommen - eine Adresse, die man nicht selbst gewaehlt hat,
 * ueberrascht beim ersten Teilen.
 *
 * Geraten wird ausschliesslich im Vorschlag (`slugVorschlag`), und der ist ein
 * Vorschlag.
 */
export function normalisiereSlug(roh: string): string {
  return roh.trim().toLowerCase();
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
    /*
     * Als Escape und nicht als Zeichen.
     *
     * SwissHub schreibt «ss», und ein Test haelt das im ganzen Quelltext
     * durch. Hier geht es aber nicht darum, wie wir schreiben, sondern
     * darum, was ein Discord-Name enthalten kann - und deutsche Namen
     * enthalten das Zeichen. Der Escape unten ist dasselbe Zeichen, ohne im
     * Quelltext zu stehen.
     */
    .replaceAll('\u00df', 'ss')
    .normalize('NFD')
    // Was die Normalisierung abgetrennt hat - Akzente und dergleichen.
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SLUG_MAX_LAENGE)
    .replace(/-+$/u, '');

  if (ersetzt.length < SLUG_MIN_LAENGE || GESPERRT.has(ersetzt)) {
    return null;
  }
  return ERLAUBT.test(ersetzt) ? ersetzt : null;
}

/**
 * Aus einem Vorschlag einen freien Slug machen.
 *
 * `istFrei` fragt die Datenbank - und zwar nach **beidem**: dem Slug eines
 * Profils und einem Alias. Ein frueher vergebener Slug bleibt belegt, sonst
 * fuehrte ein alter Link auf ein fremdes Profil.
 *
 * Bei einer Kollision kommt eine Zahl dazu - `manu`, `manu-2`, `manu-3`. Nach
 * zwanzig Versuchen gibt es `null`: wer dann noch keinen freien gefunden hat,
 * laeuft gegen etwas anderes als Zufall, und eine Schleife ohne Ende waere die
 * schlechtere Antwort.
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
    const gekuerzt = vorschlag.slice(0, SLUG_MAX_LAENGE - String(zaehler).length - 1).replace(/-+$/u, '');
    const kandidat = `${gekuerzt}-${zaehler}`;
    if (istGueltigerSlug(kandidat) && (await istFrei(kandidat))) {
      return kandidat;
    }
  }
  return null;
}
