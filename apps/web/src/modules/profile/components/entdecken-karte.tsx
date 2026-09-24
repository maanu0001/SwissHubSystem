import Link from 'next/link';
import { mitRueckkehr, systemRoutes } from '@swisshub/shared';
import type { profile } from '@swisshub/modules';
import { DiscordAvatar } from '@/components/shared/discord-avatar';

/**
 * Eine Mitgliederkarte in «Mitglieder entdecken».
 *
 * ## Warum das keine Zeile in einer Tabelle ist
 *
 * Eine Tabelle mit Name, Rolle und Beitrittsdatum ist ein Verwaltungsblick.
 * Hier soll jemand sehen, ob es sich lohnt, diese Person anzuschreiben -
 * also: Avatar gross, Motto, worauf gespielt wird, und die Akzentfarbe des
 * Profils als schmaler Streifen. Keine Rollen, keine Kennungen, keine
 * Moderationshinweise; die stehen in der Akte und gehen hier niemanden an.
 */
export function EntdeckenKarte({
  karte,
  von,
}: {
  karte: profile.EntdeckenKarte;
  von: string;
}): React.JSX.Element {
  return (
    <Link
      href={mitRueckkehr(systemRoutes.profil(karte.discordId), von)}
      className="pr-kachel group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card hover:border-[hsl(var(--karte-akzent)/0.6)]"
      style={{ '--karte-akzent': karte.akzentHsl } as React.CSSProperties}
    >
      <span
        className="h-1 w-full shrink-0"
        style={{
          background:
            'linear-gradient(90deg, hsl(var(--karte-akzent)) 0%, hsl(var(--karte-akzent) / 0.15) 100%)',
        }}
        aria-hidden="true"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <DiscordAvatar
            discordId={karte.discordId}
            avatarHash={karte.avatarHash}
            name={karte.discordName}
            size={48}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{karte.discordName}</p>
            {karte.profilname ? (
              <p className="truncate text-xs text-muted-foreground">«{karte.profilname}»</p>
            ) : null}
          </div>
          {karte.level !== null ? (
            <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-muted-foreground">
              Lv {karte.level}
            </span>
          ) : null}
        </div>

        {karte.tagline ? <p className="line-clamp-2 text-xs text-muted-foreground">{karte.tagline}</p> : null}

        {karte.spiele.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {karte.spiele.map((spiel) => (
              <li
                key={spiel.gameId}
                className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-[0.65rem]"
              >
                {spiel.name}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
         * Die Fusszeile nur, wenn etwas darin steht.
         *
         * Wer noch kein Profil gepflegt hat, hatte sonst eine Karte mit einer
         * leeren Zeile am Fuss - und weil `mt-auto` sie nach unten drückt, war
         * die Karte so hoch wie eine volle und zu drei Vierteln leer.
         */}
        {karte.verfuegbarkeit || karte.spielart || karte.sprachen.length > 0 ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-[0.65rem] text-muted-foreground">
            {karte.verfuegbarkeit ? (
              <span className="inline-flex items-center gap-1 font-medium text-[hsl(var(--karte-akzent))]">
                <span className="size-1.5 rounded-full bg-[hsl(var(--karte-akzent))]" aria-hidden="true" />
                {karte.verfuegbarkeit.label}
              </span>
            ) : null}
            {karte.spielart ? <span>{karte.spielart}</span> : null}
            {karte.sprachen.length > 0 ? <span>{karte.sprachen.join(', ')}</span> : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
