'use client';

import { useEffect, useRef, useState } from 'react';
import { avatarSizeFor, defaultAvatarUrl, getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { formatSwissNumber } from '@swisshub/shared';
import { cn } from '@/lib/utils';

/**
 * Die Bausteine, aus denen jede Szene besteht.
 *
 * Vier Stueck - mehr braucht es nicht, und mehr waere der Anfang eines
 * Baukastens fuer Dashboards. Was eine Szene besonders macht, ist ihre
 * Komposition, nicht ein weiteres Bauteil.
 */

/**
 * Der Rahmen einer Szene.
 *
 * Alles, was sichere Abstaende und die Ausrichtung betrifft, steht hier
 * einmal: die Einbuchtungen des Geraets oben und unten, die Randabstaende
 * auf schmalen Schirmen, die Mitte.
 *
 * `ausrichtung` ist die einzige Stellschraube: manche Szenen leben davon,
 * dass die Zahl mittig steht, andere davon, dass der Blick links beginnt.
 */
export function SzenenRahmen({
  children,
  ausrichtung = 'mitte',
  className,
}: {
  children: React.ReactNode;
  ausrichtung?: 'mitte' | 'links' | 'unten';
  className?: string;
}): React.JSX.Element {
  return (
    <section
      className={cn(
        'flex h-full w-full flex-col px-6 sm:px-10',
        // Oben Platz fuer Fortschritt und Kopfzeile, unten fuer die
        // Einbuchtung des Geraets.
        'pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+2.5rem))] pt-[max(5.5rem,calc(env(safe-area-inset-top)+4.5rem))]',
        ausrichtung === 'mitte' && 'items-center justify-center text-center',
        ausrichtung === 'links' && 'items-start justify-center text-left',
        ausrichtung === 'unten' && 'items-start justify-end text-left',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </section>
  );
}

/**
 * Die grosse Zahl.
 *
 * ## Warum sie hochzaehlt
 *
 * Weil eine Zahl, die einfach dasteht, eine Angabe ist - und eine, die
 * hochlaeuft, ein Ereignis. Das ist der ganze Unterschied zwischen
 * «Voice-Zeit: 187h» und «187».
 *
 * ## Warum ueber `requestAnimationFrame` und nicht mit einem Zeitgeber
 *
 * Ein Intervall von 16 ms laeuft auf einem langsamen Geraet aus dem Takt und
 * zaehlt sichtbar unregelmaessig. `requestAnimationFrame` gibt den
 * tatsaechlich vergangenen Anteil, und die Zahl kommt exakt am Ende an -
 * auch wenn dazwischen Bilder ausgefallen sind.
 *
 * ## Bei reduzierter Bewegung
 *
 * Steht die Zahl sofort da. Sie ist die Information; das Hochzaehlen ist nur
 * ihre Inszenierung.
 */
export function ZaehlZahl({
  wert,
  dauer = 1600,
  verzug = 200,
  stillstand = false,
  className,
  praefix = '',
  suffix = '',
}: {
  wert: number;
  dauer?: number;
  verzug?: number;
  stillstand?: boolean;
  className?: string;
  praefix?: string;
  suffix?: string;
}): React.JSX.Element {
  const [stand, setStand] = useState(stillstand ? wert : 0);
  const bild = useRef<number | null>(null);

  useEffect(() => {
    if (stillstand) {
      setStand(wert);
      return;
    }
    let beginn: number | null = null;
    const start = window.setTimeout(() => {
      const schritt = (jetzt: number): void => {
        beginn ??= jetzt;
        const anteil = Math.min(1, (jetzt - beginn) / dauer);
        // Weich ausbremsen - die letzten Ziffern sollen einrasten, nicht
        // durchrauschen.
        const geglaettet = 1 - (1 - anteil) ** 3;
        setStand(Math.round(wert * geglaettet));
        if (anteil < 1) {
          bild.current = window.requestAnimationFrame(schritt);
        }
      };
      bild.current = window.requestAnimationFrame(schritt);
    }, verzug);

    return () => {
      window.clearTimeout(start);
      if (bild.current !== null) {
        window.cancelAnimationFrame(bild.current);
      }
    };
  }, [wert, dauer, verzug, stillstand]);

  // Die Breite richtet sich nach dem **Endwert**, nicht nach dem Zwischenstand -
  // sonst schrumpfte die Zahl waehrend des Hochzaehlens.
  const vollstaendig = `${praefix}${formatSwissNumber(wert)}${suffix}`;

  return (
    <span className={cn('w-zahl block', className)} style={enge(vollstaendig)}>
      {praefix}
      {formatSwissNumber(stand)}
      {suffix}
    </span>
  );
}

/**
 * Lange Zahlen kleiner setzen.
 *
 * ## Warum
 *
 * `.w-zahl` ist auf die Breite des Schirms gerechnet, nicht auf die Laenge
 * der Zahl. Bei «187» passt das; bei «999'999» lief die Zahl links und
 * rechts aus dem Bild heraus - nicht als Scrollbalken, sondern abgeschnitten,
 * weil die Buehne alles abschneidet, was ueber den Rand geht. Ein Wert, den
 * man nicht ganz lesen kann, ist schlimmer als ein kleinerer Wert.
 *
 * ## Wie
 *
 * Bis fuenf Zeichen bleibt alles, wie es war. Danach faellt die Groesse mit
 * der Laenge - ein Faktor auf die bestehende `clamp()`-Rechnung, damit
 * Kleinstschirm, Telefon und Desktop weiter ihre eigenen Groessen behalten.
 */
const BEQUEME_LAENGE = 5;

export function enge(text: string): React.CSSProperties {
  const laenge = Math.max(1, text.length);
  const faktor = Math.min(1, BEQUEME_LAENGE / laenge);
  return { ['--w-zahl-enge' as string]: String(Math.round(faktor * 1000) / 1000) };
}

/** Ein Avatar in beliebiger Groesse - über die zentralen Adressbauer. */
export function WrappedAvatar({
  discordId,
  avatarHash,
  name,
  groesse = 96,
  className,
}: {
  discordId: string;
  avatarHash: string | null;
  name: string;
  groesse?: number;
  className?: string;
}): React.JSX.Element {
  const [kaputt, setKaputt] = useState(false);
  const quelle = avatarHash
    ? getDiscordAvatarUrl(discordId, avatarHash, avatarSizeFor(groesse * 2))
    : defaultAvatarUrl(discordId);

  if (kaputt) {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-white/10 font-semibold text-white/70',
          className,
        )}
        style={{ width: groesse, height: groesse, fontSize: groesse * 0.34 }}
        role="img"
        aria-label={name}
      >
        {name.trim().slice(0, 2).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={quelle}
      alt=""
      width={groesse}
      height={groesse}
      loading="eager"
      onError={() => setKaputt(true)}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: groesse, height: groesse }}
    />
  );
}

/**
 * Die Zeile ueber der Zahl.
 *
 * Klein, gesperrt, in gedaempftem Weiss. Sie ordnet ein, ohne zu
 * konkurrieren - und sie ist der Grund, warum die Zahl darunter gross sein
 * darf.
 */
export function Vorzeile({
  children,
  verzug = 0,
  className,
}: {
  children: React.ReactNode;
  verzug?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn('w-auf w-label text-white/45', className)}
      style={{ ['--verzug' as string]: `${verzug}ms` }}
    >
      {children}
    </p>
  );
}

/** Der Satz, der die Szene traegt. */
export function Satz({
  children,
  verzug = 0,
  className,
}: {
  children: React.ReactNode;
  verzug?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <p className={cn('w-auf w-satz', className)} style={{ ['--verzug' as string]: `${verzug}ms` }}>
      {children}
    </p>
  );
}

/** Die leise Ergaenzung darunter. */
export function Nachsatz({
  children,
  verzug = 0,
  className,
}: {
  children: React.ReactNode;
  verzug?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn('w-auf w-fliess text-white/55', className)}
      style={{ ['--verzug' as string]: `${verzug}ms` }}
    >
      {children}
    </p>
  );
}
