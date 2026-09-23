import 'server-only';
import { wrapped } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import type { WrappedCampaign } from '@swisshub/database';

/**
 * Die Vorschau-Maschine des Studios.
 *
 * ## Die eine Eigenschaft, die zaehlt
 *
 * **Sie schreibt nichts.** Keine Momentaufnahme, kein XP, keine
 * Benachrichtigung, kein Discord-Beitrag, kein Eintrag in `WrappedView`,
 * kein Achievement. Eine Vorschau, die beim Anschauen Spuren hinterlaesst,
 * waere keine Vorschau, sondern eine Veroeffentlichung an eine Person -
 * und die Person waere jemand, der nie danach gefragt hat.
 *
 * Deshalb ruft diese Datei ausschliesslich `sammleDaten` und
 * `ermittleQuellen` auf. Beide lesen nur; `tests/integration/
 * wrapped-vorschau.test.ts` haelt das fest, indem es die Zeilenzahl jeder
 * betroffenen Tabelle vor und nach einer Vorschau vergleicht.
 *
 * ## Drei Quellen, ein Ergebnis
 *
 * Eine Testperson (echte Zahlen, aus der Datenbank), eine Fixture
 * (erfundene Zahlen, aus der Registry) oder eine Fixture mit eigenen
 * Werten. Alles drei endet in derselben `WrappedDaten`-Form, damit die
 * Vorschau exakt dieselbe Story-Komponente rendert wie der Rueckblick
 * selbst. Eine zweite, vereinfachte Ansicht im Studio waere eine Vorschau
 * auf etwas, das es nicht gibt.
 */

export type VorschauQuelle = 'person' | 'fixture';

export interface VorschauAuftrag {
  quelle: VorschauQuelle;
  /** Bei `person`: wessen Zahlen. */
  discordId?: string | null;
  /** Bei `fixture`: welche Testperson. */
  persona?: string | null;
  ueberschreibung?: wrapped.FixtureUeberschreibung;
}

export interface VorschauErgebnis {
  daten: wrapped.WrappedDaten;
  /** Die Szenen, die diese Person in dieser Kampagne tatsaechlich bekaeme. */
  sceneKeys: string[];
  /** Jede Szene mit Begruendung - fuer die Abdeckungsmatrix. */
  abdeckung: Array<{ szene: wrapped.WrappedSzene; befund: wrapped.SzenenBefund }>;
  /** Woher die Zahlen stammen - die Vorschau sagt das immer sichtbar dazu. */
  herkunft: 'live' | 'fixture';
}

/**
 * Eine Vorschau bauen.
 *
 * Nur lesende Aufrufe. Wer hier eine schreibende Operation ergaenzt, bricht
 * die Zusage aus dem Kopfkommentar - und den Test dazu.
 */
export async function baueVorschau(
  campaign: WrappedCampaign,
  auftrag: VorschauAuftrag,
): Promise<VorschauErgebnis> {
  const einstellungen = await wrapped.szenenEinstellungen(campaign.id);
  const daten = await beschaffeDaten(campaign, auftrag);

  return {
    daten,
    sceneKeys: wrapped.baueGeschichte(daten, einstellungen),
    abdeckung: wrapped.pruefeAbdeckung(daten, einstellungen),
    herkunft: daten.herkunft === 'fixture' ? 'fixture' : 'live',
  };
}

async function beschaffeDaten(
  campaign: WrappedCampaign,
  auftrag: VorschauAuftrag,
): Promise<wrapped.WrappedDaten> {
  if (auftrag.quelle === 'person') {
    const discordId = auftrag.discordId?.trim();
    if (!discordId) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Es ist keine Testperson gewählt.' });
    }
    const zeitraum = wrapped.zeitraumVon(campaign);
    const quellen = await wrapped.ermittleQuellen(campaign.guildId, zeitraum);
    const daten = await wrapped.sammleDaten({ guildId: campaign.guildId, zeitraum, quellen }, discordId);
    return { ...daten, herkunft: 'live' };
  }

  const persona = wrapped.PERSONA_NACH_KEY.get(auftrag.persona ?? '');
  if (!persona) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Testperson gibt es nicht.' });
  }
  const basis = persona.bauen(campaign.displayYear);
  return auftrag.ueberschreibung && Object.keys(auftrag.ueberschreibung).length > 0
    ? wrapped.ueberschreibe(basis, auftrag.ueberschreibung)
    : basis;
}

/**
 * Wie gesund sind die Datenquellen dieser Kampagne?
 *
 * Das Studio soll vor dem Veroeffentlichen sagen koennen, warum eine Szene
 * bei allen fehlt - «das Clip-Modul war die halbe Zeit nicht da» ist eine
 * Antwort, «keine Daten» ist keine.
 */
export async function ladeQuellenlage(campaign: WrappedCampaign): Promise<wrapped.WrappedQuellen> {
  return wrapped.ermittleQuellen(campaign.guildId, wrapped.zeitraumVon(campaign));
}

/**
 * Ein paar echte Kandidaten als Vorschlag fuer die Testperson.
 *
 * Wer das Studio zum ersten Mal oeffnet, soll nicht erst eine Discord ID
 * suchen muessen. Genommen werden die aktivsten Mitglieder des Zeitraums -
 * bei ihnen ist am meisten zu sehen, und genau darum geht es beim Pruefen
 * der Gestaltung.
 */
export async function vorschlaegeFuerTestperson(
  campaign: WrappedCampaign,
  anzahl = 8,
): Promise<Array<{ discordId: string; name: string; tage: number }>> {
  const zeilen = await wrapped.aktivsteKandidaten(campaign, anzahl);
  return zeilen.map((zeile) => ({
    discordId: zeile.discordId,
    name: zeile.name ?? zeile.discordId,
    tage: zeile.activeDays,
  }));
}
