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
 * Content Security Policy stehen muss. Twitch und YouTube decken ab, woher
 * Gaming-Clips kommen; alles andere waere eine Liste, die waechst, ohne dass
 * jemand sie prueft.
 */

export type ClipProvider = 'twitch' | 'youtube';

export interface ErkannterClip {
  provider: ClipProvider;
  sourceType: 'TWITCH_CLIP' | 'YOUTUBE';
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
const HOSTS: Record<ClipProvider, ReadonlySet<string>> = {
  twitch: new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']),
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']),
};

/** Twitch-Clip-Kennungen sind Woerter aus Buchstaben, Ziffern und Bindestrichen. */
const TWITCH_ID = /^[A-Za-z0-9_-]{4,120}$/u;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;

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

  fehler('Zurzeit werden nur Clips von Twitch und YouTube angenommen.');
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
] as const;
