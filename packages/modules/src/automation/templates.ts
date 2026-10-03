import { registerTemplate } from '@swisshub/automation';

/**
 * Vorlagen (§11).
 *
 * Jede ist so gebaut, dass sie nach dem Ausfüllen der markierten Felder
 * sofort läuft - und so einfach, dass man beim Ansehen versteht, wie die
 * Engine denkt. Keine Vorlage sanktioniert; die gefährlichste tut nichts
 * weiter, als das Team zu benachrichtigen.
 */

registerTemplate({
  id: 'willkommen',
  name: 'Willkommensnachricht',
  description: 'Begrüsst jedes neue Mitglied in einem Kanal.',
  gruppe: 'Willkommen',
  icon: 'hand',
  triggerType: 'event',
  triggerConfig: { eventType: 'member.joined' },
  conditions: {
    art: 'gruppe',
    verknuepfung: 'UND',
    kinder: [{ art: 'bedingung', typ: 'istBot', negiert: true, config: { wen: 'subject' } }],
  },
  steps: [
    {
      art: 'aktion',
      label: 'Begrüssen',
      typ: 'nachricht.kanal',
      config: {
        channelId: '',
        inhalt: 'Hoi {{payload.displayName}} 👋 Willkommen bei SwissHub!',
      },
      beiFehler: 'ABBRECHEN',
      retry: { versuche: 2, basisSekunden: 30 },
    },
  ],
  auszufuellen: [{ pfad: 'steps.0.config.channelId', label: 'Willkommenskanal' }],
});

registerTemplate({
  id: 'neues-konto-melden',
  name: 'Junges Konto melden',
  description:
    'Meldet dem Team, wenn ein sehr junges Discord-Konto beitritt. Meldet nur - sanktioniert nichts.',
  gruppe: 'Moderation',
  icon: 'alert-triangle',
  triggerType: 'event',
  triggerConfig: { eventType: 'member.joined' },
  conditions: {
    art: 'gruppe',
    verknuepfung: 'UND',
    kinder: [
      {
        art: 'bedingung',
        typ: 'wert',
        config: { pfad: 'payload.kontoAlterTage', operator: 'lt', wert: '7' },
      },
      { art: 'bedingung', typ: 'istBot', negiert: true, config: { wen: 'subject' } },
    ],
  },
  steps: [
    {
      art: 'aktion',
      label: 'Team benachrichtigen',
      typ: 'melden',
      config: {
        titel: 'Junges Konto beigetreten',
        text: '{{payload.displayName}} ({{event.subjectId}}) - Konto ist {{payload.kontoAlterTage}} Tage alt.',
        erwaehneRolle: false,
      },
      beiFehler: 'ABBRECHEN',
      retry: { versuche: 1, basisSekunden: 30 },
    },
  ],
});

registerTemplate({
  id: 'verifiziert-begruessen',
  name: 'Nach der Verifikation begrüssen',
  description: 'Schreibt frisch verifizierten Mitgliedern eine Direktnachricht.',
  gruppe: 'Willkommen',
  icon: 'shield-check',
  triggerType: 'event',
  triggerConfig: { eventType: 'verification.completed' },
  steps: [
    {
      art: 'aktion',
      label: 'Kurz warten',
      typ: 'nachricht.direkt',
      config: {
        wen: 'subject',
        titel: 'Willkommen bei SwissHub',
        beschreibung: 'Du bist freigeschaltet, {{payload.displayName}}. Schau dich um - und viel Spass!',
      },
      beiFehler: 'WEITER',
      retry: { versuche: 1, basisSekunden: 30 },
    },
  ],
});

registerTemplate({
  id: 'levelaufstieg-rolle',
  name: 'Rolle ab einem Level',
  description: 'Vergibt eine Rolle, sobald jemand ein bestimmtes Level erreicht.',
  gruppe: 'Level',
  icon: 'trending-up',
  triggerType: 'event',
  triggerConfig: { eventType: 'level.up' },
  conditions: {
    art: 'gruppe',
    verknuepfung: 'UND',
    kinder: [
      { art: 'bedingung', typ: 'wert', config: { pfad: 'payload.level', operator: 'gte', wert: '10' } },
    ],
  },
  steps: [
    {
      art: 'aktion',
      label: 'Rolle vergeben',
      typ: 'rolle.geben',
      config: { roleId: '', wen: 'subject', grund: 'Level {{payload.level}} erreicht' },
      beiFehler: 'ABBRECHEN',
      retry: { versuche: 2, basisSekunden: 30 },
    },
  ],
  auszufuellen: [{ pfad: 'steps.0.config.roleId', label: 'Rolle ab Level 10' }],
});

registerTemplate({
  id: 'ticket-nachfassen',
  name: 'Nach einem Ticket nachfassen',
  description:
    'Wartet nach dem Schliessen eines Tickets einen Tag und fragt privat nach, ob alles geklärt ist.',
  gruppe: 'Tickets',
  icon: 'life-buoy',
  triggerType: 'event',
  triggerConfig: { eventType: 'ticket.closed' },
  steps: [
    { art: 'warten', label: 'Einen Tag warten', sekunden: 86_400 },
    {
      art: 'aktion',
      label: 'Nachfragen',
      typ: 'nachricht.direkt',
      config: {
        wen: 'subject',
        titel: 'Alles geklärt?',
        beschreibung:
          'Dein Ticket #{{payload.nummer}} ist seit gestern geschlossen. Falls etwas offen blieb, melde dich einfach nochmals.',
      },
      beiFehler: 'WEITER',
      retry: { versuche: 1, basisSekunden: 30 },
    },
  ],
});

registerTemplate({
  id: 'taeglicher-bericht',
  name: 'Täglicher Hinweis',
  description: 'Schreibt jeden Abend eine feste Nachricht in einen Kanal.',
  gruppe: 'Zeitplan',
  icon: 'clock',
  triggerType: 'schedule',
  triggerConfig: { modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' },
  steps: [
    {
      art: 'aktion',
      label: 'Hinweis senden',
      typ: 'nachricht.kanal',
      config: { channelId: '', inhalt: 'Guten Abend! 🇨🇭' },
      beiFehler: 'ABBRECHEN',
      retry: { versuche: 2, basisSekunden: 60 },
    },
  ],
  auszufuellen: [{ pfad: 'steps.0.config.channelId', label: 'Kanal für den Hinweis' }],
});

/**
 * Die Systemeinladung.
 *
 * ## Was sie tut
 *
 * Schickt einer Person privat den Link zur WebApp und sagt ihr, wie sie sich
 * anmeldet. Nichts weiter - keine Rolle, kein Eintrag, keine Nachricht im
 * Kanal.
 *
 * ## Warum als Automation und nicht als eigener Befehl
 *
 * Weil es für Direktnachrichten schon eine Maschine gibt. Ein eigener Befehl
 * mit eigener DM-Logik wäre eine zweite - mit eigener Ratengrenze, eigenem
 * Verlauf, eigener Fehlerbehandlung und eigenem Text, der nirgends
 * einstellbar ist. Diese Vorlage benutzt `nachricht.direkt`, dieselbe Aktion
 * wie jede andere DM der Anwendung, und bekommt damit den Verlauf, den
 * Probelauf und die Grenzen gratis.
 *
 * Und sie ist **änderbar**: wer den Text anders haben will, ändert ihn im
 * Builder, statt eine Änderung zu bestellen.
 *
 * ## Die Bausteine, die es dafür neu gibt
 *
 *  - **`{{system.loginUrl}}`** und `{{system.name}}` - aus der Konfiguration,
 *    nicht aus einem Textfeld. Niemand tippt eine Adresse ein, also kann dort
 *    auch keine fremde stehen.
 *  - **`{{user.name}}`** - der Anzeigename der Person, serverseitig
 *    aufgelöst. Vorher gab es nur `{{payload.displayName}}`, und das steht
 *    nur in den Nutzdaten bestimmter Ereignisse - bei einem Start von Hand
 *    gar nicht.
 *  - **`webappKonto`, negiert** - nur an Leute, die noch kein Konto haben.
 *    Jemandem «du kennst uns noch nicht» zu schreiben, der längst angemeldet
 *    ist, ist die Art Nachricht, die ein Team unglaubwürdig macht.
 *  - **`abklingzeit`** - höchstens einmal pro Woche je Person. Sonst ist der
 *    Befehl ein Werkzeug, mit dem man versehentlich zehnmal dasselbe schickt.
 *  - **`istBot`, negiert** - ein Bot liest keine Einladung.
 *
 * ## Warum der Trigger `discord` ist
 *
 * Weil sie von Hand gestartet wird, und zwar dort, wo das Team arbeitet:
 * `/automation` mit der neuen Option `user`. Die freigegebenen Rollen bleiben
 * leer - die kennt nur der Server. Bis jemand sie einträgt, steht die
 * Automation da und tut nichts; das ist richtiger, als eine Vorlage mit einer
 * geratenen Rolle auszuliefern.
 */
registerTemplate({
  id: 'system-einladung',
  name: 'Systemeinladung',
  description:
    'Schickt einer Person privat den Link zur WebApp und wie sie sich anmeldet. Nur an Leute ohne SwissHub-Konto, höchstens einmal pro Woche.',
  gruppe: 'Willkommen',
  icon: 'mail',
  triggerType: 'discord',
  triggerConfig: { rollen: [], hinweis: 'WebApp-Einladung an eine Person' },
  conditions: {
    art: 'gruppe',
    verknuepfung: 'UND',
    kinder: [
      { art: 'bedingung', typ: 'istBot', negiert: true, config: { wen: 'subject' } },
      { art: 'bedingung', typ: 'webappKonto', negiert: true, config: { wen: 'subject' } },
      {
        art: 'bedingung',
        typ: 'abklingzeit',
        config: { minuten: 60 * 24 * 7, bezug: 'mitglied' },
      },
    ],
  },
  steps: [
    {
      art: 'aktion',
      label: 'Einladung schicken',
      typ: 'nachricht.direkt',
      config: {
        wen: 'subject',
        titel: 'Dini Iiladig zu {{system.name}}',
        beschreibung: [
          'Hoi {{user.name}} 👋',
          '',
          'Du chasch dich bi **{{system.name}}** aamälde - mit dim Discord-Account, ohni es neus Passwort:',
          '',
          '1. Gang uf {{system.loginUrl}}',
          '2. Klick uf «Mit Discord aamälde»',
          '3. Bestätig de Zuegriff - fertig.',
          '',
          'Döt gsehsch dis Profil, dis Level, dini Tickets und alles, wo zu dir ghört.',
        ].join('\n'),
      },
      beiFehler: 'ABBRECHEN',
      retry: { versuche: 2, basisSekunden: 30 },
    },
  ],
  auszufuellen: [{ pfad: 'triggerConfig.rollen', label: 'Rollen, die die Einladung schicken dürfen' }],
});
