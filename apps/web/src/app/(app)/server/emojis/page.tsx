import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, History, Info, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { emoji } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmojiHinzufuegen } from '@/modules/emoji/components/emoji-hinzufuegen';
import { KatalogListe } from '@/modules/emoji/components/katalog-liste';
import { VorschlagKarte } from '@/modules/emoji/components/vorschlag-karte';
import { auditActionLabel } from '@/modules/audit/labels';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Emojis' };
export const dynamic = 'force-dynamic';

/**
 * Der Emoji-Bereich - sechs Abschnitte in der Reihenfolge, in der man sie
 * braucht.
 *
 * 1. **Plätze.** Die Frage, die sich zuerst stellt: passt überhaupt noch eines
 *    hinein? Getrennt für feste und animierte, weil Discord getrennt zählt.
 * 2. **Was fehlt.** Hinweise zur Einrichtung - ein Modul, das lautlos die
 *    Hälfte nicht tut, sieht aus wie ein Modul, das kaputt ist.
 * 3. **Hinzufügen oder vorschlagen.** Ein Formular, zwei Ausgänge; welchen,
 *    entscheidet die Berechtigung.
 * 4. **Offene Vorschläge.** Die Arbeit, die wartet.
 * 5. **Laufende Abstimmungen.** Mit Stand und Frist.
 * 6. **Der Katalog** und darunter **der Verlauf.**
 *
 * Alles aus einem Aufruf: `ladeBereich` fragt Discord einmal und die Datenbank
 * dreimal. Sechs eigene Serverfunktionen wären sechs Runden und zweimal
 * dieselbe Emoji-Liste.
 */
export default async function EmojiSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(emoji.EMOJI_PERMISSIONS.view);
  const bereich = await emoji.ladeBereich();

  const csrfToken = csrfTokenFor(context);
  const darfVerwalten = can(context, emoji.EMOJI_PERMISSIONS.manage);
  const darfEntscheiden = can(context, emoji.EMOJI_PERMISSIONS.moderate);
  const darfVorschlagen = can(context, emoji.EMOJI_PERMISSIONS.request);

  /*
   * Der Hinweis zum Bot-Recht steht getrennt und zuerst.
   *
   * Er ist von anderer Art als die uebrigen: ohne «Ausdruecke verwalten»
   * funktioniert **nichts** auf dieser Seite, waehrend ein fehlender
   * Moderationskanal nur eine Bequemlichkeit kostet. Ihn in dieselbe Liste zu
   * stellen hiesse, den einen Satz zu verstecken, auf den es ankommt.
   */
  const botRecht =
    bereich.plaetze.botDarf === false
      ? 'Dem Bot fehlt auf Discord das Recht «Ausdrücke verwalten». Ohne es kann er kein Emoji anlegen, umbenennen oder löschen - Discord lehnt jeden Versuch ab. Gib der Bot-Rolle das Recht in den Servereinstellungen von Discord.'
      : bereich.plaetze.botDarf === null
        ? 'Ob der Bot «Ausdrücke verwalten» hat, liess sich gerade nicht ermitteln. Hinzufügen funktioniert möglicherweise trotzdem; scheitert es mit einem Rechtefehler, liegt es daran.'
        : null;

  const hinweise = [
    bereich.einrichtung.ohneModerationskanal
      ? 'Vorschläge sind an, aber es ist kein Moderationskanal gesetzt - sie erscheinen nur hier und nicht auf Discord.'
      : null,
    bereich.einrichtung.ohneAbstimmungskanal
      ? 'Die Community-Abstimmung ist an, aber es ist kein Abstimmungskanal gesetzt - niemand kann klicken.'
      : null,
    bereich.einrichtung.ohneImport
      ? 'Der Import von Adressen ist aus: in den Moduleinstellungen ist kein Host freigegeben. Hochladen geht trotzdem.'
      : null,
  ].filter((eintrag): eintrag is string => eintrag !== null);

  return (
    <div className="space-y-6">
      {/*
        Keine eigene Hauptueberschrift: die eine der Anwendung steht in
        `AppHeader` und kommt aus der Route.
      */}
      <p className="max-w-2xl text-sm text-muted-foreground">
        Emojis verwalten und Vorschläge entscheiden. Das Discord-Recht «Ausdrücke verwalten» braucht dafür nur
        der Bot - nicht jede Person, die ein Emoji hinzufügen darf.
      </p>

      {/* 1. Plätze */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PlatzKachel titel="Feste Emojis" stand={bereich.plaetze.fest} />
        <PlatzKachel titel="Animierte Emojis" stand={bereich.plaetze.animiert} />
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Boost-Stufe</CardDescription>
            <CardTitle className="text-2xl">{bereich.plaetze.boostStufe}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Die Stufe entscheidet über die Zahl der Plätze - je Art 50, 100, 150 oder 250.
            {bereich.einstellungen.reservePlaetze > 0 ? (
              <> {bereich.einstellungen.reservePlaetze} Plätze bleiben für das Team reserviert.</>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* 2. Was fehlt - das Bot-Recht zuerst, weil ohne es nichts geht */}
      {botRecht ? (
        <Card
          className={cn(
            bereich.plaetze.botDarf === false ? 'border-destructive/50' : 'border-amber-500/40',
          )}
        >
          <CardContent className="flex items-start gap-3 py-5 text-sm">
            <AlertTriangle
              className={cn(
                'mt-0.5 size-5 shrink-0',
                bereich.plaetze.botDarf === false ? 'text-destructive' : 'text-amber-500',
              )}
              aria-hidden="true"
            />
            <p className="text-pretty">{botRecht}</p>
          </CardContent>
        </Card>
      ) : null}

      {hinweise.length > 0 ? (
        <Card className="border-amber-500/40">
          <CardContent className="space-y-2 py-5 text-sm">
            {hinweise.map((hinweis) => (
              <p key={hinweis} className="flex items-start gap-2 text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
                {hinweis}
              </p>
            ))}
            <p className="pt-1">
              <Link href="/modules/emoji" className="text-xs underline">
                Zu den Moduleinstellungen
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* 3. Hinzufügen oder vorschlagen */}
      {darfVerwalten || darfVorschlagen ? (
        <Card>
          <CardHeader>
            <CardTitle>{darfVerwalten ? 'Emoji hinzufügen' : 'Emoji vorschlagen'}</CardTitle>
            <CardDescription>
              {darfVerwalten
                ? 'Liegt unmittelbar auf dem Server. Name und Bild werden vorher geprüft - Discords Fehlermeldung nennt keinen Grund.'
                : 'Das Team entscheidet. Du siehst unter «Meine Vorschläge», was daraus geworden ist.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmojiHinzufuegen
              csrfToken={csrfToken}
              direkt={darfVerwalten}
              importMoeglich={!bereich.einrichtung.ohneImport}
              erlaubteHosts={bereich.einrichtung.erlaubteHosts}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* 4. Offene Vorschläge */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Offene Vorschläge
            {bereich.offene.length > 0 ? <Badge>{bereich.offene.length}</Badge> : null}
          </CardTitle>
          <CardDescription>
            Annehmen legt das Emoji sofort auf dem Server ab. «Abstimmen lassen» gibt die Entscheidung an die
            Community weiter - das ist kein Veto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bereich.offene.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nichts offen.</p>
          ) : (
            <ul className="space-y-3">
              {bereich.offene.map((antrag) => (
                <VorschlagKarte
                  key={antrag.id}
                  antrag={antrag}
                  csrfToken={csrfToken}
                  vorschauUrl={antrag.bildVerfuegbar ? emoji.vorschauPfad(antrag.id) : null}
                  darfEntscheiden={darfEntscheiden}
                  abstimmungMoeglich={bereich.einstellungen.abstimmungAktiv}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 5. Laufende Abstimmungen */}
      {bereich.abstimmungen.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" aria-hidden="true" />
              Laufende Abstimmungen
            </CardTitle>
            <CardDescription>
              Ziel und Frist stehen fest, seit die Abstimmung begann - eine Änderung der Einstellungen wirkt
              erst auf die nächste.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {bereich.abstimmungen.map((antrag) => (
                <VorschlagKarte
                  key={antrag.id}
                  antrag={antrag}
                  csrfToken={csrfToken}
                  vorschauUrl={antrag.bildVerfuegbar ? emoji.vorschauPfad(antrag.id) : null}
                  darfEntscheiden={darfEntscheiden}
                  abstimmungMoeglich={false}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* 6a. Der Katalog */}
      <Card>
        <CardHeader>
          <CardTitle>Emojis auf dem Server</CardTitle>
          <CardDescription>
            Kommt bei jedem Aufruf von Discord. Emojis einer Integration - etwa Twitch-Abos - lassen sich
            nicht ändern; sie stehen gesperrt in der Liste, statt zu fehlen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KatalogListe katalog={bereich.katalog} csrfToken={csrfToken} darfVerwalten={darfVerwalten} />
        </CardContent>
      </Card>

      {/* 6b. Der Verlauf */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" aria-hidden="true" />
            Verlauf
          </CardTitle>
          <CardDescription>
            Derselbe Verlauf wie im Audit Log, gefiltert auf dieses Modul - kein zweites Protokoll daneben.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bereich.verlauf.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch nichts passiert.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {bereich.verlauf.map((eintrag) => (
                <li
                  key={eintrag.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 odd:bg-muted/30"
                >
                  <span className={cn('font-medium', !eintrag.success && 'text-destructive')}>
                    {auditActionLabel(eintrag.action)}
                  </span>
                  {eintrag.targetLabel ? <code className="text-xs">:{eintrag.targetLabel}:</code> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {eintrag.createdAt.toLocaleString('de-CH', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-3 text-xs text-muted-foreground">
            <Link href="/audit?module=emoji" className="underline">
              Den vollständigen Verlauf im Audit Log ansehen
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* Die eigenen Vorschläge - nur für die, die vorschlagen dürfen. */}
      {darfVorschlagen && !darfEntscheiden ? <EigeneVorschlaege discordId={context.user.discordId} /> : null}

      {/* Entschiedene Vorschläge - die Antwort auf «was ist daraus geworden?» */}
      {darfEntscheiden && bereich.entschieden.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Entschiedene Vorschläge</CardTitle>
            <CardDescription>
              «Abgelaufen» heisst: die Abstimmung erreichte das Ziel nicht. Entschieden ist damit nichts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {bereich.entschieden.slice(0, 25).map((antrag) => (
                <li
                  key={antrag.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 odd:bg-muted/30"
                >
                  <code className="text-xs">:{antrag.emojiName ?? antrag.name}:</code>
                  <Badge variant={antrag.status === 'ANGENOMMEN' ? 'secondary' : 'outline'}>
                    {ZUSTAND[antrag.status]}
                  </Badge>
                  {antrag.ablehnungsGrund ? (
                    <span className="text-xs text-muted-foreground">{antrag.ablehnungsGrund}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const ZUSTAND: Record<string, string> = {
  ANGENOMMEN: 'angenommen',
  ABGELEHNT: 'abgelehnt',
  ABGELAUFEN: 'Abstimmung ohne Ergebnis',
};

function PlatzKachel({ titel, stand }: { titel: string; stand: emoji.PlatzStand }): React.JSX.Element {
  const anteil = stand.gesamt > 0 ? Math.min(100, Math.round((stand.belegt / stand.gesamt) * 100)) : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{titel}</CardDescription>
        <CardTitle className="text-2xl">
          {stand.belegt}
          <span className="text-base font-normal text-muted-foreground"> / {stand.gesamt}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', anteil >= 90 ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${anteil}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {stand.frei} frei
          {stand.stillgelegt > 0 ? (
            <>
              {' · '}
              {stand.stillgelegt} stillgelegt (belegen trotzdem einen Platz)
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Die eigenen Vorschläge.
 *
 * Für jemanden ohne Entscheidungsrecht ist das die wichtigste Liste der Seite:
 * «Was ist aus meinem Vorschlag geworden?» Ohne sie bleibt die Frage offen, und
 * es fragt jemand im Chat.
 */
async function EigeneVorschlaege({ discordId }: { discordId: string }): Promise<React.JSX.Element> {
  const eigene = await emoji.ladeEigeneAntraege(discordId);
  if (eigene.length === 0) {
    return <></>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meine Vorschläge</CardTitle>
        <CardDescription>Was daraus geworden ist - inklusive Grund bei einer Ablehnung.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {eigene.map((antrag) => (
            <li
              key={antrag.id}
              className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 odd:bg-muted/30"
            >
              <code className="text-xs">:{antrag.emojiName ?? antrag.name}:</code>
              <Badge variant={antrag.status === 'ANGENOMMEN' ? 'secondary' : 'outline'}>
                {antrag.status === 'OFFEN'
                  ? 'wartet'
                  : antrag.status === 'ABSTIMMUNG'
                    ? `Abstimmung ${antrag.stimmen}/${antrag.stimmenZiel ?? '?'}`
                    : (ZUSTAND[antrag.status] ?? antrag.status)}
              </Badge>
              {antrag.ablehnungsGrund ? (
                <span className="text-xs text-muted-foreground">{antrag.ablehnungsGrund}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
