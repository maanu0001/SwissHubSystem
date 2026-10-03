import { z } from 'zod';
import { prisma } from '@swisshub/database';
import { registerCondition } from '@swisshub/automation';

/**
 * Bedingungen, die Modulwissen brauchen.
 *
 * Der Kern kennt Discord und seine eigenen Läufe - mehr nicht. Ob jemand ein
 * **SwissHub-Konto** hat, weiss nur diese Anwendung, und deshalb steht die
 * Frage hier und nicht in `core-conditions`.
 *
 * Wie jede Bedingung: **lesend**. Der Probelauf prüft Bedingungen echt und
 * lässt nur Aktionen aus; eine Bedingung mit Nebenwirkung machte ihn
 * gefährlich statt hilfreich.
 */

export const webappKontoConfigSchema = z.object({
  wen: z.enum(['subject', 'actor']).default('subject'),
});

/**
 * Hat diese Person sich schon einmal in der WebApp angemeldet?
 *
 * ## Warum das eine Bedingung ist und keine Aktion
 *
 * Weil die Antwort nichts verändert. Sie entscheidet, ob eine Automation
 * überhaupt etwas tun soll - und genau dafür sind Bedingungen da: sie stehen
 * sichtbar in der Automation, lassen sich im Probelauf prüfen und erklären
 * hinterher im Verlauf, warum ein Lauf übersprungen wurde.
 *
 * Der Anlass ist die Systemeinladung: jemandem den Link zur WebApp zu
 * schicken, der dort längst angemeldet ist, ist eine Nachricht, die sagt «du
 * kennst uns nicht» - an jemanden, der uns kennt. Mit dieser Bedingung und
 * `negiert` lässt sich beides bauen: «nur an die ohne Konto» und «nur an die
 * mit».
 *
 * ## Was sie **nicht** verrät
 *
 * Nur ja oder nein. Kein Name, keine E-Mail, kein Anmeldedatum - es gibt
 * keinen Platzhalter, über den davon etwas in eine Nachricht geriete. Die
 * Frage der Moderation ist «chan ich ihm en Link schicke?», und das ist ein
 * Ja oder ein Nein.
 *
 * `User` ist die Tabelle der angemeldeten Konten; eine Zeile entsteht beim
 * ersten Discord-Login und bleibt danach. «Hat ein Konto» heisst damit genau
 * «war schon einmal drin».
 */
registerCondition({
  id: 'webappKonto',
  label: 'Hat ein SwissHub-Konto',
  description:
    'Trifft zu, wenn sich diese Person schon einmal in der WebApp angemeldet hat. Mit «nicht» davor: nur an die, die es noch nie getan haben.',
  group: 'Mitglied',
  configSchema: webappKontoConfigSchema,
  fields: [
    {
      key: 'wen',
      label: 'Wen prüfen',
      type: 'select',
      options: [
        { value: 'subject', label: 'Das betroffene Mitglied' },
        { value: 'actor', label: 'Wer es ausgelöst hat' },
      ],
      default: 'subject',
    },
  ],
  async evaluate(config, context) {
    const { wen } = config as z.infer<typeof webappKontoConfigSchema>;
    const discordId = wen === 'actor' ? context.event.actorId : context.event.subjectId;
    if (!discordId) {
      return false;
    }
    const konten = await prisma.user.count({ where: { discordId } });
    return konten > 0;
  },
});
