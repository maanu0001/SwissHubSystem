'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Clock, LogOut, QrCode, UserPlus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { registerAction, unregisterAction } from '@/modules/calendar/actions';

/**
 * An- und Abmeldung auf der Detailseite.
 *
 * Der Knopf bietet nur an, was tatsaechlich moeglich ist: ist die Frist
 * abgelaufen oder das Event abgesagt, steht dort der Grund statt eines
 * Knopfes, der beim Druecken einen Fehler zeigt.
 *
 * Bewusst kein vorgezogener Zustandswechsel im Browser: ob eine Anmeldung
 * bestaetigt wird oder auf der Warteliste landet, entscheidet erst der
 * Server - beim letzten freien Platz weiss der Browser es nicht besser.
 *
 * ## Und bei einem kostenpflichtigen Abend
 *
 * Dann steht vor dem Knopf, was er kostet, wie man zahlt und der QR-Code
 * dazu - und nach dem Anmelden steht dort, dass die Teilnahme **noch nicht**
 * definitiv ist. Kein Wort wie «Ticket gekauft» oder «Zahlung erfolgreich»:
 * SwissHub sieht keine Kontobewegung, und ein Satz, der eine behauptet, ist
 * eine Luege gegenueber der Person, die ihn liest.
 */
export function AnmeldeBereich({
  csrfToken,
  eventId,
  darfTeilnehmen,
  gesperrtGrund,
  abmeldenGrund,
  meine,
  belegung,
  eintritt,
  wartelisteMoeglich,
  fragen,
}: {
  csrfToken: string;
  eventId: string;
  darfTeilnehmen: boolean;
  gesperrtGrund: string | null;
  abmeldenGrund: string | null;
  meine: {
    status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED';
    position: number | null;
    /** Der eigene Zahlungsstand. `null`, wenn der Termin nichts kostet. */
    zahlung: 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED' | null;
  } | null;
  belegung: { confirmed: number; capacity: number; waitlist: number; full: boolean };
  /**
   * Was der Eintritt kostet - oder `null` bei einem kostenlosen Termin.
   *
   * Der Preis kommt fertig formatiert herein («CHF 15.–»), damit die
   * Schreibweise an einer Stelle steht und nicht in jeder Komponente neu
   * erfunden wird.
   */
  eintritt: { text: string; hinweise: string | null; qrAdresse: string | null } | null;
  wartelisteMoeglich: boolean;
  fragen: Array<{
    id: string;
    label: string;
    hint: string | null;
    required: boolean;
    choices: string[];
  }>;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [antworten, setAntworten] = useState<Record<string, string>>({});

  const anmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await registerAction({ csrfToken, eventId, answers: antworten });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      /*
       * Was hier steht, muss stimmen.
       *
       * Bei einem kostenpflichtigen Abend ist «Du bist angemeldet» die halbe
       * Wahrheit: die Anmeldung ist da, die Teilnahme ist es nicht. Der Rest
       * steht danach im Kasten darueber - hier nur der ehrliche Satz.
       */
      toast.success(
        ergebnis.data?.waitlisted
          ? `Du stehst auf der Warteliste (Platz ${ergebnis.data.position}).`
          : eintritt
            ? 'Anmeldung eingegangen. Deine Teilnahme ist noch nicht definitiv.'
            : 'Du bist angemeldet.',
      );
      setAntworten({});
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const abmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await unregisterAction({ csrfToken, eventId });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        throw new Error('Abmeldung fehlgeschlagen');
      }
      toast.success('Deine Teilnahme wurde zurückgezogen.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const plaetze =
    belegung.capacity > 0 ? `${belegung.confirmed} / ${belegung.capacity}` : `${belegung.confirmed}`;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Teilnahme</h2>
        <span className="tabular-nums text-sm text-muted-foreground">{plaetze}</span>
      </div>

      {belegung.waitlist > 0 ? (
        <p className="text-xs text-muted-foreground">{belegung.waitlist} Person(en) auf der Warteliste.</p>
      ) : null}

      {meine ? (
        <>
          <MeinStand meine={meine} />

          {/*
            Preis, Hinweise und QR bleiben auch nach der Anmeldung stehen,
            solange die Zahlung offen ist. Sie danach auszublenden hiesse,
            genau dem die Anweisung wegzunehmen, der sie noch braucht.
          */}
          {eintritt && meine.zahlung === 'PENDING' ? <EintrittsKasten eintritt={eintritt} /> : null}

          {abmeldenGrund ? (
            <p className="text-xs text-muted-foreground">{abmeldenGrund}</p>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() => setAbmeldenOffen(true)}
              >
                <LogOut aria-hidden="true" />
                Teilnahme zurückziehen
              </Button>
              <ConfirmationDialog
                open={abmeldenOffen}
                onOpenChange={setAbmeldenOffen}
                title="Teilnahme zurückziehen?"
                description={
                  meine.status === 'CONFIRMED' && belegung.waitlist > 0
                    ? 'Dein Platz geht an die erste Person auf der Warteliste. Eine erneute Anmeldung landet dann hinten.'
                    : 'Du kannst dich später wieder anmelden, solange Plätze frei sind und die Frist läuft.'
                }
                confirmLabel="Teilnahme zurückziehen"
                destructive
                onConfirm={abmelden}
              />
            </>
          )}
        </>
      ) : gesperrtGrund ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {gesperrtGrund}
        </p>
      ) : !darfTeilnehmen ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Für die Anmeldung fehlt dir die Berechtigung.
        </p>
      ) : belegung.full && !wartelisteMoeglich ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Dieses Event ist ausgebucht.
        </p>
      ) : (
        <>
          {eintritt ? <EintrittsKasten eintritt={eintritt} vorAnmeldung /> : null}

          {fragen.length > 0 ? (
            <div className="space-y-3">
              {fragen.map((frage) => (
                <div key={frage.id} className="space-y-1.5">
                  <Label htmlFor={`frage-${frage.id}`}>
                    {frage.label}
                    {frage.required ? ' *' : ''}
                  </Label>
                  {frage.choices.length > 0 ? (
                    <select
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="">Bitte wählen</option>
                      {frage.choices.map((auswahl) => (
                        <option key={auswahl} value={auswahl}>
                          {auswahl}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      maxLength={500}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                    />
                  )}
                  {frage.hint ? <p className="text-xs text-muted-foreground">{frage.hint}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          <Button className="w-full" disabled={pending} onClick={() => void anmelden()}>
            <UserPlus aria-hidden="true" />
            {belegung.full ? 'Auf Warteliste setzen' : eintritt ? 'Anmeldung bestätigen' : 'Teilnehmen'}
          </Button>

          {belegung.full ? (
            <p className="text-xs text-muted-foreground">
              Das Event ist voll. Wird ein Platz frei, rückt die erste Person der Warteliste automatisch nach.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Der eigene Stand - Platz und Zahlung in einem Satz.
 *
 * ## Warum die Formulierungen hier so genau sind
 *
 * Weil sie das Einzige sind, woran sich jemand hält, der bezahlt hat und
 * wissen will, ob es angekommen ist. «Du bist angemeldet» bei offener
 * Zahlung wäre falsch, «Zahlung erfolgreich» wäre eine Behauptung über ein
 * Konto, in das SwissHub nie geschaut hat, und «Ticket gekauft» wäre beides.
 *
 * Was hier steht, entspricht dem, was in der Datenbank steht - nicht mehr.
 */
function MeinStand({
  meine,
}: {
  meine: {
    status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED';
    position: number | null;
    zahlung: 'NOT_REQUIRED' | 'PENDING' | 'VERIFIED' | 'WAIVED' | 'REFUNDED' | null;
  };
}): React.JSX.Element {
  const warteliste = meine.status === 'WAITLIST';
  const offen = meine.zahlung === 'PENDING' || meine.zahlung === 'REFUNDED';

  const ton = offen
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
    : warteliste
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';

  const titel = warteliste
    ? `Du stehst auf der Warteliste${meine.position ? ` (Platz ${meine.position})` : ''}.`
    : meine.zahlung === 'PENDING'
      ? 'Anmeldung eingegangen.'
      : meine.zahlung === 'REFUNDED'
        ? 'Deine Zahlung wurde zurückerstattet.'
        : 'Du bist angemeldet.';

  // Die Statuszeile in Versalien - dasselbe Wort, das der Admin in seiner
  // Liste sieht, damit eine Rueckfrage nicht an zwei Vokabularen scheitert.
  const marke =
    meine.zahlung === 'PENDING'
      ? 'ZAHLUNG AUSSTEHEND'
      : meine.zahlung === 'VERIFIED'
        ? 'TEILNAHME BESTÄTIGT'
        : meine.zahlung === 'WAIVED'
          ? 'ZAHLUNG ERLASSEN · TEILNAHME BESTÄTIGT'
          : meine.zahlung === 'REFUNDED'
            ? 'ZAHLUNG ERSTATTET'
            : null;

  return (
    <div className={`space-y-2 rounded-lg border p-3 text-sm ${ton}`}>
      <p className="flex items-center gap-2">
        {offen || warteliste ? (
          <Clock className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        )}
        {titel}
      </p>

      {marke ? <p className="text-xs font-semibold tracking-wide">{marke}</p> : null}

      {meine.zahlung === 'PENDING' ? (
        <p className="text-xs opacity-90">
          Deine Teilnahme ist noch nicht definitiv. Nach Eingang der Zahlung wird deine Anmeldung vom
          SwissHub-Team bestätigt.
        </p>
      ) : null}
      {meine.zahlung === 'VERIFIED' ? (
        <p className="text-xs opacity-90">Deine Zahlung wurde vom SwissHub-Team bestätigt.</p>
      ) : null}
      {meine.zahlung === 'WAIVED' ? (
        <p className="text-xs opacity-90">Für dich fällt kein Eintritt an. Deine Teilnahme ist definitiv.</p>
      ) : null}
    </div>
  );
}

/**
 * Preis, Hinweise und der TWINT-Code.
 *
 * ## Warum der QR-Code so gross ist
 *
 * Weil er gescannt wird, und zwar von einem Telefon, das jemand in der
 * anderen Hand hält. Ein Code mit 80 Pixeln Kantenlänge ist auf einem
 * Bildschirm hübsch und in der Praxis nicht zu gebrauchen. Hier sind es 12
 * bis 16 Rem - auf dem Telefon füllt er damit die halbe Breite, auf dem
 * Bildschirm ist er gross genug, um ihn mit einem zweiten Gerät zu scannen.
 *
 * Der weisse Grund ist kein Stilmittel: ein QR-Code mit transparentem
 * Hintergrund auf dunkler Fläche ist invertiert, und ein invertierter Code
 * wird von vielen Kameras nicht erkannt.
 */
function EintrittsKasten({
  eintritt,
  vorAnmeldung = false,
}: {
  eintritt: { text: string; hinweise: string | null; qrAdresse: string | null };
  vorAnmeldung?: boolean;
}): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Wallet className="size-4 shrink-0" aria-hidden="true" />
        Eintritt: {eintritt.text}
      </p>

      {vorAnmeldung ? (
        <p className="text-xs text-muted-foreground">
          Die Anmeldung ist zunächst vorläufig. Definitiv wird sie, sobald das SwissHub-Team den
          Zahlungseingang geprüft und bestätigt hat.
        </p>
      ) : null}

      {eintritt.hinweise ? (
        /*
          `whitespace-pre-line` und kein Markdown: was die Organisation hier
          schreibt, ist ein Hinweis und kein Dokument. Absaetze bleiben,
          alles andere bleibt Text - es gibt keinen Pfad, auf dem daraus
          Markup wuerde.
        */
        <p className="whitespace-pre-line text-xs text-muted-foreground">{eintritt.hinweise}</p>
      ) : null}

      {eintritt.qrAdresse ? (
        <div className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={eintritt.qrAdresse}
            alt="TWINT-QR-Code zum Bezahlen des Eintritts"
            className="mx-auto h-48 w-48 rounded-lg bg-white object-contain p-2 sm:h-56 sm:w-56"
          />
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <QrCode className="size-3.5 shrink-0" aria-hidden="true" />
            Mit der TWINT-App scannen, um den Eintritt zu bezahlen.
          </p>
        </div>
      ) : null}
    </div>
  );
}
