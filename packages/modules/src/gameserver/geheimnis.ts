/**
 * Wo die Geheimnisse dieses Moduls liegen.
 *
 * Eine eigene Datei, weil sowohl der Orchestrator als auch die
 * Hostverwaltung dieselbe Adresse bilden muessen. Zwei Stellen, die eine
 * Verschluesselungsadresse bauen, sind zwei Stellen, die sie unterschiedlich
 * bauen koennen - und dann laesst sich ein Token, das die eine geschrieben
 * hat, von der anderen nicht mehr lesen.
 */
import { GAMESERVER_INTEGRATION_ID } from '@swisshub/secrets';

export const geheimnisAdresse = (schluessel: string) =>
  ({ scope: 'GLOBAL', guildId: '', provider: GAMESERVER_INTEGRATION_ID, key: schluessel }) as const;

/** Die Adresse des dauerhaften Agent-Tokens eines Hosts. */
export const hostTokenAdresse = (hostId: string) => geheimnisAdresse(`host:${hostId}`);

/** Die Adresse des RCON-Passworts einer Match-Instanz. */
export const rconAdresse = (instanzName: string) => geheimnisAdresse(`rcon:${instanzName}`);

/** Die Adresse des Agent-Tokens einer Instanz aus der VM-Welt. */
export const instanzTokenAdresse = (instanzName: string) => geheimnisAdresse(`agent:${instanzName}`);
