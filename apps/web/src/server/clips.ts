import 'server-only';
import { appUrl } from '@swisshub/config';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { clips, isModuleEnabled } from '@swisshub/modules';
import type { AuthContext } from '@swisshub/auth';
import type { ClipCompetition } from '@swisshub/database';

/**
 * Der Zustand, auf dem die Clip-Seiten aufbauen.
 *
 * An einer Stelle zusammengetragen, weil jede Seite dasselbe braucht: welche
 * Runde gerade laeuft, in welcher Phase sie ist, was die aufrufende Person
 * darf und wie viele Stimmen ihr bleiben. Das je Seite erneut
 * zusammenzusuchen hiesse, dass die Startseite und die Galerie irgendwann
 * verschiedene Antworten geben.
 */

export type ClipPhase = 'keine' | 'vorbereitung' | 'einreichen' | 'voting' | 'ergebnis';

export interface ClipSeitenStand {
  aktiv: boolean;
  guildId: string;
  runde: ClipCompetition | null;
  phase: ClipPhase;
  /** Wann die laufende Phase endet - Grundlage des Countdowns. */
  endetAm: Date | null;
  verbleibendeStimmen: number;
  darfEinreichen: boolean;
  darfAbstimmen: boolean;
  darfModerieren: boolean;
  darfVerwalten: boolean;
  /** Der Hostname dieser Installation - Twitch verlangt ihn zum Einbetten. */
  hostname: string;
}

export function phaseVon(runde: ClipCompetition | null): ClipPhase {
  if (!runde) {
    return 'keine';
  }
  switch (runde.status) {
    case 'DRAFT':
      return 'vorbereitung';
    case 'SUBMISSION':
      return 'einreichen';
    case 'VOTING':
    case 'FINALIZING':
      return 'voting';
    case 'COMPLETED':
      return 'ergebnis';
    default:
      return 'keine';
  }
}

const hostnameDerApp = (): string => {
  try {
    return new URL(appUrl('/')).hostname;
  } catch {
    return 'localhost';
  }
};

export async function ladeClipStand(context: AuthContext): Promise<ClipSeitenStand> {
  const aktiv = await isModuleEnabled(clips.CLIPS_MODULE_ID);
  const guildId = await resolveGuildId();
  const runde = aktiv ? await clips.rundeFuerAnzeige(guildId) : null;
  const phase = phaseVon(runde);

  return {
    aktiv,
    guildId,
    runde,
    phase,
    endetAm:
      phase === 'einreichen'
        ? (runde?.submissionEndsAt ?? null)
        : phase === 'voting'
          ? (runde?.votingEndsAt ?? null)
          : null,
    verbleibendeStimmen:
      runde && phase === 'voting' ? await clips.verbleibendeStimmen(runde, context.user.discordId) : 0,
    darfEinreichen: can(context, clips.CLIPS_PERMISSIONS.submit),
    darfAbstimmen: can(context, clips.CLIPS_PERMISSIONS.vote),
    darfModerieren: can(context, clips.CLIPS_PERMISSIONS.moderate),
    darfVerwalten: can(context, clips.CLIPS_PERMISSIONS.manage),
    hostname: hostnameDerApp(),
  };
}

/** Die Abschnitte der Clip-Seiten - nur die, die jemand auch betreten darf. */
export function clipAbschnitte(
  context: AuthContext,
  offeneModeration = 0,
): Array<{
  href: string;
  label: string;
  badge?: number;
}> {
  const abschnitte = [
    { href: '/clips', label: 'Diese Woche' },
    { href: '/clips/hall-of-fame', label: 'Hall of Fame' },
  ];
  if (can(context, clips.CLIPS_PERMISSIONS.moderate)) {
    abschnitte.push({
      href: '/clips/moderation',
      label: 'Moderation',
      ...(offeneModeration > 0 ? { badge: offeneModeration } : {}),
    });
  }
  if (can(context, clips.CLIPS_PERMISSIONS.manage)) {
    abschnitte.push({ href: '/clips/verwalten', label: 'Runden' });
  }
  return abschnitte;
}
