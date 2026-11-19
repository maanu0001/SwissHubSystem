import { appUrl } from '@swisshub/config';
import { branding } from '@swisshub/config/client';
import type { DiscordMessagePayload } from '@swisshub/discord';

/**
 * Die Nachricht, die eine abgelehnte Person bekommt.
 *
 * ## Warum sie vor dem Bann hinausgeht
 *
 * Weil sie danach nicht mehr hinausgehen kann. Eine Direktnachricht setzt
 * voraus, dass Bot und Empfaenger einen Server teilen - ein Bann beendet
 * genau das. Die Reihenfolge ist deshalb keine Vorliebe, sondern die einzige,
 * die funktioniert: erst schreiben, dann bannen.
 *
 * ## Was darin steht, und warum genau das
 *
 * **Der Grund.** Er steht ohnehin in der Akte; ihn der betroffenen Person
 * vorzuenthalten hiesse, sie raten zu lassen, was sie falsch gemacht hat.
 *
 * **Der Weg zurueck.** Wer sich zu Unrecht gebannt fuehlt, soll nicht
 * herausfinden muessen, wo man das sagt. Der Knopf fuehrt direkt zum
 * Entbannungsantrag - und der steht einem Gebannten offen, weil die Seite
 * `requireAuth()` verlangt und nicht `requireMember()`.
 *
 * **Kein Vorwurf.** Der Text sagt, was geschehen ist, und nicht, was die
 * Person ist. Eine Ablehnung in der Verifikation trifft regelmaessig auch
 * Leute, die schlicht nichts Passendes geschrieben haben.
 *
 * ## Was bewusst fehlt
 *
 * Der Name der entscheidenden Person. Sie steht in der Akte, wo das Team
 * sie sieht; in einer Direktnachricht waere sie eine Adresse fuer Aerger.
 */

/** Rot - dieselbe Farbe, die auch eine Massnahme im Log traegt. */
const FARBE_ABLEHNUNG = 0xd4_3f_3f;

/**
 * Wie lang ein Grund in der Nachricht werden darf.
 *
 * Discord nimmt 4096 Zeichen je Beschreibung; hier steht der Grund in einem
 * Feld neben erklaerendem Text. Mehr als ein Absatz ist in einer
 * Direktnachricht ohnehin keine Erklaerung mehr, sondern eine Abrechnung.
 */
const MAX_GRUND = 500;

export function baueAblehnungsNachricht(eingabe: { grund: string }): DiscordMessagePayload {
  const grund = eingabe.grund.trim().slice(0, MAX_GRUND);
  const antrag = appUrl('/entbannung');

  return {
    embeds: [
      {
        title: `Deine Verifikation auf ${branding.name} wurde abgelehnt`,
        description: [
          'Damit endet dein Zugang zum Server.',
          '',
          '**Grund**',
          grund.length > 0 ? grund : 'Kein Grund angegeben.',
        ].join('\n'),
        color: FARBE_ABLEHNUNG,
        fields: [
          {
            name: 'Du hältst das für einen Fehler?',
            value: [
              'Dann stell einen Entbannungsantrag. Du meldest dich dort mit demselben',
              'Discord-Konto an und schilderst deine Sicht - das Team sieht den Fall',
              'danach vollständig und entscheidet neu.',
              '',
              antrag,
            ].join('\n'),
            inline: false,
          },
        ],
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: 'Entbannungsantrag stellen',
            url: antrag,
          },
        ],
      },
    ],
    /*
     * Keine Erwaehnungen. In einer Direktnachricht gibt es niemanden zu
     * pingen, und ein `@everyone` im Grundtext - versehentlich hineinkopiert -
     * waere sonst eine Benachrichtigung an den halben Server.
     */
    allowedMentions: { parse: [] },
  };
}

/**
 * Die Adresse im Text **und** auf dem Knopf.
 *
 * Doppelt, und mit Absicht: ein Link-Knopf laesst sich nicht kopieren, nicht
 * weiterleiten und erscheint in manchen Clients gar nicht. Die Zeile darueber
 * funktioniert ueberall.
 */
export const ENTBANNUNG_PFAD = '/entbannung';
