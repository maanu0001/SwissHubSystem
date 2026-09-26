import { AppError } from '@swisshub/shared';

/**
 * Welche Clip-Adressen angenommen werden - und was daraus wird.
 *
 * ## Warum eine Liste und kein Muster
 *
 * Eine eingereichte Adresse ist Eingabe von aussen. Sie landet in einem
 * `iframe` und bestimmt, was der Server abruft; beides sind Wege, auf denen
 * eine falsche Adresse Schaden anrichtet.
 *
 * Deshalb wird sie nicht geprueft, sondern **zerlegt**: aus der Eingabe wird
 * ein Anbieter und eine Kennung, und aus diesen beiden entsteht alles
 * weitere. Die eingegebene Zeichenkette erreicht weder das `iframe` noch
 * einen Abruf. Sie kann deshalb auch nicht auf `localhost`, in ein privates
 * Netz oder auf einen Metadatendienst zeigen - dafuer muesste sie irgendwo
 * durchgereicht werden, und das geschieht nirgends.
 *
 * Eine Weiterleitung kann es aus demselben Grund nicht geben: gefolgt wird
 * keiner.
 *
 * ## Warum nicht mehr Anbieter
 *
 * Weil jeder weitere Anbieter eine weitere Einbettung ist, die in der
 * Content Security Policy stehen muss. Twitch, YouTube und Medal decken ab,
 * woher Gaming-Clips kommen; alles andere waere eine Liste, die waechst, ohne
 * dass jemand sie prueft.
 */

/**
 * Woher ein Clip kommt.
 *
 * `upload` ist kein Anbieter im Sinne der uebrigen: es gibt keine fremde
 * Adresse zu zerlegen, weil die Datei bei uns liegt. Der Wert steht hier
 * trotzdem, damit jede Stelle, die einen Clip anzeigt, an einer einzigen
 * Angabe erkennt, ob sie ein `iframe` oder ein `video`-Element braucht.
 */
export type ClipProvider = 'twitch' | 'youtube' | 'medal' | 'upload';

/** Die Anbieter mit fremden Adressen - nur sie brauchen eine Hostliste. */
type AdressAnbieter = Exclude<ClipProvider, 'upload'>;

export interface ErkannterClip {
  provider: ClipProvider;
  sourceType: 'TWITCH_CLIP' | 'YOUTUBE' | 'MEDAL' | 'UPLOAD';
  /** Die Kennung beim Anbieter - daran wird ein Duplikat erkannt. */
  externalId: string;
  /** Die auf eine Form gebrachte Adresse, ohne Tracking-Parameter. */
  canonicalUrl: string;
  /** Wird ausschliesslich aus Anbieter und Kennung gebaut. */
  embedUrl: string;
  /** Vorschaubild, soweit es sich ohne Abruf ableiten laesst. */
  thumbnailUrl: string | null;
}

/** Erlaubte Hosts je Anbieter. Alles andere wird abgelehnt. */
const HOSTS: Record<AdressAnbieter, ReadonlySet<string>> = {
  twitch: new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']),
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']),
  medal: new Set(['medal.tv', 'www.medal.tv']),
};

/** Twitch-Clip-Kennungen sind Woerter aus Buchstaben, Ziffern und Bindestrichen. */
const TWITCH_ID = /^[A-Za-z0-9_-]{4,120}$/u;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
/*
 * Medal-Clips tragen zwei Teile: eine Nummer und ein kurzes Wort.
 *
 * Beide gehoeren zusammen - das Wort ist der Zugriffstoken, ohne den der
 * Player nichts abspielt. Sie werden getrennt geprueft und zusammen
 * gespeichert.
 */
const MEDAL_ID = /^[0-9]{1,20}$/u;
const MEDAL_TOKEN = /^[A-Za-z0-9_-]{4,40}$/u;

function fehler(nachricht: string): never {
  throw new AppError('VALIDATION_FAILED', { userMessage: nachricht });
}

/**
 * Eine eingegebene Adresse zerlegen.
 *
 * Wirft mit einer Meldung, die jemandem weiterhilft - nicht mit einem
 * Schemafehler.
 */
export function erkenneClip(eingabe: string): ErkannterClip {
  const roh = eingabe.trim();
  if (roh.length === 0) {
    fehler('Bitte den Link zum Clip einfügen.');
  }

  let adresse: URL;
  try {
    adresse = new URL(roh);
  } catch {
    fehler('Das sieht nicht nach einem Link aus. Füge die vollständige Adresse des Clips ein.');
  }

  // Nur `https`. `http` waere ein unverschluesselter Abruf, und alles andere -
  // `file:`, `ftp:`, `javascript:` - hat in einem Link zu einem Clip nichts
  // zu suchen.
  if (adresse.protocol !== 'https:') {
    fehler('Nur Links mit https werden angenommen.');
  }

  const host = adresse.hostname.toLowerCase();

  if (HOSTS.twitch.has(host)) {
    return twitch(adresse);
  }
  if (HOSTS.youtube.has(host)) {
    return youtube(adresse);
  }
  if (HOSTS.medal.has(host)) {
    return medal(adresse);
  }

  fehler('Zurzeit werden Clips von Twitch, YouTube und Medal angenommen.');
}

function twitch(adresse: URL): ErkannterClip {
  /*
   * Twitch kennt zwei Formen:
   *   clips.twitch.tv/<slug>
   *   twitch.tv/<kanal>/clip/<slug>
   * Beide meinen denselben Clip - und genau deshalb wird der Slug
   * herausgezogen und nicht die Adresse verglichen. Sonst waere derselbe
   * Clip ueber zwei Adressen zweimal einreichbar.
   */
  const teile = adresse.pathname.split('/').filter(Boolean);
  const slug =
    adresse.hostname.toLowerCase() === 'clips.twitch.tv'
      ? teile[0]
      : teile[1] === 'clip'
        ? teile[2]
        : undefined;

  if (!slug || !TWITCH_ID.test(slug)) {
    fehler('Dieser Twitch-Link enthält keinen Clip. Kopiere den Link direkt aus dem Clip.');
  }

  return {
    provider: 'twitch',
    sourceType: 'TWITCH_CLIP',
    externalId: slug,
    canonicalUrl: `https://clips.twitch.tv/${slug}`,
    // `parent` traegt Twitch die einbettende Seite nach - ohne sie verweigert
    // der Player die Wiedergabe. Sie wird beim Rendern ergaenzt, damit hier
    // keine Adresse steht, die vom Betriebsort abhaengt.
    embedUrl: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&autoplay=false`,
    thumbnailUrl: null,
  };
}

function youtube(adresse: URL): ErkannterClip {
  const host = adresse.hostname.toLowerCase();
  const teile = adresse.pathname.split('/').filter(Boolean);

  /*
   * YouTube kennt vier Formen: `watch?v=`, `youtu.be/<id>`, `/shorts/<id>`
   * und `/embed/<id>`. Alle vier meinen dasselbe Video.
   */
  const kennung = host.endsWith('youtu.be')
    ? teile[0]
    : teile[0] === 'shorts' || teile[0] === 'embed' || teile[0] === 'live'
      ? teile[1]
      : (adresse.searchParams.get('v') ?? undefined);

  if (!kennung || !YOUTUBE_ID.test(kennung)) {
    fehler('Dieser YouTube-Link enthält kein Video. Kopiere den Link direkt aus dem Video.');
  }

  return {
    provider: 'youtube',
    sourceType: 'YOUTUBE',
    externalId: kennung,
    canonicalUrl: `https://www.youtube.com/watch?v=${kennung}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${kennung}`,
    // YouTubes Vorschaubilder folgen einer festen Regel und brauchen keinen
    // Abruf. Bei Twitch ist das nicht so - dort bleibt es leer, statt eine
    // Adresse zu raten, die ein kaputtes Bild waere.
    thumbnailUrl: `https://i.ytimg.com/vi/${kennung}/hqdefault.jpg`,
  };
}

/**
 * Ein Medal-Clip.
 *
 * ## Die Adressformen
 *
 * Medal zeigt Clips unter mehreren Pfaden, die alle dieselben zwei Teile
 * tragen - eine Nummer und einen kurzen Token:
 *
 *     medal.tv/clip/4954893/vpkPnOp0o                 (die Einbettungsform)
 *     medal.tv/clips/4954893/vpkPnOp0o
 *     medal.tv/games/valorant/clips/4954893/vpkPnOp0o
 *
 * Gesucht wird darum nicht ein Pfad, sondern das Paar am Ende: die letzten
 * zwei Segmente hinter einem `clip`- oder `clips`-Segment. Ein Profillink,
 * ein Spiellink oder die Startseite enthalten dieses Paar nicht und werden
 * abgelehnt.
 *
 * ## Woher das Einbettungsformat kommt
 *
 * Aus Medals Entwicklerdokumentation (docs.medal.tv/player.html): der Player
 * laeuft unter `https://medal.tv/clip/<id>/<token>` und nimmt `autoplay`,
 * `muted`, `loop` und `steamappid` als Parameter.
 *
 * Gesetzt werden `autoplay=0` und `loop=0`. Die Vorgabe von Medal ist
 * automatische, stumme Wiedergabe in Dauerschleife - in einer Liste mit
 * mehreren Einreichungen waere das eine Seite, auf der alles gleichzeitig
 * losgeht. `muted` bleibt ungesetzt, damit der Ton beim bewussten Start da
 * ist; wer nicht startet, hoert nichts.
 *
 * **Nicht verifiziert:** dass die Nummer und der Token von einer
 * oeffentlichen Clipseite unveraendert in die Einbettungsform passen. Das
 * Muster der beiden Segmente ist identisch, und die dokumentierte
 * Einbettungsadresse hat dieselbe Gestalt - aber geprueft ist es an einem
 * echten Link erst, wenn einer eingereicht wurde. Scheitert die Einbettung,
 * bleibt der sichere aeussere Link stehen: `canonicalUrl` zeigt auf die
 * Clipseite, und die Oberflaeche zeigt sie an, wenn der Rahmen leer bleibt.
 */
function medal(adresse: URL): ErkannterClip {
  const teile = adresse.pathname.split('/').filter(Boolean);
  const stelle = teile.findIndex((segment) => segment === 'clip' || segment === 'clips');

  const nummer = stelle === -1 ? undefined : teile[stelle + 1];
  const token = stelle === -1 ? undefined : teile[stelle + 2];

  if (!nummer || !token || !MEDAL_ID.test(nummer) || !MEDAL_TOKEN.test(token)) {
    fehler(
      'Dieser Medal-Link enthält keinen Clip. Öffne den Clip auf medal.tv und kopiere den Link aus der Adresszeile - er endet auf eine Nummer und ein kurzes Kürzel.',
    );
  }

  /*
   * Beide Teile zusammen sind die Kennung.
   *
   * Nicht die Nummer allein: ohne den Token liesse sich die
   * Einbettungsadresse nicht wieder bauen, und ein Duplikat waere an der
   * Nummer zwar erkennbar, der Clip danach aber nicht abspielbar.
   */
  const kennung = `${nummer}/${token}`;

  return {
    provider: 'medal',
    sourceType: 'MEDAL',
    externalId: kennung,
    canonicalUrl: `https://medal.tv/clips/${kennung}`,
    embedUrl: `https://medal.tv/clip/${kennung}?autoplay=0&loop=0`,
    /*
     * Kein Vorschaubild.
     *
     * Medal hat keine aus der Kennung ableitbare Bildadresse - eines zu
     * raten waere ein kaputtes Bild an einer Stelle, an der ein leerer
     * Platz besser aussieht. Ein Abruf kommt nicht in Frage: er waere der
     * erste Server-Request auf eine von aussen bestimmte Adresse, und genau
     * das vermeidet dieses Modul.
     */
    thumbnailUrl: null,
  };
}

/**
 * Ein hochgeladener Clip - als `ErkannterClip`, damit der Einreichungsweg
 * unveraendert bleibt.
 *
 * ## Warum hier und nicht im Dienst
 *
 * Weil dieses Modul die eine Stelle ist, an der entsteht, was spaeter
 * angezeigt wird. Eine zweite Stelle, die Adressen fuer Clips baut, waere
 * eine zweite Vorstellung davon, was eine Clipadresse ist - und die
 * gefaehrlichere von beiden, weil niemand sie so genau ansieht wie diese.
 *
 * ## Der Dateiname ist die Kennung
 *
 * Er entsteht aus 16 Zufallsbytes und ist damit eindeutig. Das hat eine
 * Folge, die Absicht ist: zweimal dieselbe Datei hochgeladen ergibt zwei
 * Clips. Ein Abgleich am Inhalt waere eine Pruefsumme ueber 100 MB je
 * Einreichung, und er wuerde zwei Ausschnitte desselben Spiels ohnehin nicht
 * als dasselbe erkennen. Die Moderation sieht doppelte Einreichungen und
 * entscheidet - das ist der Weg, den dieses Modul schon fuer inhaltliche
 * Fragen vorsieht.
 *
 * ## Die Adresse ist intern
 *
 * `/api/clips/datei/<name>` - ein Route Handler mit festem Content-Type. Die
 * Datei liegt ausserhalb von `public` und wird nie statisch bedient; eine als
 * `.mp4` gespeicherte HTML-Datei koennte sonst als Seite auf der eigenen
 * Domain laufen.
 */
export function erkenneUpload(dateiname: string, container: 'mp4' | 'webm'): ErkannterClip {
  /*
   * Auch hier geprueft, obwohl der Name selbst erzeugt wurde.
   *
   * Diese Funktion ist `export`, und der naechste Aufrufer in zwei Jahren
   * weiss nicht, woher sein Name kommt. Ein Muster kostet nichts und macht
   * aus einem kuenftigen Fehler einen sauberen Fehlschlag statt einer
   * Adresse, die auf etwas anderes zeigt.
   *
   * Geprueft wird gegen den **uebergebenen Container**, nicht gegen
   * `mp4|webm`: so faellt auch der Fall auf, in dem Name und erkannter
   * Inhalt auseinanderlaufen - eine als `.mp4` abgelegte WebM-Datei wuerde
   * mit festem Content-Type falsch ausgeliefert.
   */
  if (!new RegExp(`^clip-[0-9a-f]{32}\\.${container}$`, 'u').test(dateiname)) {
    fehler('Diese Datei ist nicht bekannt.');
  }

  const adresse = `/api/clips/datei/${dateiname}`;
  return {
    provider: 'upload',
    sourceType: 'UPLOAD',
    externalId: dateiname,
    canonicalUrl: adresse,
    embedUrl: adresse,
    // Ein Vorschaubild waere ein Einzelbild aus dem Video - das braucht einen
    // Decoder, und den gibt es hier nicht. Ein leerer Platz ist ehrlicher.
    thumbnailUrl: null,
  };
}

/**
 * Die Adresse zum Einbetten, fertig fuer ein `iframe`.
 *
 * Twitch verlangt den Hostnamen der einbettenden Seite. Er kommt von aussen
 * herein - aus der zentralen Adresskonfiguration - und nicht aus der
 * Eingabe.
 */
export function einbettung(clip: { provider: string; embedUrl: string }, hostname: string): string {
  if (clip.provider !== 'twitch') {
    return clip.embedUrl;
  }
  return `${clip.embedUrl}&parent=${encodeURIComponent(hostname)}`;
}

/** Die Hosts, die in der Content Security Policy stehen muessen. */
export const EINBETTUNGS_HOSTS = [
  'https://clips.twitch.tv',
  'https://player.twitch.tv',
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://medal.tv',
] as const;
