import {
  combinePermissions,
  discord,
  emojiPlaetze,
  hasDiscordPermission,
  type GuildEmoji,
} from '@swisshub/discord';

/**
 * Wie viele Emoji-Plätze noch frei sind.
 *
 * ## Warum das überhaupt eine Frage ist
 *
 * Weil Discord feste und animierte Emojis **getrennt** zählt und die Zahl von
 * der Boost-Stufe abhängt: 50, 100, 150, 250. Ein Server, der eine Stufe
 * verliert, behält seine Emojis, aber Discord stellt die überzähligen still
 * (`available: false`) - sie belegen weiter einen Platz.
 *
 * Die naheliegende Rechnung «alle Emojis gegen die Gesamtzahl» ergibt deshalb
 * zweimal die falsche Zahl: sie mischt die Kontingente und verschweigt, dass
 * ein animierter Platz frei sein kann, während die festen voll sind. Der
 * Upload scheitert dann an einer Grenze, die das Dashboard als erreicht nicht
 * gezeigt hat.
 *
 * ## Die Reserve
 *
 * Eine Zahl aus den Einstellungen, die von den **freien** Plätzen abgezogen
 * wird, bevor ein Vorschlag angenommen wird. Ohne sie füllt die Community die
 * Plätze bis zum letzten, und das Team hat keinen mehr für ein Server-Emoji.
 * Für das Team selbst (`emoji.manage`) gilt sie nicht - es entscheidet
 * bewusst.
 */

export interface PlatzStand {
  /** Belegte Plätze - stillgelegte zählen mit, sie belegen trotzdem. */
  belegt: number;
  gesamt: number;
  frei: number;
  /** Stillgelegte: vorhanden, aber nicht nutzbar, weil Boost-Stufen fehlen. */
  stillgelegt: number;
}

export interface PlatzUebersicht {
  fest: PlatzStand;
  animiert: PlatzStand;
  boostStufe: number;
  /**
   * Darf der Bot ueberhaupt Emojis anlegen?
   *
   * `null` heisst «nicht zu ermitteln» - Discord antwortet nicht, oder der Bot
   * ist nicht auf dem Server. Das ist etwas anderes als «nein» und wird im
   * Dashboard auch anders gesagt.
   */
  botDarf: boolean | null;
}

function stand(emojis: readonly GuildEmoji[], gesamt: number): PlatzStand {
  const belegt = emojis.length;
  return {
    belegt,
    gesamt,
    frei: Math.max(0, gesamt - belegt),
    stillgelegt: emojis.filter((emoji) => !emoji.available).length,
  };
}

/**
 * Der Platzstand des Servers.
 *
 * Eine Abfrage für beide Arten - die Liste wird ohnehin gebraucht und ist bei
 * Discord zwischengespeichert.
 */
export async function platzUebersicht(): Promise<PlatzUebersicht> {
  const [emojis, guild, botDarf] = await Promise.all([
    discord.emojis.list(),
    discord.guild.get(),
    botDarfEmojisVerwalten(),
  ]);
  const gesamt = emojiPlaetze(guild.premiumTier);
  return {
    fest: stand(
      emojis.filter((emoji) => !emoji.animated),
      gesamt,
    ),
    animiert: stand(
      emojis.filter((emoji) => emoji.animated),
      gesamt,
    ),
    boostStufe: guild.premiumTier,
    botDarf,
  };
}

/**
 * Hat der Bot «Ausdruecke verwalten»?
 *
 * ## Warum das vorher gefragt wird
 *
 * Weil Discord sonst beim Hochladen mit 403 antwortet - und das trifft die
 * falsche Person zum falschen Zeitpunkt: ein Vorschlag, der drei Tage in der
 * Moderation lag, scheitert beim Annehmen an einem Recht, das jemand anders
 * setzen muss. Der Hinweis gehoert ins Dashboard, bevor das erste Emoji
 * eingereicht wird.
 *
 * ## Warum `null` und nicht `false`
 *
 * «Ich weiss es nicht» ist etwas anderes als «nein». Antwortet Discord gerade
 * nicht, waere eine rote Warnung «der Bot darf nicht» eine Falschaussage, und
 * jemand suchte nach einem Recht, das vorhanden ist.
 *
 * Anders als bei der Selbstvergabe wird hier **nicht** gesperrt: ein Upload,
 * der trotz unklarer Lage versucht wird, scheitert mit Discords eigener
 * Meldung - und die ist in diesem Fall die genauere Auskunft. Gesperrt wuerde
 * nur ein Weg, der vielleicht funktioniert.
 */
export async function botDarfEmojisVerwalten(): Promise<boolean | null> {
  try {
    const [botMitglied, rollen] = await Promise.all([discord.bot.member(), discord.roles.list()]);
    if (!botMitglied) {
      return null;
    }
    const eigene = new Set(botMitglied.roleIds);
    const bits = combinePermissions(
      rollen.filter((rolle) => eigene.has(rolle.id)).map((rolle) => rolle.permissions),
    );
    return hasDiscordPermission(bits, 'MANAGE_GUILD_EXPRESSIONS');
  } catch {
    return null;
  }
}

export interface PlatzBefund {
  ok: boolean;
  grund?: string;
  frei: number;
}

/**
 * Ist noch Platz für ein Emoji dieser Art?
 *
 * `mitReserve: false` für das Team: wer `emoji.manage` hat, darf den letzten
 * Platz belegen - das ist eine Entscheidung und kein Versehen.
 */
export function pruefePlatz(
  uebersicht: PlatzUebersicht,
  animiert: boolean,
  reserve: number,
  optionen: { mitReserve?: boolean } = {},
): PlatzBefund {
  const stand = animiert ? uebersicht.animiert : uebersicht.fest;
  const abzug = optionen.mitReserve === false ? 0 : Math.max(0, reserve);
  const verfuegbar = stand.frei - abzug;
  const art = animiert ? 'animierte' : 'feste';

  if (stand.frei === 0) {
    return {
      ok: false,
      frei: 0,
      grund: `Alle ${stand.gesamt} ${art} Emoji-Plätze sind belegt. Ein bestehendes müsste weichen.`,
    };
  }
  if (verfuegbar <= 0) {
    return {
      ok: false,
      frei: stand.frei,
      grund: `Von den ${art} Plätzen sind noch ${stand.frei} frei, und ${abzug} davon sind für das Team reserviert.`,
    };
  }
  return { ok: true, frei: verfuegbar };
}
