import { z } from 'zod';
import { registerEvent } from '@swisshub/automation';

/**
 * Die Ereignisse der SwissHub-Module.
 *
 * Hier - und nur hier - steht, worauf eine Automation überhaupt zeigen kann.
 * Die Engine kennt diese Liste nicht; sie erfährt davon, weil diese Datei
 * beim Start geladen wird. Ein neues Modul ergänzt seine Ereignisse und muss
 * an der Engine nichts ändern (§49).
 *
 * ## Drei Regeln für ein neues Ereignis
 *
 * 1. **Der Name bleibt.** `verification.completed` heisst in zwei Jahren
 *    dasselbe. Ändert sich die Bedeutung der Nutzdaten, steigt
 *    `schemaVersion`; der Name wird nicht umgedeutet.
 * 2. **Die Nutzdaten sind das Versprechen.** Was in `variables` steht, ist
 *    zugesagt und darf nicht verschwinden - eine Automation zeigt darauf.
 * 3. **Keine Geheimnisse, keine Rohdaten.** Nutzdaten landen im Verlauf und
 *    in Vorschauen. Was dort nicht stehen darf, gehört nicht hinein (§20).
 */

const discordId = z.string().regex(/^\d{17,20}$/u);
const optionalDiscordId = discordId.nullable().optional();

// --- Mitglieder -------------------------------------------------------------

registerEvent({
  type: 'member.joined',
  label: 'Mitglied ist beigetreten',
  description: 'Jemand hat den Server betreten.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    username: z.string(),
    displayName: z.string(),
    /** Alter des Discord-Kontos in Tagen - der nützlichste Wert gegen Wegwerfkonten. */
    kontoAlterTage: z.number().int().nullable(),
    istBot: z.boolean(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.username', label: 'Benutzername', type: 'string' },
    { path: 'payload.kontoAlterTage', label: 'Kontoalter in Tagen', type: 'number' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'member.left',
  label: 'Mitglied hat den Server verlassen',
  description: 'Jemand ist ausgetreten oder wurde entfernt.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    username: z.string(),
    displayName: z.string(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'member.role_added',
  label: 'Rolle wurde vergeben',
  description: 'Ein Mitglied hat eine Rolle bekommen - egal von wem.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    roleId: discordId,
    roleName: z.string(),
  }),
  variables: [
    { path: 'payload.roleId', label: 'Rollen-ID', type: 'string' },
    { path: 'payload.roleName', label: 'Rollenname', type: 'string' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
  ],
});

registerEvent({
  type: 'member.role_removed',
  label: 'Rolle wurde entfernt',
  description: 'Einem Mitglied wurde eine Rolle weggenommen.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    roleId: discordId,
    roleName: z.string(),
  }),
  variables: [
    { path: 'payload.roleId', label: 'Rollen-ID', type: 'string' },
    { path: 'payload.roleName', label: 'Rollenname', type: 'string' },
  ],
});

// --- Sprachkanäle -----------------------------------------------------------

registerEvent({
  type: 'voice.joined',
  label: 'Sprachkanal betreten',
  description: 'Jemand ist einem Sprachkanal beigetreten.',
  module: 'voice',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    channelId: discordId,
    channelName: z.string(),
  }),
  variables: [
    { path: 'payload.channelName', label: 'Kanalname', type: 'string' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
  ],
});

registerEvent({
  type: 'voice.left',
  label: 'Sprachkanal verlassen',
  description: 'Jemand hat einen Sprachkanal verlassen.',
  module: 'voice',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    channelId: discordId,
    channelName: z.string(),
  }),
  variables: [{ path: 'payload.channelName', label: 'Kanalname', type: 'string' }],
});

// --- Moderation -------------------------------------------------------------

registerEvent({
  type: 'moderation.action_created',
  label: 'Moderationsmassnahme wurde erfasst',
  description:
    'Ein Bann, Kick oder Timeout ist in der Akte gelandet - ueber das Moderation Center ausgeloest oder direkt in Discord und hier erkannt. Jail-Vorgaenge meldet dieses Ereignis nicht; sie laufen ueber das Jail-Modul.',
  module: 'moderation',
  payloadSchema: z.object({
    /** BAN, UNBAN, KICK, TIMEOUT, TIMEOUT_UPDATE oder TIMEOUT_REMOVE. */
    art: z.string(),
    /** WEBAPP, BOT, DISCORD oder SYSTEM - woher die Massnahme kam. */
    quelle: z.string(),
    /** HUMAN, BOT, SYSTEM oder UNKNOWN. */
    handelnderArt: z.string(),
    targetDiscordId: discordId,
    targetUsername: z.string(),
    actorUsername: z.string(),
    grund: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.art', label: 'Massnahme', type: 'string' },
    { path: 'payload.quelle', label: 'Quelle', type: 'string' },
    { path: 'payload.targetUsername', label: 'Betroffene Person', type: 'string' },
    { path: 'payload.actorUsername', label: 'Handelnde Person', type: 'string' },
    { path: 'payload.grund', label: 'Grund', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID der betroffenen Person', type: 'string' },
  ],
});

// --- Verifikation -----------------------------------------------------------

registerEvent({
  type: 'verification.requested',
  label: 'Verifikation eröffnet',
  description: 'Jemand wartet am Eingang auf eine Entscheidung.',
  module: 'verification',
  payloadSchema: z.object({
    requestId: z.string(),
    discordId,
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    /** Alter des Discord-Kontos in Tagen - der nuetzlichste Wert gegen Wegwerfkonten. */
    kontoAlterTage: z.number().int().nullable(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.kontoAlterTage', label: 'Kontoalter in Tagen', type: 'number' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'verification.completed',
  label: 'Mitglied wurde verifiziert',
  description: 'Ein Vorgang wurde freigeschaltet - von einem Menschen oder von der AI.',
  module: 'verification',
  payloadSchema: z.object({
    requestId: z.string(),
    discordId,
    displayName: z.string(),
    /** `HUMAN` oder `AI`. Für Automationen, die nur menschliche Entscheide behandeln. */
    entschiedenVon: z.enum(['HUMAN', 'AI']),
    rollenGesetzt: z.boolean(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.entschiedenVon', label: 'Entschieden von', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'verification.rejected',
  label: 'Verifikation wurde abgelehnt',
  description:
    'Ein Vorgang wurde abgelehnt. Nur zur Meldung - Sanktionen trifft die Automation Engine nie selbst.',
  module: 'verification',
  payloadSchema: z.object({
    requestId: z.string(),
    discordId,
    displayName: z.string(),
    entschiedenVon: z.enum(['HUMAN', 'AI']),
  }),
  variables: [{ path: 'payload.displayName', label: 'Anzeigename', type: 'string' }],
});

// --- Level ------------------------------------------------------------------

registerEvent({
  type: 'level.up',
  label: 'Mitglied ist aufgestiegen',
  description: 'Jemand hat ein neues Level erreicht.',
  module: 'level',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    level: z.number().int(),
    levelVorher: z.number().int(),
    xp: z.number().int(),
  }),
  variables: [
    { path: 'payload.level', label: 'Neues Level', type: 'number' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.xp', label: 'XP', type: 'number' },
  ],
});

// --- Tickets ----------------------------------------------------------------

registerEvent({
  type: 'ticket.opened',
  label: 'Ticket wurde eröffnet',
  description: 'Jemand hat ein Ticket aufgemacht.',
  module: 'tickets',
  payloadSchema: z.object({
    ticketId: z.string(),
    nummer: z.number().int(),
    discordId,
    kategorie: z.string(),
    channelId: discordId.nullable(),
  }),
  variables: [
    { path: 'payload.nummer', label: 'Ticketnummer', type: 'number' },
    { path: 'payload.kategorie', label: 'Kategorie', type: 'string' },
    { path: 'payload.channelId', label: 'Kanal-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'ticket.closed',
  label: 'Ticket wurde geschlossen',
  description: 'Ein Ticket ist abgeschlossen.',
  module: 'tickets',
  payloadSchema: z.object({
    ticketId: z.string(),
    nummer: z.number().int(),
    discordId,
    kategorie: z.string(),
    /** Wie lange es offen war, in Minuten. */
    offenMinuten: z.number().int().nullable(),
  }),
  variables: [
    { path: 'payload.nummer', label: 'Ticketnummer', type: 'number' },
    { path: 'payload.offenMinuten', label: 'Offen in Minuten', type: 'number' },
  ],
});

// --- Kalender ---------------------------------------------------------------

registerEvent({
  type: 'calendar.event_published',
  label: 'Termin wurde veröffentlicht',
  description: 'Ein Kalendereintrag ist online gegangen.',
  module: 'calendar',
  payloadSchema: z.object({
    eventId: z.string(),
    titel: z.string(),
    beginntAm: z.string(),
    kategorie: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.beginntAm', label: 'Beginn', type: 'date' },
  ],
});

registerEvent({
  type: 'calendar.registration_created',
  label: 'Anmeldung für einen Termin',
  description: 'Jemand hat sich für einen Termin angemeldet.',
  module: 'calendar',
  payloadSchema: z.object({
    eventId: z.string(),
    registrationId: z.string(),
    discordId,
    titel: z.string(),
    status: z.string(),
    /**
     * Teil der Adresse: `/kalender/<slug>`.
     *
     * Ergaenzt, damit eine Meldung auf den Termin zeigen kann. Rein additiv -
     * bestehende Automationen kennen das Feld nicht und brauchen es nicht.
     * Optional, weil aeltere Ereignisse in der Tabelle es nicht tragen.
     */
    slug: z.string().optional(),
    /** Wer den Termin angelegt hat - die Person, die von der Anmeldung erfaehrt. */
    organizerDiscordId: optionalDiscordId,
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel des Termins', type: 'string' },
    { path: 'payload.status', label: 'Status', type: 'string' },
    { path: 'payload.slug', label: 'Kurzname des Termins', type: 'string' },
  ],
});

// --- Premium ----------------------------------------------------------------

registerEvent({
  type: 'premium.activated',
  label: 'Premium wurde aktiv',
  description: 'Ein Abonnement ist in Kraft getreten.',
  module: 'premium',
  payloadSchema: z.object({
    subscriptionId: z.string(),
    discordId: discordId.nullable(),
    produkt: z.string(),
    laeuftBis: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.produkt', label: 'Produkt', type: 'string' },
    { path: 'payload.laeuftBis', label: 'Läuft bis', type: 'date' },
  ],
});

// --- Turniere ---------------------------------------------------------------

registerEvent({
  type: 'tournament.created',
  label: 'Turnier wurde angelegt',
  description: 'Ein neues Turnier steht bereit.',
  module: 'tournaments',
  payloadSchema: z.object({
    tournamentId: z.string(),
    titel: z.string(),
    spiel: z.string().nullable(),
    beginntAm: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.spiel', label: 'Spiel', type: 'string' },
  ],
});

// --- Clip of the Week -------------------------------------------------------

registerEvent({
  type: 'clips.submitted',
  label: 'Clip eingereicht',
  description: 'Jemand hat einen Clip für die laufende Runde eingereicht - er wartet auf Freigabe.',
  module: 'clips',
  payloadSchema: z.object({
    clipId: z.string(),
    entryId: z.string(),
    competitionId: z.string(),
    titel: z.string(),
    discordId,
    provider: z.string(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.provider', label: 'Anbieter', type: 'string' },
  ],
});

registerEvent({
  type: 'clips.approved',
  label: 'Clip freigegeben',
  description: 'Die Moderation hat einen Clip für das Voting freigegeben.',
  module: 'clips',
  payloadSchema: z.object({
    clipId: z.string(),
    entryId: z.string(),
    competitionId: z.string(),
    titel: z.string(),
    discordId,
  }),
  variables: [{ path: 'payload.titel', label: 'Titel', type: 'string' }],
});

registerEvent({
  type: 'clips.rejected',
  label: 'Clip abgelehnt',
  description: 'Die Moderation hat einen Clip abgelehnt.',
  module: 'clips',
  payloadSchema: z.object({
    clipId: z.string(),
    entryId: z.string(),
    competitionId: z.string(),
    titel: z.string(),
    discordId,
    grund: z.string(),
    notiz: z.string().nullable().optional(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.grund', label: 'Grund', type: 'string' },
  ],
});

registerEvent({
  type: 'clips.voting_started',
  label: 'Clip-Voting gestartet',
  description: 'Die Einreichungen sind geschlossen, die Abstimmung läuft.',
  module: 'clips',
  payloadSchema: z.object({
    competitionId: z.string(),
    key: z.string(),
    nummer: z.number(),
    clips: z.number(),
    endetAm: z.string(),
  }),
  variables: [
    { path: 'payload.nummer', label: 'Rundennummer', type: 'number' },
    { path: 'payload.clips', label: 'Clips im Rennen', type: 'number' },
  ],
});

registerEvent({
  type: 'clips.winner',
  label: 'Clip of the Week steht fest',
  description: 'Eine Runde ist abgeschlossen und hat einen Gewinner.',
  module: 'clips',
  payloadSchema: z.object({
    competitionId: z.string(),
    key: z.string(),
    nummer: z.number(),
    entryId: z.string(),
    clipId: z.string(),
    titel: z.string(),
    discordId,
    stimmen: z.number(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.stimmen', label: 'Stimmen', type: 'number' },
  ],
});

// --- Automation selbst ------------------------------------------------------

registerEvent({
  type: 'automation.custom',
  label: 'Eigenes Ereignis',
  description: 'Ein Ereignis, das eine Automation selbst auslöst - um eine zweite Automation anzustossen.',
  module: 'automation',
  // Bewusst offen: die Felder bestimmt die auslösende Automation. Die Grösse
  // begrenzt der Bus, die Tiefe der Schleifenschutz.
  payloadSchema: z.record(z.unknown()),
  variables: [],
});

registerEvent({
  type: 'automation.failed',
  label: 'Eine Automation ist gescheitert',
  description: 'Ein Lauf ist endgültig gescheitert - für eine Meldung an das Team.',
  module: 'automation',
  payloadSchema: z.object({
    automationId: z.string(),
    automationName: z.string(),
    runId: z.string(),
    fehler: z.string(),
  }),
  variables: [
    { path: 'payload.automationName', label: 'Name der Automation', type: 'string' },
    { path: 'payload.fehler', label: 'Fehler', type: 'string' },
  ],
});
