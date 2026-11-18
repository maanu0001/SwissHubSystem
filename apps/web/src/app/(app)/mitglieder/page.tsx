import type { Metadata } from 'next';
import Link from 'next/link';
import { profile } from '@swisshub/modules';
import { systemRoutes } from '@swisshub/shared';
import { Pagination } from '@/components/shared/pagination';
import { EmptyState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Mitglieder' };
export const dynamic = 'force-dynamic';

/**
 * Alle Mitglieder, in der Ordnung des Servers.
 *
 * ## Warum es diese Seite neben «Entdecken» gibt
 *
 * «Entdecken» beantwortet «mit wem koennte ich spielen» - es sucht, filtert
 * nach Spielen und steht hinter einer Staff-Berechtigung. Diese Seite
 * beantwortet «wer ist hier eigentlich». Sie ist das Gegenstueck zur
 * Mitgliederliste in Discord, nur mit den oeffentlichen Profilen daneben,
 * und jedes angemeldete Mitglied sieht sie.
 *
 * ## Die Rollenfarbe traegt die Hierarchie
 *
 * Sortiert wird nach der Position der hoechsten Rolle - derselben Zahl, nach
 * der Discord seine eigene Liste ordnet. Damit die Reihenfolge nicht wie
 * Zufall aussieht, steht die Rolle bei jedem Eintrag, in ihrer Farbe. Ohne
 * sie waere die Ordnung da, aber unlesbar.
 */
export default async function MitgliederPage({
  searchParams,
}: {
  searchParams: Promise<{ seite?: string; q?: string }>;
}): Promise<React.JSX.Element> {
  /*
   * `requireMember()` und nicht `requirePagePermission(...)` - genau wie
   * «Mein Profil».
   *
   * Der Navigationseintrag ist `baseline`: jedes angemeldete Mitglied sieht
   * ihn. Eine Seite, die dahinter eine **zugeteilte** Berechtigung verlangt,
   * waere ein Tab, der fuer die meisten auf eine 403 fuehrt - und zwar
   * lautlos, weil niemand im Team ohne diese Zuteilung unterwegs ist.
   * Gemessen: mit `requirePagePermission('members.view.basic.own')` ging die
   * Seite auf `/403?permission=members.view.basic.own`, obwohl der Tab
   * danebenstand.
   *
   * Das ist kein Loch. Die Seite ist kein Verwaltungswerkzeug: keine
   * Kennungen, keine Rollenvergabe, keine Auswahlkaestchen, keine
   * Moderationsdaten. Sie zeigt Name, Rolle und - wo es eines gibt - den
   * Link auf das **oeffentliche** Profil; die Mitgliederliste des Servers
   * steht in Discord ohnehin fuer alle offen. Wer mehr braucht, findet es
   * unter «Mitglieder» im Member Center, und das haengt weiter an
   * `members.view`.
   */
  await requireMember();

  const suche = await searchParams;
  const seite = Math.max(Number.parseInt(suche.seite ?? '1', 10) || 1, 1);
  const frage = (suche.q ?? '').trim();

  const verzeichnis = await profile.ladeMitgliederverzeichnis({ seite, suche: frage });

  return (
    <>
      {/*
        Kein `PageHeader`.

        Titel und Beschreibung stehen im Navigationseintrag und werden von der
        Kopfzeile der Anwendung gezeigt - beides hier noch einmal zu setzen
        waere derselbe Satz zweimal untereinander.
        `tests/unit/page-headers.test.ts` haelt das fest.
      */}
      <form action="/mitglieder" className="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={frage}
          placeholder="Name suchen"
          aria-label="Mitglied suchen"
          className="h-10 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        <button
          type="submit"
          className="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Suchen
        </button>
      </form>

      {verzeichnis.eintraege.length === 0 ? (
        <EmptyState
          title={frage ? 'Niemand gefunden' : 'Noch keine Mitglieder'}
          description={
            frage
              ? 'Kein Mitglied trägt diesen Namen. Vielleicht ein Tippfehler?'
              : 'Sobald der Mitgliederspiegel gefüllt ist, stehen hier alle Mitglieder.'
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {verzeichnis.eintraege.map((eintrag) => {
            const rolle = eintrag.hoechsteRolle;
            /*
             * Discords Farbe ist eine Zahl; 0 heisst «keine eigene Farbe».
             * Dann bleibt der Text in der normalen Schriftfarbe statt in
             * Schwarz, das `#000000` ergeben wuerde.
             */
            const farbe =
              rolle && rolle.farbe > 0 ? `#${rolle.farbe.toString(16).padStart(6, '0')}` : undefined;

            const inhalt = (
              <>
                <DiscordAvatar
                  discordId={eintrag.discordId}
                  avatarHash={eintrag.avatarHash}
                  name={eintrag.anzeigename}
                  size={40}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{eintrag.anzeigename}</span>
                  {rolle ? (
                    <span className="block truncate text-xs" style={farbe ? { color: farbe } : undefined}>
                      {rolle.name}
                    </span>
                  ) : (
                    <span className="block truncate text-xs text-muted-foreground">Ohne Rolle</span>
                  )}
                </span>
                {eintrag.boosting ? (
                  <span
                    className="shrink-0 text-xs text-pink-400"
                    title="Boostet den Server"
                    aria-label="Boostet den Server"
                  >
                    ★
                  </span>
                ) : null}
              </>
            );

            return (
              <li key={eintrag.discordId}>
                {eintrag.slug ? (
                  <Link
                    href={systemRoutes.oeffentlichesProfil(eintrag.slug)}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-card/70"
                  >
                    {inhalt}
                  </Link>
                ) : (
                  /*
                    Ohne oeffentliches Profil kein Link - und kein Knopf, der
                    so aussieht wie einer. Wer sein Profil nicht
                    veroeffentlicht hat, steht hier trotzdem: die Liste sagt,
                    wer da ist, nicht wer sich zeigt.
                  */
                  <div className="flex items-center gap-3 rounded-lg border border-border p-3 opacity-80">
                    {inhalt}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {verzeichnis.seiten > 1 ? (
        <Pagination
          page={verzeichnis.seite}
          totalPages={verzeichnis.seiten}
          total={verzeichnis.gesamt}
          buildHref={(ziel) => {
            const teile = new URLSearchParams();
            if (frage) {
              teile.set('q', frage);
            }
            if (ziel > 1) {
              teile.set('seite', String(ziel));
            }
            const abfrage = teile.toString();
            return abfrage ? `/mitglieder?${abfrage}` : '/mitglieder';
          }}
        />
      ) : null}
    </>
  );
}
