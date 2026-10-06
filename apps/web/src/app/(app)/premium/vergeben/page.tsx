import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { premium } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { VergabeFormular, type VergabeProdukt } from '@/modules/premium/components/vergabe-formular';
import { VergabeWiderruf } from '@/modules/premium/components/vergabe-widerruf';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';
import { namenKarte } from '@/modules/workspace/daten';

export const metadata: Metadata = { title: 'Premium vergeben' };
export const dynamic = 'force-dynamic';

/**
 * «Premium vergeben» - Formular und Historie (§9, §10).
 *
 * ## Warum beides auf einer Seite
 *
 * Weil die Historie der Zusammenhang des Formulars ist. Wer gerade vergeben
 * hat, will sehen, dass es drin steht; wer verlaengern will, schaut zuerst
 * nach, was diese Person schon bekommen hat. Zwei Seiten waeren zwei Klicks
 * fuer eine Frage.
 *
 * ## Zwei Berechtigungen, eine Seite
 *
 * Geoeffnet wird sie mit `grants.view` - der schwaecheren der beiden. Das
 * Formular erscheint nur mit `grants.create`, der Widerruf-Knopf nur mit
 * `grants.revoke`. Wer nur zusehen darf, sieht die Historie und kein Formular;
 * eine Seite, die auf 403 fuehrt, waere ein Versprechen, das die naechste
 * Seite bricht.
 */
export default async function PremiumVergebenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.grantsView);
  const params = await searchParams;
  const csrfToken = csrfTokenFor(context);

  const darfVergeben = can(context, premium.PREMIUM_PERMISSIONS.grantsCreate);
  const darfWiderrufen = can(context, premium.PREMIUM_PERMISSIONS.grantsRevoke);

  const [angebote, historie] = await Promise.all([
    premium.listAllProducts(),
    premium.ladeHistorie({
      productId: params.angebot || undefined,
      status: (params.status as 'ACTIVE' | 'REVOKED' | 'EXPIRED' | undefined) || undefined,
      grenze: 150,
    }),
  ]);

  /*
   * Die Angebote fuer das Formular.
   *
   * Ein «Bundle» ist hier kein eigener Typ, sondern ein Angebot mit mehr als
   * einer Leistung (§6): die Zuordnung steht in `PremiumProduct.entitlements`
   * und nirgends sonst. Haetten Bundles eine eigene Liste, gaebe es zwei
   * Stellen, an denen steht, was ein Bundle enthaelt - und eine davon waere
   * irgendwann falsch.
   */
  const produkte: VergabeProdukt[] = angebote
    .filter((angebot: (typeof angebote)[number]) => angebot.active)
    .map((angebot: (typeof angebote)[number]) => ({
      id: angebot.id,
      name: angebot.name,
      leistungen: angebot.entitlements.map(
        (anspruch: (typeof angebot.entitlements)[number]) => premium.ENTITLEMENT_LABEL[anspruch],
      ),
      bundle: angebot.entitlements.length > 1,
    }));

  // Namen in einer Abfrage fuer die ganze Seite - nicht einer je Zeile.
  type Zeile = (typeof historie)[number];
  const namen = await namenKarte([
    ...historie.map((eintrag: Zeile) => eintrag.discordId),
    ...historie.map((eintrag: Zeile) => eintrag.grantedByDiscordId),
  ]);

  const jetzt = new Date();

  return (
    <div className="space-y-6">
      <PremiumSectionNav sections={premiumSections(context)} />

      {darfVergeben ? (
        <Panel
          title="Premium vergeben"
          description="Premium, Stübli oder ein Bundle von Hand an eine Person geben - mit frei gewählter Laufzeit."
          icon="Gift"
        >
          <VergabeFormular csrfToken={csrfToken} produkte={produkte} />
        </Panel>
      ) : null}

      <Panel
        title="Vergabe-Historie"
        description="Jede manuelle Vergabe - auch die widerrufenen und abgelaufenen."
        icon="Clock"
      >
        {/* Filter über die Adresszeile: ein Stand bleibt teilbar. */}
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="filter-angebot">
              Leistung
            </label>
            <select
              id="filter-angebot"
              name="angebot"
              defaultValue={params.angebot ?? ''}
              className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Alle</option>
              {angebote.map((angebot: (typeof angebote)[number]) => (
                <option key={angebot.id} value={angebot.id}>
                  {angebot.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="filter-status">
              Status
            </label>
            <select
              id="filter-status"
              name="status"
              defaultValue={params.status ?? ''}
              className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Alle</option>
              <option value="ACTIVE">Laufend</option>
              <option value="EXPIRED">Abgelaufen</option>
              <option value="REVOKED">Widerrufen</option>
            </select>
          </div>
          <button type="submit" className="h-9 rounded-md border border-input px-3 text-sm hover:bg-accent">
            Filtern
          </button>
        </form>

        {historie.length === 0 ? (
          <EmptyState
            title="Noch keine Vergabe"
            description="Hier steht jede von Hand vergebene Leistung, sobald es eine gibt."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Person</th>
                  <th className="p-2 font-medium">Leistung</th>
                  <th className="p-2 font-medium">Dauer</th>
                  <th className="p-2 font-medium">Von – bis</th>
                  <th className="p-2 font-medium">Art</th>
                  <th className="p-2 font-medium">Vergeben von</th>
                  <th className="p-2 font-medium">Grund</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {historie.map((eintrag: Zeile) => {
                  const zustand = premium.grantZustand(eintrag, jetzt);
                  const person = namen.get(eintrag.discordId);
                  const vergeber = eintrag.grantedByDiscordId ? namen.get(eintrag.grantedByDiscordId) : null;
                  return (
                    <tr key={eintrag.id} className="border-t border-border/60">
                      <td className="p-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <DiscordAvatar
                            discordId={eintrag.discordId}
                            avatarHash={person?.avatarHash ?? null}
                            name={person?.name ?? eintrag.discordId}
                            size={24}
                          />
                          <span className="truncate">{person?.name ?? eintrag.discordId}</span>
                        </span>
                      </td>
                      <td className="p-2">{eintrag.product.name}</td>
                      <td className="p-2">{premium.dauerText(eintrag.amount, eintrag.unit)}</td>
                      <td className="p-2 whitespace-nowrap text-xs">
                        {formatDateTime(eintrag.startsAt)}
                        <br />
                        {formatDateTime(eintrag.endsAt)}
                      </td>
                      <td className="p-2 text-xs">{premium.GRANT_MODE_LABEL[eintrag.mode]}</td>
                      <td className="p-2 text-xs">{vergeber?.name ?? eintrag.grantedByUsername ?? '–'}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {eintrag.reason ?? '–'}
                        {eintrag.revokedReason ? (
                          <span className="block text-destructive">Widerruf: {eintrag.revokedReason}</span>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            zustand === 'ACTIVE'
                              ? 'default'
                              : zustand === 'REVOKED'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {zustand === 'ACTIVE'
                            ? 'Laufend'
                            : zustand === 'REVOKED'
                              ? 'Widerrufen'
                              : 'Abgelaufen'}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">
                        {darfWiderrufen && zustand === 'ACTIVE' ? (
                          <VergabeWiderruf
                            csrfToken={csrfToken}
                            grantId={eintrag.id}
                            person={person?.name ?? eintrag.discordId}
                            produkt={eintrag.product.name}
                            laeuftBis={formatDateTime(eintrag.endsAt)}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
