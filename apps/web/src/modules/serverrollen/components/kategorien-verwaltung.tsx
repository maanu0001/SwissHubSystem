'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  CircleDot,
  Columns3,
  Eye,
  EyeOff,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import type { serverrollen } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import type { ChannelOption } from '@/modules/configuration/components/discord-option-types';
import { formatDateTime } from '@swisshub/shared';
import {
  bearbeiteKategorieAction,
  entferneEmbedAction,
  erstelleKategorieAction,
  loescheKategorieAction,
  sendeEmbedAction,
  speichereEmbedAction,
} from '../actions';

/**
 * Die Gruppen, in denen die Rollen stehen.
 *
 * ## Warum Gruppen und keine flache Liste
 *
 * Weil fünfzig Rollen in einer Spalte niemand liest. «Spiele», «Pings»,
 * «Team», «Auszeichnungen» - die Gruppe sagt schon, worum es geht, und die
 * Reihenfolge der Gruppen ist die Dramaturgie der öffentlichen Seite.
 *
 * ## Löschen löst auf, es wirft nicht weg
 *
 * Das Datenmodell setzt `onDelete: SetNull`. Die Beschreibungen der Rollen
 * darin bleiben, sie rutschen nach «Sonstige». Eine Gruppe aufzulösen ist
 * etwas anderes, als die Textarbeit daran zu verlieren - und der Unterschied
 * steht auch im Bestätigungstext.
 */
export function KategorienVerwaltung({
  kategorien,
  channels,
  csrfToken,
}: {
  kategorien: serverrollen.KategorieFuerVerwaltung[];
  channels: ChannelOption[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [name, setName] = useState('');
  const [hinweis, setHinweis] = useState('');
  /*
   * Nur ein Embed-Kasten gleichzeitig offen.
   *
   * Acht aufgeklappte Kaesten waeren eine Seite, auf der man die Gruppen
   * nicht mehr findet - und der Kasten ist etwas, das man je Gruppe einmal
   * einstellt, nicht etwas, das man vergleicht.
   */
  const [offen, setOffen] = useState<string | null>(null);

  const anlegen = (): void => {
    if (name.trim().length === 0) {
      toast.error('Eine Gruppe braucht einen Namen.');
      return;
    }
    starte(async () => {
      const antwort = await erstelleKategorieAction({
        csrfToken,
        name: name.trim(),
        hinweis: hinweis.trim() || null,
        // Neue Gruppen hinten anstellen: eine neue Gruppe soll die bestehende
        // Reihenfolge nicht durcheinanderbringen.
        sortOrder: kategorien.length,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      setName('');
      setHinweis('');
      toast.success('Gruppe angelegt.');
      router.refresh();
    });
  };

  const aendern = (
    id: string,
    daten: {
      sortOrder?: number;
      publicVisible?: boolean;
      exklusiv?: boolean;
      spalten?: number;
      name?: string;
      hinweis?: string | null;
    },
  ): void => {
    starte(async () => {
      const antwort = await bearbeiteKategorieAction({ csrfToken, id, ...daten });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      router.refresh();
    });
  };

  const loeschen = (gruppe: serverrollen.KategorieFuerVerwaltung): void => {
    const frage =
      gruppe.anzahlRollen > 0
        ? `«${gruppe.name}» auflösen? Die ${gruppe.anzahlRollen} Rollen darin behalten ihre Beschreibung und stehen danach unter «Sonstige».`
        : `«${gruppe.name}» löschen?`;
    if (!window.confirm(frage)) {
      return;
    }
    starte(async () => {
      const antwort = await loescheKategorieAction({ csrfToken, id: gruppe.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Gruppe aufgelöst.');
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(ereignis) => setName(ereignis.target.value)}
          placeholder="Name der Gruppe, z. B. «Spiele»"
          maxLength={60}
          className="sm:max-w-xs"
        />
        <Input
          value={hinweis}
          onChange={(ereignis) => setHinweis(ereignis.target.value)}
          placeholder="Hinweis darunter (optional)"
          maxLength={200}
        />
        <Button type="button" onClick={anlegen} disabled={laeuft} className="shrink-0">
          <Plus className="size-4" aria-hidden="true" />
          Anlegen
        </Button>
      </div>

      {kategorien.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Gruppe. Ohne Gruppen stehen alle Rollen unter «Sonstige» - das geht, wird aber schnell
          lang.
        </p>
      ) : (
        <ul className="space-y-2">
          {kategorien.map((gruppe) => (
            <li key={gruppe.id} className="space-y-3 rounded-xl border border-border/70 bg-muted/30 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{gruppe.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {gruppe.hinweis ?? 'Kein Hinweis'} · {gruppe.anzahlRollen}{' '}
                    {gruppe.anzahlRollen === 1 ? 'Rolle' : 'Rollen'}
                  </p>
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Position
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    defaultValue={gruppe.sortOrder}
                    disabled={laeuft}
                    onBlur={(ereignis) => {
                      const wert = Number.parseInt(ereignis.target.value, 10);
                      if (Number.isFinite(wert) && wert !== gruppe.sortOrder) {
                        aendern(gruppe.id, { sortOrder: wert });
                      }
                    }}
                    className="h-9 w-20"
                  />
                </label>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={laeuft}
                  onClick={() => aendern(gruppe.id, { publicVisible: !gruppe.publicVisible })}
                  title={
                    gruppe.publicVisible
                      ? 'Auf der öffentlichen Seite sichtbar - klicken, um sie auszublenden'
                      : 'Ausgeblendet - klicken, um sie zu zeigen'
                  }
                >
                  {gruppe.publicVisible ? (
                    <Eye className="size-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="size-4" aria-hidden="true" />
                  )}
                  {gruppe.publicVisible ? 'Sichtbar' : 'Versteckt'}
                </Button>

                {/*
                 * Nur eine Rolle aus dieser Gruppe gleichzeitig.
                 *
                 * Ein Knopf und kein Haken, weil er in derselben Zeile steht wie
                 * «Sichtbar» und dasselbe tut: einen Zustand umschalten, den man
                 * am Knopf selbst ablesen kann.
                 */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={laeuft}
                  onClick={() => aendern(gruppe.id, { exklusiv: !gruppe.exklusiv })}
                  title={
                    gruppe.exklusiv
                      ? 'Nur eine Rolle aus dieser Gruppe gleichzeitig - klicken, um mehrere zu erlauben'
                      : 'Mehrere Rollen aus dieser Gruppe möglich - klicken, um auf eine zu beschränken'
                  }
                >
                  {gruppe.exklusiv ? (
                    <CircleDot className="size-4" aria-hidden="true" />
                  ) : (
                    <Layers className="size-4" aria-hidden="true" />
                  )}
                  {gruppe.exklusiv ? 'Nur eine' : 'Mehrere'}
                </Button>

                {/*
                 * Die Spaltenzahl der oeffentlichen Seite.
                 *
                 * Sie steht hier und nicht in den Moduleinstellungen, weil sie
                 * je Gruppe gilt: «Geschlecht» mit zwei Rollen braucht etwas
                 * anderes als «Spiele» mit zwanzig.
                 */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Columns3 className="size-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Spalten</span>
                  <Select
                    value={String(gruppe.spalten)}
                    onValueChange={(wert) => aendern(gruppe.id, { spalten: Number.parseInt(wert, 10) })}
                    disabled={laeuft}
                  >
                    <SelectTrigger className="h-9 w-[4.5rem]" aria-label={`Spalten für ${gruppe.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((zahl) => (
                        <SelectItem key={zahl} value={String(zahl)}>
                          {zahl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <Button
                  type="button"
                  variant={gruppe.embedMessageId ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setOffen(offen === gruppe.id ? null : gruppe.id)}
                  aria-expanded={offen === gruppe.id}
                >
                  <MessageSquare className="size-4" aria-hidden="true" />
                  {gruppe.embedMessageId ? 'Menü steht' : 'Discord-Menü'}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={laeuft}
                  onClick={() => loeschen(gruppe)}
                  aria-label={`${gruppe.name} auflösen`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {offen === gruppe.id ? (
                <EmbedKasten gruppe={gruppe} channels={channels} csrfToken={csrfToken} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Das Dropdown-Embed einer Gruppe.
 *
 * ## Warum «veroeffentlichen» und «aktualisieren» ein Knopf sind
 *
 * Weil es dieselbe Absicht ist: die Nachricht soll zeigen, was eingestellt
 * ist. Ob dafuer eine neue entsteht oder eine bestehende ueberschrieben wird,
 * haengt davon ab, ob schon eine steht - und das weiss der Server besser als
 * die Person vor dem Knopf. Zwei Knoepfe hiessen, dass man den falschen
 * druecken kann.
 *
 * Die Beschriftung sagt trotzdem, was passiert: «Veroeffentlichen», solange
 * keine Nachricht steht, «Aktualisieren», wenn eine steht, und
 * «Neu veroeffentlichen», wenn sie verschwunden ist.
 */
function EmbedKasten({
  gruppe,
  channels,
  csrfToken,
}: {
  gruppe: serverrollen.KategorieFuerVerwaltung;
  channels: ChannelOption[];
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [kanal, setKanal] = useState(gruppe.embedChannelId ?? '');
  const [titel, setTitel] = useState(gruppe.embedTitel ?? '');
  const [text, setText] = useState(gruppe.embedBeschreibung ?? '');
  const [farbe, setFarbe] = useState(gruppe.embedFarbe ?? '');

  const fehlt = gruppe.embedMessageId !== null && !gruppe.embedAktiv;

  const speichern = (weiter?: 'senden'): void => {
    starte(async () => {
      const gespeichert = await speichereEmbedAction({
        csrfToken,
        id: gruppe.id,
        channelId: kanal || null,
        titel: titel.trim() || null,
        beschreibung: text.trim() || null,
        farbe: farbe.trim() || null,
      });
      if (!gespeichert.ok) {
        toast.error(gespeichert.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (weiter !== 'senden') {
        toast.success('Gespeichert.');
        router.refresh();
        return;
      }
      const gesendet = await sendeEmbedAction({ csrfToken, id: gruppe.id });
      if (!gesendet.ok) {
        toast.error(gesendet.error?.message ?? 'Das Senden hat nicht geklappt.');
        return;
      }
      toast.success(gesendet.data?.neu ? 'Menü veröffentlicht.' : 'Menü aktualisiert.');
      router.refresh();
    });
  };

  const entfernen = (): void => {
    if (!window.confirm(`Das Rollenmenü von «${gruppe.name}» aus dem Kanal entfernen?`)) {
      return;
    }
    starte(async () => {
      const antwort = await entferneEmbedAction({ csrfToken, id: gruppe.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Menü entfernt.');
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`sr-kanal-${gruppe.id}`}>Kanal</Label>
          <ChannelSelect
            id={`sr-kanal-${gruppe.id}`}
            channels={channels}
            value={kanal}
            onChange={(naechster) => setKanal(naechster ?? '')}
            placeholder="Kein Kanal"
            disabled={laeuft}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`sr-titel-${gruppe.id}`}>Titel</Label>
          <Input
            id={`sr-titel-${gruppe.id}`}
            value={titel}
            onChange={(ereignis) => setTitel(ereignis.target.value)}
            placeholder={gruppe.name}
            maxLength={120}
            disabled={laeuft}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`sr-text-${gruppe.id}`}>Beschreibung</Label>
        <textarea
          id={`sr-text-${gruppe.id}`}
          value={text}
          onChange={(ereignis) => setText(ereignis.target.value)}
          placeholder={gruppe.hinweis ?? 'Wähle deine Rolle'}
          maxLength={500}
          rows={2}
          disabled={laeuft}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        {/* Leer heisst Vorgabe - und das soll dastehen, nicht erst auffallen. */}
        <p className="text-xs text-muted-foreground">Leer lassen übernimmt Gruppenname und Hinweis.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`sr-farbe-${gruppe.id}`}>Farbe</Label>
          <Input
            id={`sr-farbe-${gruppe.id}`}
            value={farbe}
            onChange={(ereignis) => setFarbe(ereignis.target.value)}
            placeholder="#e11d2e"
            maxLength={7}
            className="w-28"
            disabled={laeuft}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={laeuft || !kanal} onClick={() => speichern('senden')}>
            {gruppe.embedMessageId ? (
              <RefreshCw className="size-4" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {gruppe.embedMessageId ? 'Aktualisieren' : 'Veröffentlichen'}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={laeuft} onClick={() => speichern()}>
            Nur speichern
          </Button>
          {gruppe.embedMessageId ? (
            <Button type="button" variant="ghost" size="sm" disabled={laeuft} onClick={entfernen}>
              <Trash2 className="size-4" aria-hidden="true" />
              Entfernen
            </Button>
          ) : null}
        </div>
      </div>

      {/*
        Der Zustand in Worten.

        «Veroeffentlicht» allein waere zu wenig: wer wissen will, ob die
        Nachricht noch steht, braucht Kanal, Zeitpunkt und - im schlechten
        Fall - die Auskunft, dass sie weg ist.
      */}
      <div className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        <p>
          {gruppe.embedMessageId === null
            ? 'Noch nicht veröffentlicht.'
            : fehlt
              ? 'Die Nachricht ist auf Discord nicht mehr da - veröffentliche sie neu.'
              : 'Veröffentlicht.'}
          {gruppe.embedChannelId
            ? ` Kanal: #${channels.find((kanalEintrag) => kanalEintrag.id === gruppe.embedChannelId)?.name ?? gruppe.embedChannelId}.`
            : ''}
          {gruppe.embedAktualisiertAm
            ? ` Zuletzt geschrieben: ${formatDateTime(gruppe.embedAktualisiertAm)}.`
            : ''}
        </p>
        <p>
          {gruppe.embedOptionen === 0
            ? 'Im Menü stünde zurzeit keine Rolle - erst freigegebene und sichere Rollen erscheinen dort.'
            : `${gruppe.embedOptionen} ${gruppe.embedOptionen === 1 ? 'Rolle' : 'Rollen'} im Menü${gruppe.exklusiv ? ', davon eine wählbar' : ', mehrere wählbar'}.`}
        </p>
      </div>
    </div>
  );
}
