'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/shared/panel';
import { restoreAnfordernAction } from '@/modules/backup/actions';

const UMFAENGE = [
  { wert: 'produktiv-datenbank', label: 'Nur die Datenbank' },
  { wert: 'produktiv-dateien', label: 'Nur die Uploads' },
  { wert: 'produktiv-vollstaendig', label: 'Datenbank und Uploads' },
] as const;

/**
 * Einen produktiven Restore anfordern.
 *
 * ==========================================================================
 * WAS DIESES FORMULAR AUSDRUECKLICH NICHT TUT
 * ==========================================================================
 *
 * Es setzt nichts zurueck. Es gibt in dieser Anwendung keinen Knopf, der eine
 * produktive Wiederherstellung ausloest - und das ist eine Entscheidung und
 * keine fehlende Funktion.
 *
 * Der Grund: ein produktiver Restore verwirft alles, was nach dem
 * Zielzeitpunkt geschehen ist. Jede Nachricht, jede Moderation, jeden
 * Ticketverlauf. Eine Oberflaeche, die aus dem Internet erreichbar ist, soll
 * diese Operation nicht anbieten - weder fuer einen Fehlklick noch fuer
 * jemanden, der sich Zugang verschafft hat.
 *
 * Was dieses Formular tut: es meldet eine Absicht an. Danach braucht es
 * - die Zustimmung einer ZWEITEN Person (Vier-Augen-Prinzip),
 * - und einen Menschen, der `swisshub-recovery` auf der Kommandozeile
 *   ausfuehrt.
 *
 * Drei Huerden fuer eine Operation, die man in Monaten einmal braucht. Das
 * ist das richtige Verhaeltnis.
 * ==========================================================================
 */
export function RestoreAnfordern({
  csrfToken,
  vorschlagZeitpunkt,
}: {
  csrfToken: string;
  /** Aus dem gewaehlten Wiederherstellungspunkt, falls einer angeklickt wurde. */
  vorschlagZeitpunkt?: string;
}): React.JSX.Element {
  const [umfang, setUmfang] = useState<string>('produktiv-vollstaendig');
  const [zeitpunkt, setZeitpunkt] = useState(vorschlagZeitpunkt ?? '');
  const [begruendung, setBegruendung] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const router = useRouter();

  const absenden = async (ereignis: React.FormEvent): Promise<void> => {
    ereignis.preventDefault();
    setLaeuft(true);
    try {
      const antwort = await restoreAnfordernAction({
        csrfToken,
        umfang,
        ...(zeitpunkt.trim() !== '' ? { zeitpunkt: zeitpunkt.trim() } : {}),
        begruendung,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Anforderung liess sich nicht stellen.');
        return;
      }
      const daten = antwort.data as { gueltigBis: string };
      toast.success('Anforderung gestellt', {
        description:
          'Sie braucht jetzt die Zustimmung einer zweiten Person. Gueltig bis ' +
          new Date(daten.gueltigBis).toLocaleString('de-CH') +
          '.',
      });
      setBegruendung('');
      router.refresh();
    } finally {
      setLaeuft(false);
    }
  };

  const zuKurz = begruendung.trim().length < 20;

  return (
    <Panel
      title="Produktiven Restore anfordern"
      icon={<ShieldAlert />}
      description="Meldet eine Absicht an. Loest nichts aus."
    >
      <form onSubmit={absenden} className="space-y-5">
        <section
          aria-label="Was dabei geschieht"
          className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm"
        >
          <p className="font-medium text-warning">
            Ein produktiver Restore verwirft alles, was nach dem Zielzeitpunkt geschehen ist.
          </p>
          <p className="mt-2 text-muted-foreground">
            Jede Nachricht, jede Moderationsmassnahme, jeder Ticketverlauf seit diesem Zeitpunkt ist danach
            weg. Das ist nicht rückgängig zu machen.
          </p>
          <p className="mt-2 text-muted-foreground">
            Diese Anforderung setzt noch nichts zurück. Sie braucht die Zustimmung einer{' '}
            <strong className="text-foreground">zweiten Person</strong> und wird danach von einem Menschen auf
            der Kommandozeile ausgeführt.
          </p>
        </section>

        <div className="space-y-2">
          <Label htmlFor="restore-umfang">Umfang</Label>
          <div className="flex flex-wrap gap-2">
            {UMFAENGE.map((eintrag) => (
              <Button
                key={eintrag.wert}
                type="button"
                size="sm"
                variant={umfang === eintrag.wert ? 'default' : 'outline'}
                onClick={() => setUmfang(eintrag.wert)}
              >
                {eintrag.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="restore-zeitpunkt">Zielzeitpunkt</Label>
          <Input
            id="restore-zeitpunkt"
            name="zeitpunkt"
            value={zeitpunkt}
            onChange={(ereignis) => setZeitpunkt(ereignis.target.value)}
            placeholder="2026-09-25 14:31:00+02"
            className="font-mono"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">
            Leer lassen für den jüngstmöglichen Stand. Bei einer fehlerhaften Aktion ist ein Zeitpunkt{' '}
            <strong>unmittelbar davor</strong> der richtige - nicht der Zeitpunkt der Aktion selbst.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="restore-begruendung">
            Begründung <span className="text-muted-foreground">(Pflicht, mindestens 20 Zeichen)</span>
          </Label>
          <textarea
            id="restore-begruendung"
            name="begruendung"
            value={begruendung}
            onChange={(ereignis) => setBegruendung(ereignis.target.value)}
            rows={3}
            maxLength={2000}
            required
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            placeholder="Was ist passiert, und warum ist eine Wiederherstellung der richtige Weg?"
          />
          <p className="text-xs text-muted-foreground">
            Sie steht im Audit Log und ist das, was in einem halben Jahr die Frage beantwortet, weshalb an
            diesem Tag Daten verworfen wurden.
          </p>
        </div>

        <Button type="submit" variant="destructive" disabled={laeuft || zuKurz}>
          {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Anfordern
        </Button>
      </form>
    </Panel>
  );
}
