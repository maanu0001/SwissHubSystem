import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { fragt } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { ZurueckLink } from '@/components/shared/zurueck-link';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ErgebnisBalken } from '@/modules/fragt/components/ergebnis-balken';
import { ErgebnisLoeschen } from '@/modules/fragt/components/ergebnis-loeschen';
import { StimmenDetail } from '@/modules/fragt/components/stimmen-detail';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ergebnis' };
export const dynamic = 'force-dynamic';

const zeit = (wert: Date | null): string =>
  wert
    ? wert.toLocaleString('de-CH', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Zurich',
      })
    : '–';

/**
 * Ein einzelnes Ergebnis.
 *
 * Die Zahlen kommen aus dem Schnappschuss, der beim Schliessen festgeschrieben
 * wurde - nicht aus einer Neuauszaehlung. Eine spaeter umbenannte Antwort
 * aendert sie damit nicht, und zweimal geoeffnet steht zweimal dasselbe.
 */
export default async function FragtErgebnisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(fragt.FRAGT_PERMISSIONS.results);
  const { id } = await params;
  const ansicht = await fragt.ladeAbstimmung(id);
  if (!ansicht) {
    notFound();
  }

  const { abstimmung, ergebnis, entwurf } = ansicht;
  const laeuftNoch = abstimmung.status === 'ACTIVE';

  /*
   * Die einzelnen Stimmen werden nur geladen, wenn sie jemand sehen darf.
   *
   * Nicht «geladen und dann ausgeblendet»: ein Server-Component-Aufruf
   * landet im HTML, das der Browser bekommt. Wer `fragt.votes.detail` nicht
   * hat, bekommt hier `null` - und damit gibt es nichts zu verstecken.
   */
  const darfDetails = can(context, fragt.FRAGT_PERMISSIONS.votesDetail);
  const stimmen = darfDetails ? await fragt.ladeStimmenDetail(id) : null;

  return (
    <div className="space-y-6">
      <ZurueckLink fallback={systemRoutes.fragtErgebnisse()} fallbackLabel="Ergebnisse" />
      <PageHeader
        title={abstimmung.frageText}
        description={
          laeuftNoch
            ? `Läuft noch bis ${zeit(abstimmung.closesAt)} - die Zahlen sind ein Zwischenstand.`
            : `Geschlossen am ${zeit(abstimmung.closedAt)}`
        }
        actions={
          can(context, fragt.FRAGT_PERMISSIONS.studio) && entwurf ? (
            <Link href={systemRoutes.fragtStudio(entwurf.id)} className={cn(buttonVariants({ size: 'sm' }))}>
              Content Studio
            </Link>
          ) : null
        }
      />

      {ergebnis ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Gültige Stimmen" value={String(ergebnis.gesamt)} icon="Users" />
            <StatCard
              label="Gewinner"
              value={
                ergebnis.gewinner
                  ? `${ergebnis.gewinner.prozent} %`
                  : ergebnis.gleichstand.length > 0
                    ? 'Gleichstand'
                    : '–'
              }
              hint={
                ergebnis.gewinner?.label ??
                (ergebnis.gleichstand.length > 0
                  ? ergebnis.gleichstand.map((zeile) => zeile.label).join(' und ')
                  : 'keine Stimmen')
              }
              icon="Trophy"
              tone={ergebnis.gewinner ? 'success' : 'default'}
            />
            <StatCard
              label="Antwortmöglichkeiten"
              value={String(ergebnis.zeilen.length)}
              hint={fragt.fragetyp(abstimmung.typ).label}
              icon="List"
            />
          </div>

          <Panel title="Verteilung" icon="BarChart3" description={abstimmung.untertitel ?? undefined}>
            <ErgebnisBalken ergebnis={ergebnis} />
          </Panel>

          {stimmen ? (
            <Panel
              title="Stimmen im Detail"
              icon="Users"
              description="Wer für welche Antwort gestimmt hat. Sichtbar nur mit der Berechtigung «Stimmen im Detail ansehen»."
            >
              <StimmenDetail
                proAntwort={stimmen.proAntwort.map((eintrag) => ({
                  optionId: eintrag.optionId,
                  antwort: eintrag.antwort,
                  stimmen: eintrag.stimmen,
                }))}
                zeilen={stimmen.zeilen.map((zeile) => ({
                  optionId: zeile.optionId,
                  antwort: zeile.antwort,
                  discordId: zeile.discordId,
                  name: zeile.name,
                  abgegebenAm: zeit(zeile.abgegebenAm),
                  geaendert: zeile.geaendert,
                }))}
              />
            </Panel>
          ) : null}

          {/*
            Löschen am Ende der Seite.

            Ganz unten und nicht in der Kopfzeile: wer hier ankommt, hat die
            Zahlen gesehen und weiss, was er wegwirft. Ein Löschknopf neben
            dem Titel wäre der erste Knopf auf der Seite.
          */}
          {can(context, fragt.FRAGT_PERMISSIONS.delete) && !laeuftNoch ? (
            <Panel
              title="Ergebnis löschen"
              icon="ShieldAlert"
              description="Entfernt diesen Durchgang samt Stimmen und Entwurf. Die Frage bleibt in der Bibliothek."
            >
              <ErgebnisLoeschen
                abstimmungId={abstimmung.id}
                frageText={abstimmung.frageText}
                stimmen={abstimmung.finalVotes}
                csrfToken={csrfTokenFor(context)}
              />
            </Panel>
          ) : null}

          <Panel title="Ablauf" icon="Clock">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Veröffentlicht</dt>
                <dd>{zeit(abstimmung.opensAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reguläres Ende</dt>
                <dd>{zeit(abstimmung.closesAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Tatsächlich geschlossen</dt>
                <dd>{zeit(abstimmung.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Zwischenstand im Kanal</dt>
                <dd>{abstimmung.zwischenstandSichtbar ? 'war sichtbar' : 'war verborgen'}</dd>
              </div>
            </dl>
          </Panel>
        </>
      ) : (
        <EmptyState
          title="Kein lesbares Ergebnis"
          description="Zu dieser Abstimmung liegt kein Ergebnis in der erwarteten Form vor. Die Stimmen sind nicht verloren - sie lassen sich nur nicht darstellen."
        />
      )}
    </div>
  );
}
