import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { merkeAustritt, merkeMitglied } from '@swisshub/modules';
import type { GuildMember as SwissHubMember } from '@swisshub/discord';

const log = createLogger('bot:member-mirror');

/**
 * Den Mitgliederspiegel im Betrieb fortschreiben.
 *
 * Der vollstaendige Abgleich beim Start holt den Bestand; danach haelt diese
 * Datei ihn aktuell. Ohne sie waere der Spiegel bis zum naechsten Abgleich
 * veraltet - ein neues Mitglied stuende stundenlang nicht in der Liste, und
 * eine Rollenaenderung wuerde vom Rollenfilter nicht gesehen.
 *
 * Drei Ereignisse, drei Saetze:
 *
 * - **Beitritt** legt die Zeile an. Wer schon einmal da war, kommt dadurch
 *   zurueck: `merkeMitglied` setzt `leftAt` zurueck.
 * - **Austritt** markiert, statt zu loeschen. Ein Moderationseintrag zeigt
 *   sonst auf einen Namen, den niemand mehr aufloesen kann.
 * - **Aenderung** schreibt fort, was die Liste anzeigt und wonach sie filtert:
 *   Name, Spitzname, Avatar, Rollen, Timeout, Boost.
 *
 * Nichts hier darf den Bot anhalten. Ein misslungener Spiegeleintrag ist ein
 * veralteter Eintrag - der naechste Abgleich holt ihn ein.
 */
export function registerMemberMirror(client: Client, guildIdAktiv: (candidate: string) => boolean): void {
  const sicher = (was: string, arbeit: () => Promise<unknown>): void => {
    void arbeit().catch((error: unknown) => log.warn(`${was} nicht gespiegelt`, { error }));
  };

  client.on(Events.GuildMemberAdd, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Beitritt', () => merkeMitglied(uebersetze(member)));
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Austritt', () => merkeAustritt(member.id));
  });

  client.on(Events.GuildMemberUpdate, (_vorher, nachher) => {
    if (!guildIdAktiv(nachher.guild.id)) {
      return;
    }
    /*
     * Ohne Vergleich des Vorherzustands.
     *
     * Discord meldet dieses Ereignis auch fuer Dinge, die hier niemanden
     * interessieren - eine Aktivitaet, ein Praesenzwechsel. Das zu
     * unterscheiden, hiesse die Bedingung an zwei Stellen zu pflegen: hier
     * und in dem, was der Spiegel speichert. Ein Schreibbefehl auf eine Zeile
     * mit denselben Werten kostet weniger als diese Doppelpflege.
     */
    sicher('Aenderung', () => merkeMitglied(uebersetze(nachher)));
  });
}

/**
 * Ein discord.js-Mitglied in die Form bringen, die der Spiegel kennt.
 *
 * Dieselben Felder wie `normaliseMember` im REST-Zugang - damit ein Mitglied
 * aus dem Gateway und eines aus dem Abgleich dieselbe Zeile ergeben und nicht
 * zwei verschiedene Wahrheiten.
 */
function uebersetze(member: GuildMember | PartialGuildMember): SwissHubMember {
  const nickname = member.nickname ?? null;
  const globalName = member.user.globalName ?? null;
  return {
    discordId: member.id,
    username: member.user.username,
    globalName,
    nickname,
    displayName: nickname ?? globalName ?? member.user.username,
    avatarHash: member.user.avatar ?? null,
    isBot: member.user.bot,
    roleIds: [...member.roles.cache.keys()],
    joinedAt: member.joinedAt ?? null,
    accountCreatedAt: member.user.createdAt,
    boosting: member.premiumSince !== null,
    timedOutUntil: member.communicationDisabledUntil ?? null,
  };
}
