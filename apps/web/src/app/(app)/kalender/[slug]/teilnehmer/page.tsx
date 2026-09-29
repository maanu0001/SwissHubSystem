import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { TeilnehmerListe } from '@/modules/calendar/components/teilnehmer-liste';
import { ZahlungsUebersicht } from '@/modules/calendar/components/zahlungs-uebersicht';
import { Panel } from '@/components/shared/panel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Event – Teilnehmer' };
export const dynamic = 'force-dynamic';

const P = calendar.CALENDAR_PERMISSIONS;

/**
 * Teilnehmerverwaltung eines Events - und, wenn er etwas kostet, die
 * Zahlungsuebersicht.
 *
 * ## Warum das hier steht und nicht auf einer eigenen Seite
 *
 * Weil es dieselbe Liste ist. «Wer kommt» und «wer hat bezahlt» sind zwei
 * Spalten derselben Tabelle, und zwei Seiten dafuer hiessen: zweimal
 * suchen, zweimal filtern, und zwei Orte, an denen jemand nachsieht, ob
 * Anna dabei ist. Der Auftrag laesst beides zu - Community-Kalender → Event
 * → Teilnehmer ist der kuerzere Weg und braucht keinen neuen
 * Navigationspunkt.
 *
 * Die Zahlungsuebersicht erscheint nur bei einem kostenpflichtigen Termin
 * und nur fuer die, die `payments.view` haben. Ein kostenloser Abend
 * bekommt keine leere Zahlungstabelle.
 */
export default async function TeilnehmerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([
    P.manageRegistrations,
    P.registrationsView,
    P.edit,
    P.manageOwn,
  ]);
  const { slug } = await params;

  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Der Community-Kalender ist deaktiviert." />;
  }

  const event = await calendar.findEvent(slug);
  if (!event) {
    notFound();
  }

  const zustaendig = calendar.istZustaendig(event, context.user.discordId);
  const darfSehen =
    can(context, P.registrationsView) ||
    can(context, P.manageRegistrations) ||
    can(context, P.edit) ||
    (can(context, P.manageOwn) && zustaendig);
  if (!darfSehen) {
    return (
      <ErrorState
        title="Kein Zugriff"
        description="Für die Teilnehmerliste dieses Events fehlt dir die Berechtigung."
      />
    );
  }

  const darfVerwalten =
    can(context, P.manageRegistrations) || can(context, P.edit) || (can(context, P.manageOwn) && zustaendig);

  const kostenpflichtig = calendar.kostenpflichtig(event);
  const darfZahlungenSehen = kostenpflichtig && can(context, P.paymentsView);

  const [teilnehmer, belegung, zahlungsZeilen, kennzahlen] = await Promise.all([
    calendar.listRegistrations(event.id, { withAnswers: true, includeCancelled: true }),
    calendar.belegung(event.id),
    /*
     * Die Zahlungsangaben werden nur geladen, wenn sie auch gezeigt werden.
     *
     * Nicht aus Sparsamkeit, sondern weil sie sonst im HTML des Servers
     * staenden, auch wenn die Komponente sie nicht zeichnet. «Das Frontend
     * blendet es aus» ist keine Zugriffskontrolle - wer nicht sehen darf,
     * bekommt es gar nicht erst geschickt.
     */
    darfZahlungenSehen ? calendar.ladeZahlungsliste(event.id) : Promise.resolve([]),
    darfZahlungenSehen ? calendar.zahlungsKennzahlen(event.id) : Promise.resolve(null),
  ]);

  const zeitpunkt = (wert: Date | null): string =>
    wert
      ? wert.toLocaleString('de-CH', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Zurich',
        })
      : '–';

  return (
    <>
      <PageHeader
        title={`Teilnehmer – ${event.title}`}
        description="Anmeldungen, Warteliste und Antworten auf Zusatzfragen."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/kalender/${event.slug}`}>
              <ArrowLeft aria-hidden="true" />
              Zum Event
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Teilnehmer"
          value={String(belegung.confirmed)}
          hint={belegung.capacity > 0 ? `von ${belegung.capacity} Plätzen` : 'Unbegrenzt'}
          icon={<Users aria-hidden="true" />}
        />
        <StatCard
          label="Warteliste"
          value={String(belegung.waitlist)}
          hint={belegung.waitlist > 0 ? 'Rücken bei Absagen nach' : 'Niemand wartet'}
        />
        <StatCard
          label="Freie Plätze"
          value={belegung.freeSeats === null ? '∞' : String(belegung.freeSeats)}
          hint={belegung.full ? 'Ausgebucht' : 'Anmeldung möglich'}
        />
      </div>

      {darfZahlungenSehen && kennzahlen ? (
        <Panel
          title="Anmeldungen & Zahlungen"
          description={`Eintritt ${calendar.betragText(event.entryFeeCents, event.entryFeeCurrency)}. SwissHub sieht keine Kontobewegung - eine Teilnahme wird erst durch eine ausdrückliche Bestätigung definitiv.`}
        >
          <ZahlungsUebersicht
            csrfToken={csrfTokenFor(context)}
            slug={event.slug}
            darfBestaetigen={can(context, P.paymentsVerify)}
            darfErlassen={can(context, P.paymentsWaive)}
            darfZuruecknehmen={can(context, P.paymentsRevoke)}
            kennzahlen={{
              angemeldet: kennzahlen.angemeldet,
              ausstehend: kennzahlen.ausstehend,
              bestaetigt: kennzahlen.bestaetigt,
              erlassen: kennzahlen.erlassen,
              storniert: kennzahlen.storniert,
              erstattet: kennzahlen.erstattet,
              eingegangen: calendar.betragText(kennzahlen.eingegangenRappen, event.entryFeeCurrency),
              offen: calendar.betragText(kennzahlen.offenRappen, event.entryFeeCurrency),
            }}
            zeilen={zahlungsZeilen.map((zeile) => ({
              registrationId: zeile.registrationId,
              name: zeile.name,
              discordId: zeile.discordId,
              status: zeile.status,
              waitlistPosition: zeile.waitlistPosition,
              angemeldetAm: zeitpunkt(zeile.registeredAt),
              betrag: calendar.betragText(zeile.betragRappen, zeile.waehrung),
              zahlung: zeile.zahlung,
              bestaetigtAm: zeile.verifiedAt ? zeitpunkt(zeile.verifiedAt) : null,
              bestaetigtVon: zeile.verifiedByUsername,
              grund: zeile.grund,
            }))}
          />
        </Panel>
      ) : null}

      {teilnehmer.length === 0 ? (
        <EmptyState
          title="Noch niemand angemeldet"
          description="Sobald sich jemand anmeldet, erscheint er hier."
        />
      ) : (
        <TeilnehmerListe
          csrfToken={csrfTokenFor(context)}
          darfVerwalten={darfVerwalten}
          eventTitel={event.title}
          zeilen={teilnehmer.map((eintrag) => ({
            id: eintrag.id,
            discordId: eintrag.discordId,
            name: eintrag.displayName ?? eintrag.username ?? eintrag.discordId,
            status: eintrag.status,
            waitlistPosition: eintrag.waitlistPosition,
            registeredAt: eintrag.registeredAt.toISOString(),
            promoted: eintrag.promotedAt !== null,
            answers: eintrag.answers,
          }))}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Gespeichert werden nur Discord-Kennung, Namensstand zum Zeitpunkt der Anmeldung und die Antworten auf
        die gestellten Fragen.
      </p>
    </>
  );
}
