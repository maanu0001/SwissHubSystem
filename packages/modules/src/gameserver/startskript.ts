/**
 * Was auf einer frisch erzeugten Maschine als Erstes laeuft.
 *
 * ## Die Regel
 *
 * Hier entsteht der **einzige** Text, den SwissHub einer Maschine zur
 * Ausfuehrung gibt. Er wird aus festen Bausteinen gebaut; die einzigen
 * veraenderlichen Teile sind ein Token, ein Passwort und drei Portnummern,
 * und jeder davon wird geprueft, bevor er hineinkommt.
 *
 * Es gibt keinen Weg, von aussen etwas in dieses Skript zu bekommen. Kein
 * Feld aus einem Formular, kein Teamname, keine Map, kein Wert aus einer
 * Antwort des Anbieters. Das ist der Grund, warum es hier steht und nicht
 * dort, wo die Matchdaten zusammenkommen.
 *
 * ## Warum ueberhaupt ein Skript
 *
 * Weil das VM-Template den Agenten enthaelt, aber nicht seine Zugangsdaten -
 * die entstehen erst beim Provisionieren und sind je Maschine verschieden.
 * Ein Template mit eingebautem Token waere ein Token fuer alle Maschinen,
 * und genau das soll es nicht geben.
 */
import { AppError } from '@swisshub/shared';
import type { GameServerGame } from '@swisshub/database';

export interface StartskriptEingabe {
  agentToken: string;
  agentPort: number;
  rconPasswort: string;
  game: GameServerGame;
  gamePort: number;
  tvPort: number | null;
}

/** Nur das, was in einer Umgebungsvariable nichts anrichten kann. */
const UNBEDENKLICH = /^[A-Za-z0-9_-]+$/u;

function pruefeWert(name: string, wert: string): string {
  if (!UNBEDENKLICH.test(wert)) {
    /*
     * Ein Wert, der hier scheitert, ist ein Fehler im Erzeuger - die
     * Tokens und Passwoerter kommen aus `randomBytes(...).toString('base64url')`
     * und erfuellen das immer. Die Pruefung steht trotzdem hier: sie ist die
     * Zusage, dass in dieses Skript nichts gerät, was eine Shell anders lesen
     * könnte als gemeint.
     */
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Serverkonfiguration konnte nicht erzeugt werden.',
      internalMessage: `Startskript-Wert ${name} enthält unerlaubte Zeichen`,
    });
  }
  return wert;
}

function pruefePort(name: string, wert: number): number {
  if (!Number.isInteger(wert) || wert < 1 || wert > 65_535) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Serverkonfiguration konnte nicht erzeugt werden.',
      internalMessage: `Startskript-Port ${name} ist ungültig: ${wert}`,
    });
  }
  return wert;
}

/**
 * Das Startskript.
 *
 * Es schreibt eine Konfigurationsdatei und startet den Dienst, der im
 * Abbild bereits installiert ist. Es laedt nichts herunter, es installiert
 * nichts und es fuehrt nichts aus, was nicht schon auf der Maschine liegt -
 * eine Maschine, die beim Start aus dem Netz nachlaedt, haengt an einem
 * fremden Server, der auch mal weg ist.
 */
export function baueStartskript(eingabe: StartskriptEingabe): string {
  const token = pruefeWert('agentToken', eingabe.agentToken);
  const rcon = pruefeWert('rconPasswort', eingabe.rconPasswort);
  const game = pruefeWert('game', eingabe.game);
  const agentPort = pruefePort('agentPort', eingabe.agentPort);
  const gamePort = pruefePort('gamePort', eingabe.gamePort);
  const tvPort = eingabe.tvPort === null ? 0 : pruefePort('tvPort', eingabe.tvPort);

  return [
    '#cloud-config',
    'write_files:',
    '  - path: /etc/swisshub-agent/agent.env',
    '    permissions: "0600"',
    '    owner: root:root',
    '    content: |',
    `      SWISSHUB_AGENT_TOKEN=${token}`,
    `      SWISSHUB_AGENT_PORT=${agentPort}`,
    `      SWISSHUB_GAME=${game}`,
    `      SWISSHUB_GAME_PORT=${gamePort}`,
    `      SWISSHUB_TV_PORT=${tvPort}`,
    `      SWISSHUB_RCON_PASSWORD=${rcon}`,
    'runcmd:',
    '  - [ systemctl, enable, --now, swisshub-agent ]',
    '',
  ].join('\n');
}
