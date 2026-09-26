'use client';

/**
 * Ein Clip in seiner Fläche - als Rahmen oder als Videoelement.
 *
 * ## Warum das eine Komponente ist
 *
 * Weil es fünf Stellen gibt, die einen Clip zeigen: der Player im Dialog, die
 * Vorschau im Einreich-Assistenten, die Moderationsliste, die Gewinnerbühne
 * und die Zufallsansicht. Vor den Uploads war das an jeder Stelle dasselbe
 * `iframe` und die Wiederholung harmlos.
 *
 * Mit Uploads ist es eine **Entscheidung** - `iframe` oder `<video>` -, und
 * eine Entscheidung an fünf Stellen ist eine Stelle, die man beim nächsten Mal
 * vergisst. Vergessen hiesse hier: die Moderation sieht eine leere Fläche und
 * gibt einen Clip frei, den sie nicht gesehen hat.
 *
 * ## Warum kein `iframe` für eigene Dateien
 *
 * Die Datei liegt auf unserer Domain. Ein Rahmen darauf wäre ein Rahmen mit
 * unseren Cookies darin. Ein `<video>` kann dagegen kein HTML darstellen und
 * kein Skript ausführen - was auch immer in der Datei steht, es bleibt ein
 * Video oder es bleibt schwarz.
 *
 * ## Warum das `iframe` bleibt, wo es hingehört
 *
 * Twitch, YouTube und Medal liefern einen Player, nicht eine Datei. Die
 * Adresse dafür ist in `erkenneClip()` **gebaut** worden - aus Anbieter und
 * Kennung, nie aus der Eingabe -, und die Content Security Policy lässt
 * ohnehin nur diese Hosts in einen Rahmen.
 */
export function ClipRahmen({
  provider,
  adresse,
  titel,
  klasse = 'aspect-video w-full',
  autoplayErlaubt = false,
  spaetLaden = false,
  schluessel,
}: {
  /** `twitch`, `youtube`, `medal` oder `upload`. */
  provider: string;
  /** Die Einbettungsadresse - bei Uploads die interne Dateiroute. */
  adresse: string;
  titel: string;
  klasse?: string;
  /**
   * Darf der Player von selbst starten?
   *
   * Nur dort, wo ein Clip die ganze Aufmerksamkeit hat - Gewinnerbühne,
   * Zufallsansicht. In einer Liste von zwanzig Karten wäre es Lärm. Gilt nur
   * für das `iframe`: eigene Dateien starten nie von selbst.
   */
  autoplayErlaubt?: boolean;
  spaetLaden?: boolean;
  /** Erzwingt einen Neuaufbau, wenn sich der Clip ändert. */
  schluessel?: string;
}): React.JSX.Element {
  if (provider === 'upload') {
    return (
      /*
       * `preload="metadata"`: Länge und erstes Bild, nicht die Datei. Bei
       * hundert Megabyte ist das der Unterschied zwischen einer Liste, die
       * sofort steht, und einer, die erst ein halbes Gigabyte holt.
       *
       * Kein `autoPlay`: ein Video, das von selbst losgeht, ist im besten Fall
       * überraschend und im schlechtesten laut.
       */
      <video
        key={schluessel}
        src={adresse}
        title={titel}
        controls
        preload="metadata"
        playsInline
        className={`${klasse} bg-black`}
      >
        <track kind="captions" />
      </video>
    );
  }

  return (
    <iframe
      key={schluessel}
      src={adresse}
      title={titel}
      className={klasse}
      allow={
        autoplayErlaubt
          ? 'autoplay; fullscreen; encrypted-media; picture-in-picture'
          : 'fullscreen; encrypted-media; picture-in-picture'
      }
      allowFullScreen
      /*
       * Skripte braucht der Player, sonst spielt er nicht. `allow-same-origin`
       * meint den Ursprung des Players - twitch.tv, youtube-nocookie.com,
       * medal.tv -, nicht unseren. Was fehlt, ist Absicht: keine Formulare,
       * keine Navigation der Hauptseite, kein Download.
       */
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      referrerPolicy="strict-origin-when-cross-origin"
      loading={spaetLaden ? 'lazy' : undefined}
    />
  );
}

/**
 * Der Hinweis, der bei Medal unter dem Player steht.
 *
 * Medal setzt `X-Frame-Options` nicht überall gleich, und ob ein Rahmen
 * abgewiesen wurde, ist von aussen nicht zuverlässig festzustellen: `onLoad`
 * feuert auch dann. Statt einer Erkennung, die sich irrt, ein Satz, der sagt,
 * was zu tun ist - und der Weg zum Anbieter steht daneben.
 *
 * Ausdrücklich keine Umgehung der Beschränkung. Wer sie setzt, hat dafür einen
 * Grund, und ein Proxy um sie herum wäre genau das, was sie verhindern soll.
 */
export function MedalHinweis({ provider }: { provider: string }): React.JSX.Element | null {
  if (provider !== 'medal') {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground">
      Medal erlaubt das Einbetten nicht auf jeder Seite. Bleibt der Player leer, öffne den Clip direkt bei
      Medal.
    </p>
  );
}
