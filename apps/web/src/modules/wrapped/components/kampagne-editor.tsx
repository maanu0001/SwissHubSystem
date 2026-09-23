'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock } from 'lucide-react';
import { PLATZHALTER, pruefeVorlage } from '@swisshub/modules/wrapped/vorlage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { wrappedKampagneAendernAction } from '@/modules/wrapped/aktionen';

/**
 * Das Kampagnenblatt zum Bearbeiten.
 *
 * ## Was nach der Veroeffentlichung gesperrt ist
 *
 * Zeitraum, Jahr und die Mindestaktivitaet. Nicht aus Vorsicht, sondern
 * weil die Momentaufnahmen dann bereits geschrieben sind: ein anderer
 * Zeitraum ergaebe einen Rueckblick, dessen Zahlen nicht mehr zu seiner
 * Beschriftung passen. Die Felder verschwinden nicht - sie werden gesperrt
 * und sagen, warum. Ein Feld, das einfach weg ist, sieht aus wie ein
 * Fehler.
 *
 * Texte und Ankuendigung bleiben aenderbar. Ein Tippfehler im Begruessungs-
 * satz soll sich auch nach der Veroeffentlichung noch beheben lassen.
 */
export interface KampagneWerte {
  campaignId: string;
  title: string;
  displayYear: number;
  periodStart: string;
  periodEnd: string;
  introText: string;
  outroText: string;
  shareCardsEnabled: boolean;
  announceEnabled: boolean;
  announcementChannelId: string;
  minActiveDays: number;
  minMessages: number;
  minVoiceMinutes: number;
}

export function KampagneEditor({
  werte: anfang,
  festgeschrieben,
  csrfToken,
  schreibbar,
}: {
  werte: KampagneWerte;
  /** Veroeffentlicht oder archiviert - dann sind die Stellschrauben zu. */
  festgeschrieben: boolean;
  csrfToken: string;
  schreibbar: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [werte, setWerte] = useState(anfang);
  const [laeuft, setLaeuft] = useState(false);

  const setzen = <K extends keyof KampagneWerte>(feld: K, wert: KampagneWerte[K]): void =>
    setWerte((alt) => ({ ...alt, [feld]: wert }));

  const introBefund = pruefeVorlage(werte.introText);
  const outroBefund = pruefeVorlage(werte.outroText);
  const textfehler = [
    introBefund.gueltig ? null : `Begrüssung: ${introBefund.fehler.join(' ')}`,
    outroBefund.gueltig ? null : `Abschluss: ${outroBefund.fehler.join(' ')}`,
  ].filter((eintrag): eintrag is string => eintrag !== null);

  async function speichern(ereignis: React.FormEvent): Promise<void> {
    ereignis.preventDefault();
    if (textfehler.length > 0) {
      toast.error(textfehler[0]);
      return;
    }
    setLaeuft(true);
    const antwort = await wrappedKampagneAendernAction({
      csrfToken,
      campaignId: werte.campaignId,
      title: werte.title,
      introText: werte.introText,
      outroText: werte.outroText,
      shareCardsEnabled: werte.shareCardsEnabled,
      announceEnabled: werte.announceEnabled,
      announcementChannelId: werte.announcementChannelId.trim() || null,
      ...(festgeschrieben
        ? {}
        : {
            displayYear: werte.displayYear,
            periodStart: werte.periodStart,
            periodEnd: werte.periodEnd,
            minActiveDays: werte.minActiveDays,
            minMessages: werte.minMessages,
            minVoiceMinutes: werte.minVoiceMinutes,
          }),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Gespeichert.');
    router.refresh();
  }

  return (
    <form onSubmit={(ereignis) => void speichern(ereignis)} className="space-y-6">
      <fieldset disabled={!schreibbar} className="space-y-6 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="k-titel">Titel</Label>
            <Input
              id="k-titel"
              value={werte.title}
              onChange={(ereignis) => setzen('title', ereignis.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-jahr">Jahr</Label>
            <Input
              id="k-jahr"
              inputMode="numeric"
              value={werte.displayYear}
              onChange={(ereignis) => setzen('displayYear', Number(ereignis.target.value))}
              disabled={festgeschrieben}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-von">Zeitraum von</Label>
            <Input
              id="k-von"
              type="date"
              value={werte.periodStart}
              onChange={(ereignis) => setzen('periodStart', ereignis.target.value)}
              disabled={festgeschrieben}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-bis">bis (ausschliesslich)</Label>
            <Input
              id="k-bis"
              type="date"
              value={werte.periodEnd}
              onChange={(ereignis) => setzen('periodEnd', ereignis.target.value)}
              disabled={festgeschrieben}
            />
          </div>
        </div>

        {festgeschrieben ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Zeitraum, Jahr und Mindestaktivität stehen fest, solange dieser Rückblick veröffentlicht ist - die
            Momentaufnahmen sind bereits geschrieben. Texte und Ankündigung lassen sich weiterhin ändern.
          </p>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="k-intro">Begrüssung</Label>
            <Input
              id="k-intro"
              value={werte.introText}
              onChange={(ereignis) => setzen('introText', ereignis.target.value)}
              maxLength={280}
              aria-invalid={!introBefund.gueltig}
            />
            <PlatzhalterHinweis befund={introBefund} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="k-outro">Abschluss</Label>
            <Input
              id="k-outro"
              value={werte.outroText}
              onChange={(ereignis) => setzen('outroText', ereignis.target.value)}
              maxLength={280}
              aria-invalid={!outroBefund.gueltig}
            />
            <PlatzhalterHinweis befund={outroBefund} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="k-tage">Mindestens aktive Tage</Label>
            <Input
              id="k-tage"
              inputMode="numeric"
              value={werte.minActiveDays}
              onChange={(ereignis) => setzen('minActiveDays', Number(ereignis.target.value))}
              disabled={festgeschrieben}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="k-nachrichten">oder Nachrichten</Label>
            <Input
              id="k-nachrichten"
              inputMode="numeric"
              value={werte.minMessages}
              onChange={(ereignis) => setzen('minMessages', Number(ereignis.target.value))}
              disabled={festgeschrieben}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="k-voice">oder Sprachminuten</Label>
            <Input
              id="k-voice"
              inputMode="numeric"
              value={werte.minVoiceMinutes}
              onChange={(ereignis) => setzen('minVoiceMinutes', Number(ereignis.target.value))}
              disabled={festgeschrieben}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Ein <strong>Oder</strong>, kein Und: wer viel im Sprachkanal sass und nie etwas geschrieben hat,
            bekommt trotzdem einen Rückblick.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm">
              Share Cards anbieten
              <span className="block text-xs text-muted-foreground">
                Ein Bild zum Teilen am Ende des Rückblicks.
              </span>
            </span>
            <Switch
              checked={werte.shareCardsEnabled}
              onCheckedChange={(wert) => setzen('shareCardsEnabled', wert)}
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <span className="text-sm">
              In Discord ankündigen
              <span className="block text-xs text-muted-foreground">
                Einmalig beim Veröffentlichen, ohne Erwähnungen.
              </span>
            </span>
            <Switch
              checked={werte.announceEnabled}
              onCheckedChange={(wert) => setzen('announceEnabled', wert)}
            />
          </label>

          {werte.announceEnabled ? (
            <div className="space-y-1.5">
              <Label htmlFor="k-kanal">Kanal-ID für die Ankündigung</Label>
              <Input
                id="k-kanal"
                value={werte.announcementChannelId}
                onChange={(ereignis) => setzen('announcementChannelId', ereignis.target.value)}
                placeholder="z. B. 123456789012345678"
                inputMode="numeric"
              />
            </div>
          ) : null}
        </div>
      </fieldset>

      {schreibbar ? (
        <Button type="submit" disabled={laeuft || textfehler.length > 0}>
          {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Speichern
        </Button>
      ) : null}
    </form>
  );
}

/**
 * Was in einen Text eingesetzt werden darf.
 *
 * Die Liste steht hier ausgeschrieben, weil sie kurz ist und weil niemand
 * raten soll. Alles ausserhalb der Liste wird beim Speichern abgelehnt -
 * es gibt keine Ausdruecke, kein JavaScript, keine Rechnungen.
 */
function PlatzhalterHinweis({
  befund,
}: {
  befund: { gueltig: boolean; fehler: string[]; unbekannt: string[] };
}): React.JSX.Element {
  if (!befund.gueltig) {
    return <p className="text-xs text-destructive">{befund.fehler.join(' ')}</p>;
  }
  if (befund.unbekannt.length > 0) {
    /*
     * Kein Fehler, aber eine Warnung.
     *
     * Ein unbekannter Platzhalter wird nicht ersetzt, sondern bleibt so
     * stehen, wie er dasteht - `{{voiceHour}}` landet woertlich auf dem
     * Bildschirm eines Mitglieds. Das ist harmlos und trotzdem peinlich,
     * also sagt es die Oberflaeche beim Tippen.
     */
    return (
      <p className="text-xs text-warning">
        Unbekannt und wird nicht ersetzt: {befund.unbekannt.map((name) => `{{${name}}}`).join(' · ')}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Einsetzbar: {PLATZHALTER.map((eintrag) => `{{${eintrag.key}}}`).join(' · ')}
    </p>
  );
}
