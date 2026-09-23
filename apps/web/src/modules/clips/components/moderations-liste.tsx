'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Flag, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import {
  clipAblehnenAction,
  clipEntfernenAction,
  clipFreigebenAction,
  clipMeldungenErledigenAction,
} from '@/modules/clips/admin-actions';
import { cn } from '@/lib/utils';
import type { clips } from '@swisshub/modules';

type Grund = 'INAPPROPRIATE' | 'NO_GAMING' | 'BROKEN' | 'RIGHTS' | 'DUPLICATE' | 'OTHER';

const GRUENDE: Array<{ key: Grund; label: string }> = [
  { key: 'INAPPROPRIATE', label: 'Unpassender Inhalt' },
  { key: 'NO_GAMING', label: 'Kein Gaming-Bezug' },
  { key: 'BROKEN', label: 'Clip funktioniert nicht' },
  { key: 'RIGHTS', label: 'Rechte unklar' },
  { key: 'DUPLICATE', label: 'Mehrfach eingereicht' },
  { key: 'OTHER', label: 'Sonstiges' },
];

export interface ModerationsEintragMitEinbettung {
  eintrag: clips.ModerationsEintrag;
  einbettung: string;
}

/**
 * Die Warteschlange der Moderation.
 *
 * ## Der Clip steht im Mittelpunkt, nicht die Tabelle
 *
 * Ueber einen Clip laesst sich nicht anhand einer Zeile entscheiden - man
 * muss ihn gesehen haben. Der Player ist deshalb Teil des Eintrags und nicht
 * hinter einem Knopf versteckt.
 *
 * ## Ablehnen braucht einen Grund
 *
 * Er landet im Protokoll und in der Rueckmeldung an die Person, die
 * eingereicht hat. Eine Ablehnung ohne Begruendung ist der sicherste Weg, im
 * naechsten Ticket erklaeren zu muessen, was los war.
 */
export function ModerationsListe({
  eintraege,
  csrfToken,
}: {
  eintraege: ModerationsEintragMitEinbettung[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [ablehnen, setAblehnen] = useState<clips.ModerationsEintrag | null>(null);

  async function fuehreAus(
    schluessel: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    if (laeuft) {
      return;
    }
    setLaeuft(schluessel);
    const antwort = await aktion();
    setLaeuft(null);

    if (!antwort.ok) {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
      return;
    }
    toast.success(erfolg);
    router.refresh();
  }

  if (eintraege.length === 0) {
    return (
      <EmptyState title="Nichts zu tun" description="Alle Einreichungen dieser Runde sind entschieden." />
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        {eintraege.map(({ eintrag, einbettung }) => {
          const name = eintrag.einreicher.displayName ?? eintrag.einreicher.username ?? 'Unbekannt';
          return (
            <article
              key={eintrag.entryId}
              className={cn(
                'overflow-hidden rounded-2xl border bg-card',
                eintrag.meldungen > 0 ? 'border-destructive/50' : 'border-border',
              )}
            >
              <div className="bg-black">
                <iframe
                  src={einbettung}
                  title={eintrag.titel}
                  className="aspect-video w-full"
                  allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                  referrerPolicy="strict-origin-when-cross-origin"
                  loading="lazy"
                />
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{eintrag.titel}</h3>
                    {eintrag.beschreibung ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {eintrag.beschreibung}
                      </p>
                    ) : null}
                  </div>
                  {eintrag.meldungen > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
                      <Flag className="size-3" aria-hidden="true" />
                      {eintrag.meldungen}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DiscordAvatar
                    discordId={eintrag.einreicher.discordId}
                    avatarHash={eintrag.einreicher.avatarHash}
                    name={name}
                    size={20}
                  />
                  <span className="truncate">{name}</span>
                  {eintrag.spiel ? <span className="truncate">· {eintrag.spiel}</span> : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void fuehreAus(
                        `frei:${eintrag.entryId}`,
                        () => clipFreigebenAction({ csrfToken, entryId: eintrag.entryId }),
                        'Clip freigegeben.',
                      )
                    }
                    disabled={laeuft !== null}
                  >
                    {laeuft === `frei:${eintrag.entryId}` ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="size-4" aria-hidden="true" />
                    )}
                    Freigeben
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAblehnen(eintrag)}
                    disabled={laeuft !== null}
                  >
                    <X className="size-4" aria-hidden="true" />
                    Ablehnen
                  </Button>

                  {eintrag.meldungen > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void fuehreAus(
                          `meldung:${eintrag.clipId}`,
                          () => clipMeldungenErledigenAction({ csrfToken, clipId: eintrag.clipId }),
                          'Meldungen als erledigt markiert.',
                        )
                      }
                      disabled={laeuft !== null}
                    >
                      Meldungen erledigt
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void fuehreAus(
                        `raus:${eintrag.entryId}`,
                        () => clipEntfernenAction({ csrfToken, entryId: eintrag.entryId }),
                        'Clip aus der Runde genommen.',
                      )
                    }
                    disabled={laeuft !== null}
                  >
                    Aus der Runde
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <AblehnDialog
        eintrag={ablehnen}
        csrfToken={csrfToken}
        aufSchliessen={() => setAblehnen(null)}
        aufErledigt={() => {
          setAblehnen(null);
          router.refresh();
        }}
      />
    </>
  );
}

function AblehnDialog({
  eintrag,
  csrfToken,
  aufSchliessen,
  aufErledigt,
}: {
  eintrag: clips.ModerationsEintrag | null;
  csrfToken: string;
  aufSchliessen: () => void;
  aufErledigt: () => void;
}): React.JSX.Element {
  const [grund, setGrund] = useState<Grund | null>(null);
  const [notiz, setNotiz] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function ablehnen(): Promise<void> {
    if (!eintrag || !grund || laeuft) {
      return;
    }
    setLaeuft(true);
    const antwort = await clipAblehnenAction({
      csrfToken,
      entryId: eintrag.entryId,
      grund,
      ...(notiz.trim() ? { notiz: notiz.trim() } : {}),
    });
    setLaeuft(false);

    if (!antwort.ok) {
      toast.error(antwort.error.message);
      return;
    }
    toast.success('Clip abgelehnt.');
    setGrund(null);
    setNotiz('');
    aufErledigt();
  }

  return (
    <Dialog open={eintrag !== null} onOpenChange={(offen) => !offen && aufSchliessen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clip ablehnen</DialogTitle>
        </DialogHeader>

        <p className="truncate text-sm text-muted-foreground">{eintrag?.titel}</p>

        <div className="grid grid-cols-2 gap-2">
          {GRUENDE.map((eintragGrund) => (
            <button
              key={eintragGrund.key}
              type="button"
              onClick={() => setGrund(eintragGrund.key)}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-left text-sm transition',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                grund === eintragGrund.key
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/40',
              )}
            >
              {eintragGrund.label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ablehn-notiz">Notiz {grund === 'OTHER' ? '(erforderlich)' : '(optional)'}</Label>
          <Input
            id="ablehn-notiz"
            value={notiz}
            maxLength={300}
            onChange={(ereignis) => setNotiz(ereignis.target.value)}
            placeholder="Die Person sieht diesen Text."
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={aufSchliessen}>
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            onClick={() => void ablehnen()}
            disabled={!grund || laeuft || (grund === 'OTHER' && notiz.trim().length < 3)}
          >
            {laeuft ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Ablehnen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
