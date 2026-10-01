import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  abstimmungsPayload,
  knopfId,
  moderationsPayload,
  parseKnopfId,
  vorschauPfad,
  vorschauSignatur,
  vorschauSignaturGueltig,
} from '../../packages/modules/src/emoji/discord';
import { DISCORD_BILD_HOSTS } from '../../packages/modules/src/emoji/herkunft';

/**
 * Die Discord-Seite des Emoji-Moduls.
 *
 * ## Warum die Knopf-Kennungen einen Test brauchen
 *
 * Weil der Bot **jeden** Klick auf dem Server zu sehen bekommt - auch die der
 * anderen Module. Eine Kennung, die zu viel annimmt, zieht fremde Klicks in
 * diesen Handler; eine, die zu wenig annimmt, lässt die eigenen fallen. Beides
 * fällt im Betrieb erst auf, wenn jemand klickt und nichts passiert.
 *
 * Und weil eine Kennung aus der Nachricht kommt, also von aussen: ein
 * nachgebauter Wert darf nicht durch die Prüfung fallen.
 */

const ANTRAG = 'cm0abcdefghijklmnopqrst';

describe('Emoji-Knöpfe: die Kennungen', () => {
  it.each(['annehmen', 'ablehnen', 'abstimmung', 'stimme'] as const)(
    'erkennt den eigenen Knopf «%s» wieder',
    (art) => {
      expect(parseKnopfId(knopfId(art, ANTRAG))).toEqual({ art, antragId: ANTRAG });
    },
  );

  it('bleibt unter Discords Grenze von 100 Zeichen', () => {
    // Darüber lehnt Discord die ganze Nachricht ab - nicht nur den Knopf.
    expect(knopfId('abstimmung', ANTRAG).length).toBeLessThanOrEqual(100);
  });

  it.each([
    ['fragt:abc:def', 'ein Knopf eines anderen Moduls'],
    ['emoji:annehmen', 'ein Teil fehlt'],
    ['emoji:annehmen:abc:def', 'ein Teil zu viel'],
    ['emoji:loeschen:cm0abcdefghijklmnopqrst', 'eine Art, die es nicht gibt'],
    ['emoji:annehmen:../../etc/passwd', 'keine Kennung'],
    ['emoji:annehmen:x', 'zu kurz für eine cuid'],
    ['', 'leer'],
  ])('gibt für «%s» null zurück (%s)', (eingabe) => {
    /*
     * `null` und kein Fehler: eine Ausnahme je fremdem Klick wäre ein
     * Fehlerlog, das sich selbst füllt - und der Handler eines anderen Moduls
     * bekäme seinen Klick nie.
     */
    expect(parseKnopfId(eingabe)).toBeNull();
  });
});

describe('Vorschaubild: signiert statt angemeldet', () => {
  it('hängt eine Signatur an die Adresse', () => {
    const pfad = vorschauPfad(ANTRAG);
    expect(pfad).toContain(ANTRAG);
    expect(pfad).toContain(`s=${vorschauSignatur(ANTRAG)}`);
  });

  it('prüft die Signatur und lässt sich nicht erraten', () => {
    /*
     * Die Signatur ist der Ersatz für die Anmeldung: Discord holt das Bild
     * ohne Sitzung. Die Kennung allein wäre zu wenig - cuid ist kein
     * Geheimnis.
     */
    expect(vorschauSignaturGueltig(ANTRAG, vorschauSignatur(ANTRAG))).toBe(true);
    expect(vorschauSignaturGueltig(ANTRAG, 'falsch')).toBe(false);
    expect(vorschauSignaturGueltig(ANTRAG, '')).toBe(false);
  });

  it('gibt für einen anderen Vorschlag eine andere Signatur', () => {
    // Sonst wäre eine Signatur ein Hauptschlüssel für alle Vorschläge.
    const anderer = 'cm0zyxwvutsrqponmlkjih';
    expect(vorschauSignatur(ANTRAG)).not.toBe(vorschauSignatur(anderer));
    expect(vorschauSignaturGueltig(anderer, vorschauSignatur(ANTRAG))).toBe(false);
  });
});

/** Ein Vorschlag, wie er in der Datenbank steht. */
function antrag(
  ueberschreiben: Partial<Parameters<typeof moderationsPayload>[0]> = {},
): Parameters<typeof moderationsPayload>[0] {
  return {
    id: ANTRAG,
    name: 'pog',
    pruefsumme: 'a'.repeat(64),
    dateiName: 'b'.repeat(32) + '.png',
    mimeTyp: 'image/png',
    bytes: 4096,
    animiert: false,
    breite: 128,
    hoehe: 128,
    herkunft: 'UPLOAD',
    herkunftNotiz: 'pog.png',
    status: 'OFFEN',
    antragstellerId: '900000000000000001',
    begruendung: null,
    modChannelId: null,
    modMessageId: null,
    abstimmungStartetAm: null,
    abstimmungEndetAm: null,
    stimmenZiel: null,
    abstimmungChannelId: null,
    abstimmungMessageId: null,
    entschiedenVon: null,
    entschiedenAm: null,
    ablehnungsGrund: null,
    emojiId: null,
    emojiName: null,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-01T12:00:00.000Z'),
    ...ueberschreiben,
  };
}

describe('Moderationsmeldung: Knöpfe nur, wo sie etwas tun', () => {
  it('zeigt Annehmen und Ablehnen bei einem offenen Vorschlag', () => {
    const payload = moderationsPayload(antrag(), 0, { abstimmungMoeglich: false });
    const label = payload.components?.[0]?.components.map((knopf) => knopf.label) ?? [];
    expect(label).toEqual(['Annehmen', 'Ablehnen']);
  });

  it('zeigt «Abstimmen lassen» nur, wenn die Abstimmung eingeschaltet ist', () => {
    /*
     * Ein Knopf, der eine Einstellung verlangt, ist eine Fehlermeldung mit
     * Vorlaufzeit: er sieht aus wie ein Weg und ist keiner.
     */
    const mit = moderationsPayload(antrag(), 0, { abstimmungMoeglich: true });
    expect(mit.components?.[0]?.components).toHaveLength(3);
    const ohne = moderationsPayload(antrag(), 0, { abstimmungMoeglich: false });
    expect(ohne.components?.[0]?.components).toHaveLength(2);
  });

  it.each(['ANGENOMMEN', 'ABGELEHNT', 'ABGELAUFEN'] as const)('nimmt bei «%s» alle Knöpfe weg', (status) => {
    // Ein Knopf an einem entschiedenen Vorschlag ist eine Einladung zu einer
    // Fehlermeldung.
    expect(moderationsPayload(antrag({ status }), 0).components).toEqual([]);
  });

  it('zeigt die Herkunft als Technik und behauptet nichts über Rechte', () => {
    const payload = moderationsPayload(antrag(), 0);
    const herkunft = payload.embeds?.[0]?.fields?.find((feld) => feld.name === 'Herkunft');
    expect(herkunft?.value).toContain('hochgeladen');
    // Keine Rechteaussage: SwissHub weiss nicht, wem das Bild gehört.
    const alles = JSON.stringify(payload).toLowerCase();
    for (const wort of ['copyright', 'urheber', 'lizenz', 'rechte am bild', 'eigentum']) {
      expect(alles, `«${wort}» hat hier nichts zu suchen`).not.toContain(wort);
    }
  });

  it('nennt den Stand einer Abstimmung', () => {
    const payload = moderationsPayload(antrag({ status: 'ABSTIMMUNG', stimmenZiel: 10 }), 4);
    expect(payload.embeds?.[0]?.description).toContain('4');
    expect(payload.embeds?.[0]?.description).toContain('10');
  });

  it('sagt bei «abgelaufen», dass nichts entschieden ist', () => {
    /*
     * Sonst liest der Antragsteller eine Entscheidung, die niemand getroffen
     * hat - und hört auf zu fragen.
     */
    const payload = moderationsPayload(antrag({ status: 'ABGELAUFEN', stimmenZiel: 10 }), 3);
    expect(payload.embeds?.[0]?.description).toContain('Entschieden ist damit nichts');
  });

  it('verweist auf das Vorschaubild nur, solange es eines gibt', () => {
    const basisUrl = 'https://swisshub.example';
    const offen = moderationsPayload(antrag(), 0, { basisUrl });
    expect(offen.embeds?.[0]?.thumbnail?.url).toContain(ANTRAG);

    // Nach der Annahme ist die Kopie aufgeräumt - ein Verweis darauf wäre ein
    // kaputtes Bild im Kanal.
    const angenommen = moderationsPayload(antrag({ status: 'ANGENOMMEN' }), 0, { basisUrl });
    expect(angenommen.embeds?.[0]?.thumbnail).toBeUndefined();
  });
});

describe('Abstimmungsnachricht', () => {
  it('trägt genau einen Stimmknopf mit dem Stand darauf', () => {
    const payload = abstimmungsPayload(
      antrag({ status: 'ABSTIMMUNG', stimmenZiel: 10, abstimmungEndetAm: new Date(Date.now() + 60_000) }),
      7,
    );
    const knoepfe = payload.components?.[0]?.components ?? [];
    expect(knoepfe).toHaveLength(1);
    // Der Stand steht auf dem Knopf: wer klickt, sieht ihn ohne Scrollen.
    expect(knoepfe[0]?.label).toBe('Dafür (7/10)');
  });

  it('nimmt den Knopf weg, sobald die Abstimmung vorbei ist', () => {
    expect(abstimmungsPayload(antrag({ status: 'ANGENOMMEN' }), 10).components).toEqual([]);
  });

  it('nennt niemanden namentlich', () => {
    /*
     * Die Abstimmung steht im Kanal der Community. Wer vorgeschlagen hat,
     * gehört dort nicht hin - das wäre eine Abstimmung über eine Person.
     */
    const payload = abstimmungsPayload(antrag({ status: 'ABSTIMMUNG', stimmenZiel: 10 }), 2);
    expect(JSON.stringify(payload)).not.toContain('900000000000000001');
  });
});

/** Block- und Zeilenkommentare entfernen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('Bot: die drei Befehle und ihre Prüfungen', () => {
  const befehle = lies('apps/bot/src/commands/emoji-commands.ts');
  const knoepfe = lies('apps/bot/src/emoji-buttons.ts');
  const register = lies('apps/bot/src/commands/register.ts');

  it('registriert die drei Befehle aus der Anforderung', () => {
    for (const name of ['emoji_add', 'emoji_request', 'emoji_vote']) {
      expect(befehle, `${name} fehlt`).toContain(`name: '${name}'`);
    }
    expect(register).toContain('EMOJI_COMMAND_DEFINITIONS');
    expect(register).toContain('handleEmojiCommand');
  });

  it('prüft jede der drei Berechtigungen', () => {
    const rumpf = ohneKommentare(befehle);
    for (const recht of ['manage', 'moderate', 'request']) {
      expect(rumpf, `${recht} wird nicht geprüft`).toContain(`EMOJI_PERMISSIONS.${recht}`);
    }
  });

  it('prüft die Moderationsknöpfe am Recht und nicht am Kanal', () => {
    /*
     * Dass eine Nachricht in einem Kanal steht, den nur das Team sieht, ist
     * keine Prüfung: ein Kanal lässt sich umkonfigurieren, und eine
     * Knopf-Kennung nachbauen.
     */
    const rumpf = ohneKommentare(knoepfe);
    expect(rumpf).toContain('buildCommandActor');
    expect(rumpf).toContain('EMOJI_PERMISSIONS.moderate');
  });

  it('holt den Anhang über die geprüfte Discord-Liste', () => {
    // Keine freie Adresse: `holeDiscordAnhang` prüft gegen die feste Liste und
    // danach gegen dieselbe SSRF-Prüfung wie jeder Import.
    const rumpf = ohneKommentare(befehle);
    expect(rumpf).toContain('holeDiscordAnhang');
    expect(rumpf).not.toMatch(/fetch\(/u);
  });

  it('baut keine zweite Fachlogik, sondern ruft das Modul', () => {
    const rumpf = ohneKommentare(befehle);
    for (const funktion of ['fuegeEmojiHinzu', 'reicheEin', 'starteAbstimmung']) {
      expect(rumpf, `${funktion} wird nicht verwendet`).toContain(`emoji.${funktion}`);
    }
    // Und keine eigene Namensprüfung oder Platzrechnung daneben.
    expect(rumpf).not.toMatch(/a-z0-9_/u);
    expect(rumpf).not.toContain('premiumTier');
  });

  it('kennt die Discord-Bild-Hosts fest und nicht aus einer Einstellung', () => {
    expect([...DISCORD_BILD_HOSTS]).toEqual(['cdn.discordapp.com', 'media.discordapp.net']);
  });
});

describe('Scheduler: die Frist steht in der Datenbank', () => {
  const jobs = ohneKommentare(lies('apps/bot/src/jobs.ts'));

  it('hat einen Job für die ablaufenden Abstimmungen', () => {
    expect(jobs).toContain("name: 'emoji-abstimmung'");
    expect(jobs).toContain('emoji.lasseAbstimmungenAblaufen()');
  });

  it('löst die Frist nicht mit einem Timer', () => {
    /*
     * Ein `setTimeout` auf zehn Minuten ist nach einem Neustart weg - und eine
     * Abstimmung, die nie endet, bleibt ewig offen, ohne dass jemand den Grund
     * sieht.
     */
    const abstimmung = ohneKommentare(lies('packages/modules/src/emoji/abstimmung.ts'));
    expect(abstimmung).not.toMatch(/setTimeout|setInterval/u);
    expect(abstimmung).toContain('abstimmungEndetAm');
  });

  it('sperrt die Antragszeile, bevor es zählt', () => {
    // Ohne die Sperre zählen zwei gleichzeitige Stimmen beide zu wenig.
    const abstimmung = lies('packages/modules/src/emoji/abstimmung.ts');
    expect(abstimmung).toContain('FOR UPDATE');
  });

  it('ruft Discord nicht innerhalb der Transaktion', () => {
    /*
     * Ein Netzaufruf unter Zeilensperre hält sie so lange, wie das Netz
     * braucht - bei einem Rate-Limit sind das Sekunden, in denen niemand sonst
     * abstimmen kann.
     */
    const abstimmung = lies('packages/modules/src/emoji/abstimmung.ts');
    const transaktion = abstimmung.slice(
      abstimmung.indexOf('prisma.$transaction'),
      abstimmung.indexOf('if (ergebnis.art !== '),
    );
    expect(transaktion).not.toContain('legeBeanspruchtenAntragAb');
    expect(transaktion).not.toContain('discord.');
  });
});
