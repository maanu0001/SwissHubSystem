import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { profile } from '@swisshub/modules';

/**
 * Bio, Angaben und verknuepfte Konten.
 *
 * ## Der Haken, der fehlt
 *
 * Eine selbst eingetippte Kennung bekommt **keinen** Haken. Der Haken
 * erscheint nur, wenn das Konto tatsaechlich geprueft wurde - heute also
 * nirgends, weil es keine Pruefung gibt. Das ist kein toter Code: die
 * Unterscheidung muss von Anfang an in der Anzeige stehen, sonst gewoehnen
 * sich alle daran, einen eingetippten Namen fuer eine Verknuepfung zu
 * halten, und der spaeter eingebaute Haken bedeutet dann nichts mehr.
 *
 * Adressen entstehen in `profil/socials.ts` aus der Kennung; hier steht
 * keine einzige URL-Zusammensetzung.
 */
export function ProfilSteckbrief({
  angaben,
  socials,
}: {
  angaben?: profile.ProfilAngaben;
  socials?: profile.SocialAnzeige[];
}): React.JSX.Element | null {
  const listen: Array<{ titel: string; werte: string[] }> = angaben
    ? [
        { titel: 'Sprachen', werte: angaben.sprachen },
        { titel: 'Plattformen', werte: angaben.plattformen },
        { titel: 'Spielzeiten', werte: angaben.spielzeiten },
        { titel: 'Absprache', werte: angaben.absprache },
      ].filter((eintrag) => eintrag.werte.length > 0)
    : [];

  const hatKonten = socials !== undefined && socials.length > 0;

  if (!angaben?.bio && listen.length === 0 && !hatKonten) {
    return null;
  }

  return (
    <div className="space-y-5 rounded-xl border border-[hsl(var(--profil-rand))] bg-[hsl(var(--profil-flaeche))] p-4 sm:p-5">
      {angaben?.bio ? (
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground/90">
          {angaben.bio}
        </p>
      ) : null}

      {listen.length > 0 ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          {listen.map((eintrag) => (
            <div key={eintrag.titel} className="min-w-0">
              <dt className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                {eintrag.titel}
              </dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {eintrag.werte.map((wert) => (
                  <span
                    key={wert}
                    className="rounded-md border border-[hsl(var(--profil-rand))] px-2 py-0.5 text-xs"
                  >
                    {wert}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hatKonten ? (
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">Konten</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {socials.map((konto) => (
              <li key={konto.plattform} className="min-w-0">
                <Konto konto={konto} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Konto({ konto }: { konto: profile.SocialAnzeige }): React.JSX.Element {
  const inhalt = (
    <>
      <span className="font-medium">{konto.label}</span>
      <span className="min-w-0 truncate text-muted-foreground">{konto.handle}</span>
      {konto.verifiziert ? (
        <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label="Verifiziertes Konto" />
      ) : null}
      {konto.adresse ? (
        <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  const klasse =
    'inline-flex max-w-full items-center gap-2 rounded-lg border border-[hsl(var(--profil-rand))] bg-card-elevated px-2.5 py-1.5 text-xs';

  return konto.adresse ? (
    <a
      href={konto.adresse}
      target="_blank"
      // `noreferrer` und `noopener`: die Zieladresse soll nicht erfahren,
      // von wo jemand kommt, und kein fremdes Fenster Zugriff auf dieses
      // bekommen.
      rel="noreferrer noopener"
      className={`${klasse} transition-colors hover:border-[hsl(var(--profil-akzent)/0.6)]`}
    >
      {inhalt}
    </a>
  ) : (
    <span className={klasse}>{inhalt}</span>
  );
}
