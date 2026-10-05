'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import type {
  WorkspaceAttachment,
  WorkspaceChecklistItem,
  WorkspaceComment,
  WorkspaceLink,
} from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Markdown } from '@/components/shared/markdown';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';
import { zeitpunktText } from '../labels';
import {
  workspaceAnhangLoeschenAction,
  workspaceChecklisteAbhakenAction,
  workspaceChecklisteErgaenzenAction,
  workspaceChecklisteLoeschenAction,
  workspaceKommentarLoeschenAction,
  workspaceKommentarSchreibenAction,
  workspaceLinkErgaenzenAction,
  workspaceLinkLoeschenAction,
} from '../actions';
import type { Teammitglied } from '../daten';

/**
 * Was an einer Aufgabe mitgeschrieben wird.
 *
 * Vier kleine Komponenten statt einer grossen: Kommentare, Checkliste, Links
 * und Anhänge stehen in eigenen Panels und haben nichts voneinander zu wissen.
 */

type Antwort = { ok: boolean; error?: { message: string } | null };

function useAufruf(): [boolean, (aufruf: () => Promise<Antwort>, erfolg?: string) => void] {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const ruf = (aufruf: () => Promise<Antwort>, erfolg?: string): void => {
    starte(async () => {
      const antwort = await aufruf();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (erfolg) {
        toast.success(erfolg);
      }
      router.refresh();
    });
  };
  return [laeuft, ruf];
}

/**
 * Kommentare.
 *
 * ## Warum Markdown, und warum dieses
 *
 * Weil Leute Listen und Fettschrift schreiben, ob der Darsteller es kann oder
 * nicht. Benutzt wird der bestehende kleine Darsteller aus dem Turniermodul:
 * er erzeugt React-Elemente und kein HTML, es gibt also keinen Weg, über den
 * fremdes Markup in die Seite käme. Ein Paket, das HTML erzeugt und danach
 * bereinigt, wäre die Bauart, bei der eine Lücke überhaupt erst möglich wird.
 *
 * ## Warum die Erwähnung als `<@id>` gespeichert wird
 *
 * Weil ein Name sich ändert. Stünde «@anna» im Text, hiesse der Kommentar in
 * einem Jahr noch so, auch wenn Anna inzwischen anders heisst - und eine Suche
 * nach ihren Erwähnungen fände ihn nicht. Die Kennung ist beständig, der Name
 * wird beim Anzeigen dazugeholt.
 */
export function Kommentare({
  csrfToken,
  taskId,
  kommentare,
  namen,
  team,
  eigeneKennung,
  darfSchreiben,
}: {
  csrfToken: string;
  taskId: string;
  kommentare: WorkspaceComment[];
  namen: Record<string, Teammitglied>;
  team: Teammitglied[];
  eigeneKennung: string;
  darfSchreiben: boolean;
}): React.JSX.Element {
  const [laeuft, ruf] = useAufruf();
  const [text, setText] = useState('');
  const feld = useRef<HTMLTextAreaElement>(null);

  const erwaehnungen = Object.fromEntries(
    Object.entries(namen).map(([kennung, person]) => [kennung, person.name]),
  );

  /** Eine Erwähnung an der Schreibmarke einfügen - nicht am Ende. */
  const erwaehne = (discordId: string): void => {
    const element = feld.current;
    const marke = element?.selectionStart ?? text.length;
    const vorher = text.slice(0, marke);
    const nachher = text.slice(marke);
    // Ein Leerzeichen davor, wenn nicht ohnehin eines da ist: sonst klebt die
    // Erwähnung am vorherigen Wort und Discords Form stimmt nicht mehr.
    const trenner = vorher === '' || vorher.endsWith(' ') ? '' : ' ';
    setText(`${vorher}${trenner}<@${discordId}> ${nachher}`);
    element?.focus();
  };

  const schreiben = (): void => {
    if (text.trim() === '') {
      toast.error('Der Kommentar ist leer.');
      return;
    }
    ruf(async () => {
      const antwort = await workspaceKommentarSchreibenAction({ csrfToken, taskId, text });
      if (antwort.ok) {
        setText('');
      }
      return antwort;
    });
  };

  return (
    <div className={cn('space-y-4', laeuft && 'opacity-70')}>
      {kommentare.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch kein Kommentar. Hier steht später, warum etwas so entschieden wurde - die Frage, die in drei
          Wochen jemand stellt.
        </p>
      ) : (
        <ol className="space-y-4">
          {kommentare.map((kommentar) => {
            const person = namen[kommentar.authorDiscordId];
            return (
              <li key={kommentar.id} className="flex gap-3">
                <DiscordAvatar
                  discordId={kommentar.authorDiscordId}
                  avatarHash={person?.avatarHash ?? null}
                  name={person?.name ?? kommentar.authorDiscordId}
                  size={28}
                  ring={false}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{person?.name ?? kommentar.authorDiscordId}</span>
                    <span className="text-xs text-muted-foreground">
                      {zeitpunktText(kommentar.createdAt)}
                    </span>
                    {kommentar.authorDiscordId === eigeneKennung ? (
                      <button
                        type="button"
                        onClick={(): void =>
                          ruf(
                            () =>
                              workspaceKommentarLoeschenAction({
                                csrfToken,
                                kommentarId: kommentar.id,
                                taskId,
                              }),
                            'Kommentar gelöscht.',
                          )
                        }
                        className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                      >
                        Löschen
                      </button>
                    ) : null}
                  </div>
                  <Markdown text={kommentar.body} erwaehnungen={erwaehnungen} className="space-y-2" />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {darfSchreiben ? (
        <div className="space-y-2 border-t border-border/60 pt-4">
          <textarea
            ref={feld}
            value={text}
            rows={3}
            maxLength={4000}
            onChange={(ereignis): void => setText(ereignis.target.value)}
            placeholder="Was gehört dazu? **fett**, *kursiv*, Listen mit - und Erwähnungen über die Knöpfe."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {team.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">Erwähnen:</span>
              {team.map((mitglied) => (
                <button
                  key={mitglied.discordId}
                  type="button"
                  onClick={(): void => erwaehne(mitglied.discordId)}
                  className="min-h-11 rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  @{mitglied.name}
                </button>
              ))}
            </div>
          ) : null}
          <Button size="sm" onClick={schreiben} disabled={laeuft}>
            Kommentieren
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Die Checkliste.
 *
 * Abhaken hinterlässt keinen Verlaufseintrag - eine Checkliste wird im
 * Minutentakt angefasst, und vierzig Zeilen «Checkliste geändert» verdecken die
 * drei Einträge, auf die es ankommt.
 */
export function Checkliste({
  csrfToken,
  taskId,
  punkte,
  darfBearbeiten,
}: {
  csrfToken: string;
  taskId: string;
  punkte: WorkspaceChecklistItem[];
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const [laeuft, ruf] = useAufruf();
  const [neu, setNeu] = useState('');

  const erledigt = punkte.filter((punkt) => punkt.erledigt).length;

  return (
    <div className={cn('space-y-3', laeuft && 'opacity-70')}>
      {punkte.length > 0 ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {erledigt} von {punkte.length} erledigt
        </p>
      ) : null}

      <ul className="space-y-1">
        {punkte.map((punkt) => (
          <li key={punkt.id} className="flex items-center gap-2">
            <label
              className={cn(
                'flex min-h-11 flex-1 items-center gap-2 text-sm',
                darfBearbeiten ? 'cursor-pointer' : 'cursor-default',
                punkt.erledigt && 'text-muted-foreground line-through',
              )}
            >
              <input
                type="checkbox"
                checked={punkt.erledigt}
                disabled={!darfBearbeiten}
                onChange={(ereignis): void =>
                  ruf(() =>
                    workspaceChecklisteAbhakenAction({
                      csrfToken,
                      punktId: punkt.id,
                      taskId,
                      erledigt: ereignis.target.checked,
                    }),
                  )
                }
                className="size-4 rounded border-input"
              />
              {punkt.text}
            </label>
            {darfBearbeiten ? (
              <button
                type="button"
                aria-label={`«${punkt.text}» entfernen`}
                onClick={(): void =>
                  ruf(() => workspaceChecklisteLoeschenAction({ csrfToken, punktId: punkt.id, taskId }))
                }
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {punkte.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine Checkliste. Für eine Aufgabe aus mehreren Schritten ist sie der Unterschied zwischen «in
          Arbeit» und «noch zwei von fünf».
        </p>
      ) : null}

      {darfBearbeiten ? (
        <form
          onSubmit={(ereignis): void => {
            ereignis.preventDefault();
            if (neu.trim() === '') {
              return;
            }
            ruf(async () => {
              const antwort = await workspaceChecklisteErgaenzenAction({
                csrfToken,
                taskId,
                text: neu,
              });
              if (antwort.ok) {
                setNeu('');
              }
              return antwort;
            });
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={neu}
            maxLength={200}
            onChange={(ereignis): void => setNeu(ereignis.target.value)}
            placeholder="Nächster Schritt"
            aria-label="Punkt hinzufügen"
          />
          <Button type="submit" variant="outline" size="sm" disabled={laeuft}>
            <Plus className="size-4" />
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Links.
 *
 * Der Weg zu allem, was nicht hier liegt: ein Dokument, ein Design, ein
 * Discord-Beitrag. Geprüft wird die Adresse serverseitig - nur `http` und
 * `https`, und ohne Zugangsdaten darin.
 */
export function Links({
  csrfToken,
  bezug,
  links,
  darfBearbeiten,
}: {
  csrfToken: string;
  bezug: { taskId: string } | { projectId: string };
  links: WorkspaceLink[];
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const [laeuft, ruf] = useAufruf();
  const [titel, setTitel] = useState('');
  const [url, setUrl] = useState('');

  return (
    <div className={cn('space-y-3', laeuft && 'opacity-70')}>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kein Link.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-2">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-primary underline underline-offset-2"
              >
                {link.title}
              </a>
              {darfBearbeiten ? (
                <button
                  type="button"
                  aria-label={`«${link.title}» entfernen`}
                  onClick={(): void =>
                    ruf(() => workspaceLinkLoeschenAction({ csrfToken, linkId: link.id, ...bezug }))
                  }
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {darfBearbeiten ? (
        <form
          onSubmit={(ereignis): void => {
            ereignis.preventDefault();
            if (url.trim() === '') {
              return;
            }
            ruf(async () => {
              const antwort = await workspaceLinkErgaenzenAction({ csrfToken, titel, url, ...bezug });
              if (antwort.ok) {
                setTitel('');
                setUrl('');
              }
              return antwort;
            }, 'Link hinzugefügt.');
          }}
          className="space-y-2"
        >
          <Input
            value={titel}
            maxLength={120}
            onChange={(ereignis): void => setTitel(ereignis.target.value)}
            placeholder="Beschriftung (optional)"
            aria-label="Beschriftung des Links"
          />
          <div className="flex items-center gap-2">
            <Input
              type="url"
              value={url}
              maxLength={2000}
              onChange={(ereignis): void => setUrl(ereignis.target.value)}
              placeholder="https://…"
              aria-label="Adresse"
            />
            <Button type="submit" variant="outline" size="sm" disabled={laeuft}>
              <Plus className="size-4" />
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Anhänge.
 *
 * ## Warum der Upload kein Formular an eine Server Action ist
 *
 * Weil eine Datei darüber nicht übertragbar ist. Er geht an einen Route
 * Handler mit derselben Sicherheitskette - und dort an dieselbe
 * Upload-Infrastruktur wie jedes andere Bild im System.
 *
 * Dass nur Bilder gehen, steht auch hier: ein Hinweis, der sagt, was möglich
 * ist, ist besser als eine Fehlermeldung nach der Übertragung.
 */
export function Anhaenge({
  csrfToken,
  bezug,
  anhaenge,
  namen,
  maxBytes,
  darfBearbeiten,
}: {
  csrfToken: string;
  bezug: { taskId: string } | { projectId: string };
  anhaenge: WorkspaceAttachment[];
  namen: Record<string, Teammitglied>;
  maxBytes: number;
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, ruf] = useAufruf();
  const [laedt, setLaedt] = useState(false);
  const eingabe = useRef<HTMLInputElement>(null);

  const hochladen = async (datei: File): Promise<void> => {
    if (datei.size > maxBytes) {
      toast.error(`Die Datei ist zu gross (maximal ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      return;
    }
    setLaedt(true);
    try {
      const formular = new FormData();
      formular.set('csrfToken', csrfToken);
      formular.set('datei', datei);
      if ('taskId' in bezug) {
        formular.set('taskId', bezug.taskId);
      } else {
        formular.set('projectId', bezug.projectId);
      }
      const antwort = await fetch('/api/workspace/upload', { method: 'POST', body: formular });
      const ergebnis = (await antwort.json()) as Antwort;
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Anhang hinzugefügt.');
      router.refresh();
    } catch {
      toast.error('Die Datei liess sich nicht übertragen.');
    } finally {
      setLaedt(false);
      if (eingabe.current) {
        // Zurücksetzen, damit dieselbe Datei noch einmal gewählt werden kann -
        // sonst löst ein zweiter Versuch kein `change` aus.
        eingabe.current.value = '';
      }
    }
  };

  return (
    <div className={cn('space-y-3', (laeuft || laedt) && 'opacity-70')}>
      {anhaenge.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kein Anhang.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {anhaenge.map((anhang) => (
            <li key={anhang.id} className="space-y-1 rounded-lg border border-border p-2">
              {/* Kein `next/image`: das Bild liegt hinter einem geschützten
                  Endpunkt, und der Optimierer müsste es selbst abrufen. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/workspace/anhang/${anhang.id}`}
                alt={anhang.anzeigeName}
                className="h-32 w-full rounded object-cover"
                loading="lazy"
              />
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs" title={anhang.anzeigeName}>
                  {anhang.anzeigeName}
                </span>
                {darfBearbeiten ? (
                  <button
                    type="button"
                    aria-label={`«${anhang.anzeigeName}» entfernen`}
                    onClick={(): void =>
                      ruf(() => workspaceAnhangLoeschenAction({ csrfToken, anhangId: anhang.id, ...bezug }))
                    }
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {Math.max(1, Math.round(anhang.bytes / 1024))} KB ·{' '}
                {namen[anhang.uploadedByDiscordId]?.name ?? anhang.uploadedByDiscordId}
              </p>
            </li>
          ))}
        </ul>
      )}

      {darfBearbeiten ? (
        <div className="space-y-1">
          <input
            ref={eingabe}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(ereignis): void => {
              const datei = ereignis.target.files?.[0];
              if (datei) {
                void hochladen(datei);
              }
            }}
          />
          <Button variant="outline" size="sm" disabled={laedt} onClick={(): void => eingabe.current?.click()}>
            <Paperclip className="size-4" />
            {laedt ? 'Wird übertragen …' : 'Bild anhängen'}
          </Button>
          <p className="text-xs text-muted-foreground">
            PNG, JPG oder WEBP, bis {Math.round(maxBytes / 1024 / 1024)} MB. Für ein Dokument nimm einen Link
            - dann bleibt es dort, wo es gepflegt wird.
          </p>
        </div>
      ) : null}
    </div>
  );
}
