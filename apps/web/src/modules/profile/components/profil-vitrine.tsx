import Link from 'next/link';
import type { profile } from '@swisshub/modules';
import { NavIcon } from '@/components/layout/nav-icon';
import { Abschnitt } from './abschnitt';

/**
 * Die Vitrine.
 *
 * ## Warum das hier keine Kennzahlenkarten sind
 *
 * Eine Kennzahlenkarte sagt «47». Ein Pokal sagt «das hier war ein guter
 * Tag». Deshalb: eine Sockelflaeche in der Akzentfarbe, das Symbol gross und
 * frei, die Auszeichnung in Versalien darueber und der Titel darunter - und
 * kein Raster aus gleich grossen Zahlen.
 *
 * ## Warum hier nichts fehlschlaegt
 *
 * Wer einen Platz hat, dessen Verweis ins Leere geht, bekommt ihn schlicht
 * nicht zu sehen - aussortiert wird das im Dienst. Diese Datei zeichnet, was
 * ankommt, und was nicht ankommt, kann hier auch nicht kaputtgehen.
 */
export function ProfilVitrine({
  karten,
  verzug = 0,
}: {
  karten: profile.ShowcaseKarte[];
  verzug?: number;
}): React.JSX.Element | null {
  if (karten.length === 0) {
    return null;
  }

  return (
    <Abschnitt titel="Vitrine" verzug={verzug}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {karten.map((karte) => (
          <li key={`${karte.slot}-${karte.kind}`} className="min-w-0">
            <Pokal karte={karte} />
          </li>
        ))}
      </ul>
    </Abschnitt>
  );
}

function Pokal({ karte }: { karte: profile.ShowcaseKarte }): React.JSX.Element {
  const inhalt = (
    <>
      {/* Der Schein hinter dem Symbol - die einzige Stelle im Profil, an der
          die Akzentfarbe eine Flaeche fuellt. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          background:
            'radial-gradient(70% 100% at 50% 0%, hsl(var(--profil-akzent) / 0.28) 0%, transparent 70%)',
        }}
        aria-hidden="true"
      />
      <div className="relative flex h-full flex-col items-center gap-3 px-4 py-6 text-center">
        {karte.bild ? (
          /*
           * Cover kommen teils von fremden Adressen; der Optimierer braeuchte
           * dafuer eine Freigabeliste, die der Katalog nicht kennt.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={karte.bild}
            alt=""
            className="h-20 w-20 rounded-xl object-cover shadow-card"
            loading="lazy"
          />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-full border border-[hsl(var(--profil-akzent)/0.4)] bg-[hsl(var(--profil-akzent)/0.12)]">
            <NavIcon name={karte.symbol} className="size-7 text-[hsl(var(--profil-akzent))]" aria-hidden />
          </span>
        )}

        <div className="min-w-0 space-y-1">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">{karte.art}</p>
          <p className="break-words text-base font-semibold leading-tight">{karte.titel}</p>
          {karte.untertitel ? (
            <p className="break-words text-xs text-muted-foreground">{karte.untertitel}</p>
          ) : null}
        </div>

        {karte.auszeichnung ? (
          <span className="mt-auto rounded-full bg-[hsl(var(--profil-akzent)/0.16)] px-3 py-1 text-xs font-semibold text-[hsl(var(--profil-akzent))]">
            {karte.auszeichnung}
          </span>
        ) : null}
      </div>
    </>
  );

  const klasse =
    'pr-pokal relative flex h-full min-h-[11rem] flex-col overflow-hidden rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))]';

  if (!karte.link) {
    return <div className={klasse}>{inhalt}</div>;
  }

  // Nur `social` zeigt nach aussen - deshalb dort `rel`, sonst ein
  // gewoehnlicher interner Link.
  const extern = karte.link.startsWith('http');
  return extern ? (
    <a
      href={karte.link}
      target="_blank"
      rel="noreferrer noopener"
      className={`${klasse} hover:border-[hsl(var(--profil-akzent)/0.6)]`}
    >
      {inhalt}
    </a>
  ) : (
    <Link href={karte.link} className={`${klasse} hover:border-[hsl(var(--profil-akzent)/0.6)]`}>
      {inhalt}
    </Link>
  );
}
