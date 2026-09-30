import Link from 'next/link';
import { ExternalLink, UserRound, Users } from 'lucide-react';
import { systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Die Teilnehmerliste auf der Eventseite - «wer kommt».
 *
 * ## Was sie von der Verwaltungsliste unterscheidet
 *
 * Diese hier ist bei `participantsPublic` für jedes Mitglied sichtbar und
 * beantwortet genau eine Frage. Kein Zahlungsstand, keine Gast-E-Mail, kein
 * Check-in, keine Discord-Kennung - das steht unter «Teilnehmer», wo die
 * Organisation arbeitet, und wird dort auch nur geladen, wenn jemand es sehen
 * darf.
 *
 * Die Trennung liegt in der Abfrage: `ladeOeffentlicheTeilnehmer` holt vier
 * Ticketfelder, und was nicht geladen wird, kann hier nicht durchrutschen.
 *
 * ## Warum die Gäste danebenstehen
 *
 * Weil «wer kommt» sie einschliesst. Eine Liste mit zwanzig Anmeldungen und
 * zwölf Gästen, die nur die Mitglieder nennt, zeigt ein Drittel der Leute
 * nicht.
 *
 * Sie stehen auf derselben Zeile wie ihr Mitglied, durch einen Doppelpunkt
 * angehängt: «Manuel · mit Anna und Gast B». Eine eigene Zeile je Gast wäre
 * hier zu viel - diese Liste wird überflogen, nicht abgearbeitet. Wer die
 * Zuordnung einzeln braucht, findet sie in der Einlasssicht.
 *
 * ## Warum der Name ein Link ist
 *
 * Weil jemand, der in der Liste einen Namen liest, oft genau das als
 * Nächstes will: nachsehen, wer das ist. Ob es ein Profil gibt, hat der
 * Server entschieden - `slug` ist nur gesetzt, wenn es öffentlich und nicht
 * gesperrt ist. Ein Gast bekommt nie einen Link: er hat kein Konto.
 */

export interface OeffentlicheTeilnehmerAnsicht {
  registrationId: string;
  bestellerName: string;
  bestellerSlug: string | null;
  status: 'CONFIRMED' | 'WAITLIST';
  waitlistPosition: number | null;
  kommtSelbst: boolean;
  gaeste: string[];
  anzahl: number;
  /** Antworten auf Zusatzfragen - nur für die Organisation, sonst leer. */
  antworten: Array<{ question: string; value: string }>;
}

/**
 * Der Name eines Mitglieds - verlinkt, wenn es ein öffentliches Profil gibt.
 *
 * Ohne Slug bleibt er Text. Ein Link ins Leere wäre schlimmer als keiner, und
 * ein Gastname als Adresse gedeutet führte auf ein fremdes Profil.
 */
function MitgliedName({ name, slug }: { name: string; slug: string | null }): React.JSX.Element {
  if (!slug) {
    return <span className="font-medium">{name}</span>;
  }
  return (
    <Link
      href={systemRoutes.oeffentlichesProfil(slug)}
      className="inline-flex max-w-full items-center gap-1 font-medium underline decoration-dotted underline-offset-4 hover:text-primary hover:decoration-solid"
    >
      <span className="truncate">{name}</span>
      <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      <span className="sr-only">Öffentliches Profil von {name} öffnen</span>
    </Link>
  );
}

/** Die Gäste einer Anmeldung als ein Satzteil. */
function gaesteText(gaeste: string[], kommtSelbst: boolean): string | null {
  if (gaeste.length === 0) {
    return null;
  }
  const namen =
    gaeste.length === 1 ? gaeste[0]! : `${gaeste.slice(0, -1).join(', ')} und ${gaeste[gaeste.length - 1]!}`;
  // «bringt A mit» wenn er selbst kommt, «meldet A an» wenn nicht - sonst
  // stuende «mit Anna» bei jemandem, der gar nicht da ist.
  return kommtSelbst ? `mit ${namen}` : `meldet ${namen} an`;
}

export function TeilnehmendeOeffentlich({
  gruppen,
}: {
  gruppen: OeffentlicheTeilnehmerAnsicht[];
}): React.JSX.Element {
  if (gruppen.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch niemand angemeldet.</p>;
  }

  const personen = gruppen.reduce((summe, gruppe) => summe + gruppe.anzahl, 0);
  const gaeste = gruppen.reduce((summe, gruppe) => summe + gruppe.gaeste.length, 0);

  return (
    <div className="space-y-3">
      {/*
        Die Zeile, die es vorher nicht gab: Anmeldungen und Personen sind
        zweierlei. «12 Anmeldungen» sagt nichts darüber, wie voll es wird.
      */}
      <p className="text-xs text-muted-foreground">
        {personen} {personen === 1 ? 'Person' : 'Personen'} aus {gruppen.length}{' '}
        {gruppen.length === 1 ? 'Anmeldung' : 'Anmeldungen'}
        {gaeste > 0 ? ` · davon ${gaeste} ${gaeste === 1 ? 'Gast' : 'Gäste'}` : ''}
      </p>

      <ul className="space-y-2">
        {gruppen.map((gruppe) => {
          const mitgebracht = gaesteText(gruppe.gaeste, gruppe.kommtSelbst);
          return (
            <li
              key={gruppe.registrationId}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 px-3 py-2 text-sm"
            >
              {gruppe.gaeste.length > 0 ? (
                <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}

              <MitgliedName name={gruppe.bestellerName} slug={gruppe.bestellerSlug} />

              {mitgebracht ? <span className="text-muted-foreground">· {mitgebracht}</span> : null}

              {gruppe.anzahl > 1 ? (
                <Badge variant="outline" className="shrink-0">
                  {gruppe.anzahl} Plätze
                </Badge>
              ) : null}

              {gruppe.status === 'WAITLIST' ? (
                <Badge
                  variant="outline"
                  className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-500"
                >
                  Warteliste {gruppe.waitlistPosition}
                </Badge>
              ) : null}

              {gruppe.antworten.length > 0 ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {gruppe.antworten.map((antwort) => `${antwort.question}: ${antwort.value}`).join(' · ')}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
