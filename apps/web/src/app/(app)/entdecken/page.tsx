import type { Metadata } from 'next';
import { members, profile } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { Pagination } from '@/components/shared/pagination';
import { EntdeckenFilter } from '@/modules/profile/components/entdecken-filter';
import { EntdeckenKarte } from '@/modules/profile/components/entdecken-karte';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Mitglieder entdecken' };
export const dynamic = 'force-dynamic';

/**
 * Mitglieder entdecken.
 *
 * ## Warum das kein Verwaltungswerkzeug ist
 *
 * Es gibt keine Rollenspalte, keinen Jail-Filter, keine Kennungen und keine
 * Auswahlkaestchen fuer Massenaktionen. Wer das braucht, findet es unter
 * «Mitglieder» - mit der passenden Berechtigung. Hier geht es um die Frage
 * «mit wem koennte ich spielen».
 *
 * ## Wer die Seite sieht
 *
 * Wer `members.view` hat. Frueher jedes angemeldete Mitglied - die Liste
 * war als Weg gedacht, wie die Community sich findet. Diese Funktion gibt
 * es in der Anwendung nicht mehr; Mitglieder finden einander ueber geteilte
 * Profil-Links, und die brauchen keine Anmeldung. Die Begruendung steht
 * unten an der Pruefung.
 *
 * Gesucht, gefiltert und geteilt wird in der Datenbank ueber den
 * vollstaendigen Mitgliederbestand; siehe `profil/entdecken.ts`. Diese Seite
 * reicht nur die Frage durch.
 */
export default async function EntdeckenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  /*
   * Nicht mehr `requireMember()`.
   *
   * ## Was hier vorher offen stand
   *
   * Jedes angemeldete Mitglied konnte diese Liste aufrufen und darin nach
   * Sprache, Plattform, Spielzeit und Spielen suchen. Das war die Absicht
   * hinter «Mitglieder entdecken» - und es ist die Absicht, die jetzt
   * nicht mehr gilt: Mitglieder sollen einander hier nicht mehr
   * durchblaettern.
   *
   * ## Warum `members.view` und keine neue Berechtigung
   *
   * Weil es dieselbe Frage ist wie in der Mitgliederverwaltung - «wer ist
   * auf diesem Server» -, nur mit weniger Daten. Ein eigener Schluessel
   * waere eine zweite Stelle, an der jemand dieselbe Zuteilung pflegen
   * muesste, und die Beschriftungen wuerden auseinanderlaufen.
   *
   * ## Warum die Seite nicht geloescht wurde
   *
   * Sie ist nicht redundant: `/members` beantwortet «wer ist das» mit
   * Rollen, Jails und Verlauf. Diese Seite beantwortet «wer spielt abends
   * Valheim auf dem PC» - eine Frage, die die Mitgliederverwaltung nicht
   * stellt. Fuer die Moderation bleibt das nuetzlich, und der
   * Privatsphaere-Schalter «in der Suchliste auftauchen» behaelt damit
   * seine Bedeutung.
   *
   * Ausgeblendet wird ausserdem nicht nur die Navigation: wer die Adresse
   * kennt und die Berechtigung nicht hat, wird hier weggeschickt, bevor
   * eine Zeile geladen ist.
   */
  await requirePagePermission(members.MEMBER_PERMISSIONS.view);
  const roh = await searchParams;

  const einzeln = (key: string): string | null => {
    const wert = roh[key];
    const text = Array.isArray(wert) ? wert[0] : wert;
    return text && text.length > 0 ? text : null;
  };

  /*
   * Die Adresszeile ist eine Eingabe wie jede andere.
   *
   * `safeParse` und nicht `parse`: ein herumgespielter Parameter soll einen
   * Filter fallenlassen, nicht die Seite mit einer Ausnahme beenden. Was
   * nicht durchkommt, gilt als nicht gesetzt.
   */
  const geprueft = profile.entdeckenSchema.safeParse({
    suche: einzeln('suche') ?? '',
    gameId: einzeln('gameId'),
    plattform: einzeln('plattform'),
    spielart: einzeln('spielart'),
    sprache: einzeln('sprache'),
    spielzeit: einzeln('spielzeit'),
    absprache: einzeln('absprache'),
    verfuegbarkeit: einzeln('verfuegbarkeit'),
    seite: Number.parseInt(einzeln('seite') ?? '1', 10) || 1,
  });

  const filter = geprueft.success
    ? geprueft.data
    : profile.entdeckenSchema.parse({ suche: einzeln('suche') ?? '' });

  const [seite, spiele] = await Promise.all([profile.entdecke(filter), profile.filterbareSpiele()]);

  const query = new URLSearchParams();
  for (const [key, wert] of Object.entries(roh)) {
    const text = Array.isArray(wert) ? wert[0] : wert;
    if (text && key !== 'seite') {
      query.set(key, text);
    }
  }
  const von = `/entdecken${query.size > 0 ? `?${query.toString()}` : ''}`;

  return (
    <div className="space-y-6">
      {/*
       * Eine eigene Kopfzeile, seit der Navigationseintrag weg ist.
       *
       * Solange «Mitglieder entdecken» in der Seitenleiste stand, lieferte
       * `AppHeader` Titel und Beschreibung, und beides hier zu wiederholen
       * waere doppelt gewesen. Ohne den Eintrag liefert er nichts mehr - die
       * Seite stuende sonst ohne Ueberschrift da.
       */}
      <PageHeader
        title="Mitglieder entdecken"
        description="Mitglieder nach Spiel, Plattform und Spielzeit finden"
      />
      <EntdeckenFilter spiele={spiele} />

      {seite.karten.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Keine Mitglieder gefunden. Weniger Filter bringt mehr Treffer.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {seite.karten.map((karte) => (
            <li key={karte.discordId} className="min-w-0">
              <EntdeckenKarte karte={karte} von={von} />
            </li>
          ))}
        </ul>
      )}

      {seite.seiten > 1 ? (
        <Pagination
          page={seite.seite}
          totalPages={seite.seiten}
          total={seite.gesamt}
          buildHref={(nummer) => {
            const naechste = new URLSearchParams(query.toString());
            naechste.set('seite', String(nummer));
            return `/entdecken?${naechste.toString()}`;
          }}
        />
      ) : null}
    </div>
  );
}
