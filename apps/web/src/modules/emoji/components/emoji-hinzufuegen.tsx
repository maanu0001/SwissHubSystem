'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Link2, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fuegeEmojiHinzuAction, reicheEmojiEinAction } from '../actions';
import { cn } from '@/lib/utils';

/**
 * Ein Emoji hinzufügen oder vorschlagen.
 *
 * ## Ein Formular, zwei Ausgänge
 *
 * Dasselbe Formular - Name, Bild, optional eine Begründung - führt entweder
 * unmittelbar auf den Server (`direkt`) oder in die Moderation. Welcher Weg,
 * entscheidet die Berechtigung des Betrachters, und das Formular weiss es nur,
 * um den Knopf richtig zu benennen. Was geschieht, entscheidet die Aktion.
 *
 * ## Warum das Bild im Browser gelesen wird
 *
 * Weil eine Server Action ein Objekt nimmt und keine `File`. 256 KB als Base64
 * sind rund 350 KB - eine Zeile im Netzwerkprotokoll. Ein eigener
 * Upload-Endpunkt wäre eine zweite Tür mit eigener Prüfung.
 *
 * Die Prüfung findet trotzdem auf dem Server statt. Was hier passiert, ist
 * Bequemlichkeit: eine Datei, die offensichtlich zu gross ist, soll nicht erst
 * hochgeladen werden, um dann abgelehnt zu werden.
 */

/** Discords Grenze - hier nur, um früh zu warnen. Entschieden wird serverseitig. */
const MAX_BYTES = 256 * 1024;

export function EmojiHinzufuegen({
  csrfToken,
  direkt,
  importMoeglich,
  erlaubteHosts,
}: {
  csrfToken: string;
  /** Darf der Betrachter unmittelbar hinzufügen, oder reicht er einen Vorschlag ein? */
  direkt: boolean;
  importMoeglich: boolean;
  erlaubteHosts: string[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [name, setName] = useState('');
  const [begruendung, setBegruendung] = useState('');
  const [quelle, setQuelle] = useState('');
  const [datei, setDatei] = useState<File | null>(null);
  const [weg, setWeg] = useState<'datei' | 'adresse'>('datei');
  const dateiFeld = useRef<HTMLInputElement>(null);

  const zuruecksetzen = (): void => {
    setName('');
    setBegruendung('');
    setQuelle('');
    setDatei(null);
    if (dateiFeld.current) {
      dateiFeld.current.value = '';
    }
  };

  const absenden = (): void => {
    if (name.trim().length === 0) {
      toast.error('Gib dem Emoji einen Namen.');
      return;
    }
    if (weg === 'datei' && !datei) {
      toast.error('Wähle eine Datei.');
      return;
    }
    if (weg === 'adresse' && quelle.trim().length === 0) {
      toast.error('Gib eine Adresse an.');
      return;
    }
    if (datei && datei.size > MAX_BYTES) {
      toast.error(`Die Datei ist ${Math.round(datei.size / 1024)} KB gross. Discord nimmt 256 KB.`);
      return;
    }

    starte(async () => {
      const bild = datei
        ? {
            base64: Buffer.from(await datei.arrayBuffer()).toString('base64'),
            dateiName: datei.name,
          }
        : { quelle: quelle.trim() };

      const antwort = direkt
        ? await fuegeEmojiHinzuAction({ csrfToken, name: name.trim(), ...bild })
        : await reicheEmojiEinAction({
            csrfToken,
            name: name.trim(),
            begruendung: begruendung.trim() || null,
            ...bild,
          });

      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (!antwort.data.ok) {
        // Kein Fehler, sondern eine Antwort: «der Name ist vergeben» ist keine
        // Störung, sondern etwas, das die Person ändern kann.
        toast.error(antwort.data.grund ?? 'Das ging nicht.');
        return;
      }
      toast.success(
        direkt ? 'Das Emoji liegt auf dem Server.' : 'Der Vorschlag ist beim Team.',
        antwort.data.hinweis ? { description: antwort.data.hinweis } : undefined,
      );
      zuruecksetzen();
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['datei', 'Datei', Upload],
            ['adresse', 'Adresse', Link2],
          ] as const
        ).map(([wert, label, Symbol]) => (
          <button
            key={wert}
            type="button"
            onClick={() => setWeg(wert)}
            // Der Adressweg verschwindet, wenn kein Host freigegeben ist. Ein
            // Feld, das nichts annimmt, ist eine Einladung zu einer
            // Fehlermeldung.
            disabled={wert === 'adresse' && !importMoeglich}
            className={cn(
              'inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm transition',
              'disabled:cursor-not-allowed disabled:opacity-50',
              weg === wert
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border bg-background hover:bg-muted',
            )}
            title={
              wert === 'adresse' && !importMoeglich
                ? 'Der Import ist aus: in den Moduleinstellungen ist kein Host freigegeben.'
                : undefined
            }
          >
            <Symbol className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input
            value={name}
            onChange={(ereignis) => setName(ereignis.target.value)}
            placeholder="z. B. pog"
            maxLength={32}
          />
          <span className="block text-xs text-muted-foreground">
            Kleinbuchstaben, Ziffern und Unterstrich. So tippt man es später im Chat.
          </span>
        </label>

        {weg === 'datei' ? (
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Bild</span>
            <input
              ref={dateiFeld}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(ereignis) => setDatei(ereignis.target.files?.[0] ?? null)}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <span className="block text-xs text-muted-foreground">
              PNG, JPEG, GIF oder WebP, höchstens 256 KB. Discord verkleinert auf 128 Pixel.
            </span>
          </label>
        ) : (
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Adresse</span>
            <Input
              value={quelle}
              onChange={(ereignis) => setQuelle(ereignis.target.value)}
              placeholder="https://cdn.discordapp.com/..."
              inputMode="url"
            />
            <span className="block text-xs text-muted-foreground">
              {erlaubteHosts.length > 0
                ? `Erlaubt sind: ${erlaubteHosts.join(', ')}.`
                : 'Kein Host freigegeben.'}
            </span>
          </label>
        )}
      </div>

      {!direkt ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Begründung (optional)</span>
          <textarea
            value={begruendung}
            onChange={(ereignis) => setBegruendung(ereignis.target.value)}
            rows={2}
            maxLength={400}
            placeholder="Warum soll es dieses Emoji geben?"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      ) : null}

      <Button type="button" onClick={absenden} disabled={laeuft}>
        {laeuft ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Upload className="size-4" aria-hidden="true" />
        )}
        {direkt ? 'Hinzufügen' : 'Vorschlagen'}
      </Button>
    </div>
  );
}
