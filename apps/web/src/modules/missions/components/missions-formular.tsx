'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { missionErstellenAction } from '@/modules/missions/actions';

export interface TypAuswahl {
  key: string;
  label: string;
  einheit: string;
  erklaerung: string;
  zielVorschlag: number;
  summierbar: boolean;
}

/**
 * Das Formular fuer eine eigene Mission.
 *
 * ## Was hier nicht steht
 *
 * Kein Rule Builder. Keine Bedingungen, kein UND/ODER, kein JSON. Eine
 * Mission ist ein Typ, eine Zahl und ein Zeitraum - wer mehr braucht, legt
 * zwei Missionen an, und das ist die verstaendlichere Antwort als ein
 * Baum aus Regeln, den drei Monate spaeter niemand mehr liest.
 *
 * ## Warum kein Auswahlfeld fuer die Kennung
 *
 * Die Auswahl zeigt «Zeit im Sprachkanal», nicht `VOICE_MINUTEN`. Die
 * Kennung steht im Wert des Feldes, wo sie hingehoert, und erscheint
 * nirgends auf dem Bildschirm.
 */
export function MissionsFormular({
  typen,
  csrfToken,
}: {
  typen: TypAuswahl[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [art, setArt] = useState<'WOCHE' | 'CHALLENGE'>('WOCHE');
  const [typKey, setTypKey] = useState(typen[0]?.key ?? '');

  const gewaehlt = typen.find((typ) => typ.key === typKey) ?? typen[0];
  // Fuer eine Challenge stehen nur die Typen zur Wahl, die sich zusammenzaehlen
  // lassen - warum, steht in `typen.ts`.
  const verfuegbar = art === 'CHALLENGE' ? typen.filter((typ) => typ.summierbar) : typen;

  async function absenden(formular: FormData): Promise<void> {
    setLaeuft(true);
    const antwort = await missionErstellenAction({
      csrfToken,
      art,
      typ: typKey,
      titel: String(formular.get('titel') ?? ''),
      beschreibung: String(formular.get('beschreibung') ?? '') || null,
      ziel: Number(formular.get('ziel') ?? 0),
      mindestBeitrag: Number(formular.get('mindestBeitrag') ?? 1),
      beginntAm: String(formular.get('beginntAm') ?? ''),
      endetAm: String(formular.get('endetAm') ?? ''),
      belohnungXp: Number(formular.get('belohnungXp') ?? 0),
      belohnungPremiumTage: Number(formular.get('belohnungPremiumTage') ?? 0),
      belohnungAuszeichnung: String(formular.get('belohnungAuszeichnung') ?? '') || null,
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success('Mission angelegt.');
    router.refresh();
  }

  return (
    <form
      action={(formular) => void absenden(formular)}
      className="space-y-4 rounded-xl border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mission-art">Art</Label>
          <select
            id="mission-art"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={art}
            onChange={(ereignis) => {
              const neu = ereignis.target.value as 'WOCHE' | 'CHALLENGE';
              setArt(neu);
              /*
               * Beim Wechsel auf Challenge kann der gewaehlte Typ wegfallen.
               * Dann auf den ersten verfuegbaren springen, statt ein Feld mit
               * einem Wert stehen zu lassen, den das Formular nicht mehr
               * anbietet - der ginge sonst beim Absenden mit.
               */
              if (neu === 'CHALLENGE' && !typen.find((typ) => typ.key === typKey)?.summierbar) {
                setTypKey(typen.find((typ) => typ.summierbar)?.key ?? '');
              }
            }}
          >
            <option value="WOCHE">Wochenmission - jedes Mitglied für sich</option>
            <option value="CHALLENGE">Community Challenge - gemeinsam als Server</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mission-typ">Was gemessen wird</Label>
          <select
            id="mission-typ"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={typKey}
            onChange={(ereignis) => setTypKey(ereignis.target.value)}
          >
            {verfuegbar.map((typ) => (
              <option key={typ.key} value={typ.key}>
                {typ.label}
              </option>
            ))}
          </select>
          {gewaehlt ? <p className="text-xs text-muted-foreground">{gewaehlt.erklaerung}</p> : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mission-titel">Titel</Label>
        <Input id="mission-titel" name="titel" required maxLength={120} placeholder="100 Minuten im Voice" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mission-beschreibung">Beschreibung (freiwillig)</Label>
        <Input id="mission-beschreibung" name="beschreibung" maxLength={500} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mission-ziel">Ziel ({gewaehlt?.einheit})</Label>
          <Input
            id="mission-ziel"
            name="ziel"
            type="number"
            min={1}
            required
            defaultValue={gewaehlt?.zielVorschlag ?? 1}
          />
        </div>
        {art === 'CHALLENGE' ? (
          <div className="space-y-2">
            <Label htmlFor="mission-mindest">Mindestbeitrag je Mitglied</Label>
            <Input id="mission-mindest" name="mindestBeitrag" type="number" min={1} defaultValue={1} />
            <p className="text-xs text-muted-foreground">
              Wer weniger beiträgt, wird nicht belohnt - sonst bekommt jedes Servermitglied etwas dafür, dass
              andere die Challenge getragen haben.
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="mission-beginn">Beginnt am</Label>
          <Input id="mission-beginn" name="beginntAm" type="datetime-local" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mission-ende">Endet am</Label>
          <Input id="mission-ende" name="endetAm" type="datetime-local" required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="mission-xp">XP</Label>
          <Input id="mission-xp" name="belohnungXp" type="number" min={0} max={10000} defaultValue={0} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mission-premium">Tage Premium</Label>
          <Input
            id="mission-premium"
            name="belohnungPremiumTage"
            type="number"
            min={0}
            max={90}
            defaultValue={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mission-award">Auszeichnung (Schlüssel)</Label>
          <Input id="mission-award" name="belohnungAuszeichnung" maxLength={80} />
        </div>
      </div>

      <Button type="submit" disabled={laeuft || !typKey}>
        {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Mission anlegen
      </Button>
    </form>
  );
}
