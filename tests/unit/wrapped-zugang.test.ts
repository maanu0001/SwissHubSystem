import { describe, expect, it } from 'vitest';

const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * Wer welchen Rückblick sehen darf.
 *
 * ## Die eine Regel
 *
 * **Jeder sieht ausschliesslich seinen eigenen.** Es gibt keinen Parameter,
 * mit dem sich der Rückblick oder die Karte einer anderen Person öffnen
 * liesse - auch nicht mit Verwaltungsrechten. Wer fremde Zahlen ansehen
 * muss, weil er die Gestaltung prüft, geht über die Vorschau im Studio, und
 * die verlangt eine eigene Berechtigung und schreibt nichts.
 *
 * ## Warum das statisch geprüft wird
 *
 * Weil der Fehler ein Einzeiler wäre: `searchParams.get('discordId')` statt
 * `context.user.discordId`, und niemandem fällt es auf, weil die eigene
 * Seite danach weiterhin funktioniert. Der Test liest deshalb nach, woher
 * die Kennung in den heiklen Dateien tatsächlich stammt.
 *
 * Er ersetzt keine Prüfung der Berechtigungen zur Laufzeit - die macht
 * `tests/unit/action-authorization.test.ts` für alle Aktionen des Systems.
 * Er schliesst die Lücke daneben: Routen, die keine Aktionen sind.
 */
const quelle = (datei: string): string => readFileSync(join(process.cwd(), datei), 'utf8');

const KARTE = 'apps/web/src/app/api/wrapped/share/[key]/route.tsx';
const SEITE = 'apps/web/src/app/wrapped/[key]/page.tsx';
const BUEHNE = 'apps/web/src/app/wrapped-buehne/[id]/page.tsx';
const KARTE_VORSCHAU = 'apps/web/src/app/api/wrapped/karte-vorschau/[id]/route.tsx';

describe('Zugang zum eigenen Rückblick', () => {
  it('nimmt für die Karte keine fremde Kennung entgegen', () => {
    const text = quelle(KARTE);
    // Die Kennung kommt aus der Anmeldung.
    expect(text).toContain('context.user.discordId');
    // Und nirgendwo aus der Anfrage.
    expect(text).not.toMatch(/searchParams\.get\(\s*['"]discordId/u);
    expect(text).not.toMatch(/params.*discordId/u);
  });

  it('liest auf der Rückblickseite nur die eigene Momentaufnahme', () => {
    const text = quelle(SEITE);
    expect(text).toContain('discordId: context.user.discordId');
    expect(text).not.toMatch(/searchParams/u);
  });

  it('zeigt nur einen veröffentlichten Rückblick', () => {
    const text = quelle(SEITE);
    expect(text).toContain("campaign.status !== 'PUBLISHED'");
    expect(text).toContain('notFound()');
  });

  it('gibt eine Karte nur für einen veröffentlichten Rückblick mit eingeschalteten Karten heraus', () => {
    const text = quelle(KARTE);
    expect(text).toContain("campaign.status !== 'PUBLISHED'");
    expect(text).toContain('!campaign.shareCardsEnabled');
  });

  it('verlangt für die Karte das Recht, den eigenen Rückblick zu sehen', () => {
    expect(quelle(KARTE)).toContain('WRAPPED_PERMISSIONS.viewOwn');
  });

  describe('Die Vorschau - fremde Zahlen nur mit eigener Berechtigung', () => {
    it.each([BUEHNE, KARTE_VORSCHAU])('%s verlangt das Vorschaurecht', (datei) => {
      expect(quelle(datei)).toContain('WRAPPED_PERMISSIONS.preview');
    });

    it('lässt die Bühne nur die Kampagne der eigenen Guild zeigen', () => {
      const text = quelle(BUEHNE);
      expect(text).toContain('campaign.guildId !== guildId');
      expect(text).toContain('notFound()');
    });

    it('legt in der Vorschau keine Datei zum Herunterladen an', () => {
      // Angesehen, nicht geladen - der `attachment`-Kopf gehört zur Karte
      // eines Mitglieds und sonst nirgendwohin.
      expect(quelle(KARTE_VORSCHAU)).not.toContain('content-disposition');
      expect(quelle(KARTE)).toContain('content-disposition');
    });
  });

  it('speichert die Karte in keinem geteilten Zwischenspeicher', () => {
    /*
     * Auf der Karte steht der Name eines Mitglieds. Ein Proxy, der sie für
     * alle behält, wäre ein Datenleck mit Zwischenablage.
     */
    for (const datei of [KARTE, KARTE_VORSCHAU]) {
      expect(quelle(datei)).toContain("'private, no-store'");
    }
  });
});
