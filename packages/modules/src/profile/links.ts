import { z } from 'zod';

/**
 * Der Link-in-Bio-Bereich: was ein Mitglied nach aussen verlinkt.
 *
 * ## Zwei Quellen, eine Liste
 *
 * **Plattformkonten** stehen in `MemberSocialLink` - dort liegt eine Kennung,
 * und die Adresse baut `socials.ts` daraus. Aus einer Eingabe kann dort kein
 * fremdes Ziel werden, weil nie eine Adresse eingegeben wird.
 *
 * **Freie Links** stehen in `MemberProfileLink` - dort liegt eine vollstaendige
 * Adresse, weil es keine Registry fuer «irgendeine Seite» gibt. Genau deshalb
 * braucht diese Form eine eigene Pruefung, und genau deshalb steht sie in einer
 * eigenen Tabelle: zwei Formen mit zwei Pruefungen in einer Spalte hiessen, in
 * jeder Abfrage zu unterscheiden, welche gerade gilt.
 *
 * Diese Datei fuehrt beide zu **einer** sortierten Liste zusammen - das ist,
 * was die oeffentliche Seite zeichnet und der Editor bearbeitet.
 *
 * ## Warum hier keine Datenbank vorkommt
 *
 * Damit der Editor im Browser dieselbe Pruefung verwenden kann, die der Server
 * danach anwendet. Zwei Regeln waeren der Fehler: das Formular liesse etwas
 * durch, das der Server ablehnt, oder umgekehrt - und beide Male saehe es nach
 * einem Fehler im Formular aus.
 */

/** Wie viele Links insgesamt. Mehr ist keine Visitenkarte, sondern ein Verzeichnis. */
export const MAX_LINKS = 12;
/** Wie viele davon als grosser Knopf. Drei ist die Grenze der Aufmerksamkeit. */
export const MAX_HERVORGEHOBEN = 3;
export const MAX_LABEL_LAENGE = 40;
export const MAX_URL_LAENGE = 300;

/**
 * Die Adressen, die als freier Link durchgehen.
 *
 * ## Warum eine Allowlist der Schemata und keine Blocklist
 *
 * Eine Liste verbotener Schemata - `javascript:`, `data:`, `vbscript:` - ist
 * immer unvollstaendig, und was nicht darauf steht, geht durch. Hier steht
 * genau ein Schema, und alles andere fehlt. Dieselbe Ueberlegung wie bei
 * `socials.ts`.
 *
 * ## Warum ausschliesslich `https`
 *
 * `http` waere ein Link, den ein Besucher unverschluesselt oeffnet, und die
 * Seite hat ohnehin einen Knopf daneben, der es besser kann. Wer heute eine
 * oeffentliche Seite betreibt, hat TLS.
 *
 * ## Was sonst abgelehnt wird
 *
 * - Zugangsdaten im Host (`https://opfer@boese.example`): sie sehen im Text
 *   wie eine andere Domain aus als die, auf der man landet.
 * - Ein Host ohne Punkt (`https://localhost`, `https://intern`): beides zeigt
 *   ins eigene Netz, nicht ins offene.
 * - Die eigene Adresse als Umleitung auf eine fremde: Weiterleitungsziele
 *   pruefen wir nicht, und deshalb steht hier auch kein Sonderfall dafuer - der
 *   Link geht mit `rel="noopener noreferrer"` in ein neues Fenster.
 */
export function pruefeLinkAdresse(roh: string): { ok: true; url: string } | { ok: false; grund: string } {
  const wert = roh.trim();
  if (wert.length === 0) {
    return { ok: false, grund: 'Gib eine Adresse an.' };
  }
  if (wert.length > MAX_URL_LAENGE) {
    return { ok: false, grund: `Die Adresse darf höchstens ${MAX_URL_LAENGE} Zeichen haben.` };
  }

  let adresse: URL;
  try {
    adresse = new URL(wert);
  } catch {
    return { ok: false, grund: 'Das ist keine vollständige Adresse. Beispiel: https://example.com/seite' };
  }

  if (adresse.protocol !== 'https:') {
    return { ok: false, grund: 'Nur https-Adressen. Andere Links öffnen wir nicht.' };
  }
  if (adresse.username !== '' || adresse.password !== '') {
    return { ok: false, grund: 'Adressen mit Benutzername oder Passwort sind nicht erlaubt.' };
  }
  if (!adresse.hostname.includes('.') || adresse.hostname.endsWith('.')) {
    return { ok: false, grund: 'Der Hostname sieht nicht nach einer öffentlichen Seite aus.' };
  }

  /*
   * Zurueck aus dem `URL`-Objekt und nicht die Eingabe.
   *
   * Damit ist gespeichert, was der Browser tatsaechlich aufloesen wuerde -
   * inklusive normalisiertem Host und entfernten Standardports. Ein Unterschied
   * zwischen dem, was dasteht, und dem, wohin es fuehrt, ist genau die Luecke,
   * die eine Pruefung auf der Eingabe offen laesst.
   */
  return { ok: true, url: adresse.toString() };
}

const linkAdresse = z
  .string()
  .trim()
  .max(MAX_URL_LAENGE)
  .superRefine((wert, ctx) => {
    const geprueft = pruefeLinkAdresse(wert);
    if (!geprueft.ok) {
      ctx.addIssue({ code: 'custom', message: geprueft.grund });
    }
  })
  .transform((wert) => {
    const geprueft = pruefeLinkAdresse(wert);
    // `superRefine` hat schon abgebrochen, wenn es nicht passt - dieser Zweig
    // ist die Zusicherung fuer den Typ, nicht ein zweiter Weg.
    return geprueft.ok ? geprueft.url : wert;
  });

/**
 * Ein Eintrag der Liste, wie der Editor sie schickt.
 *
 * Die Unterscheidung steckt in `art` und nicht in «ist `url` gesetzt»: ein
 * Eintrag, dessen Bedeutung sich aus der Anwesenheit eines Feldes ergibt, ist
 * eine Einladung, beide zu schicken.
 */
export const linkEintragSchema = z.discriminatedUnion('art', [
  z.object({
    art: z.literal('plattform'),
    /** Schluessel aus `socials.ts` - nicht gepruefte Plattformen fallen dort durch. */
    plattform: z.string().min(1).max(32),
    handle: z.string().trim().min(1, 'Bitte etwas eintragen.').max(64),
    label: z
      .string()
      .trim()
      .max(MAX_LABEL_LAENGE, `Der Titel darf höchstens ${MAX_LABEL_LAENGE} Zeichen haben.`)
      .transform((wert) => (wert.length === 0 ? null : wert))
      .nullable()
      .default(null),
    verborgen: z.boolean().default(false),
    hervorgehoben: z.boolean().default(false),
  }),
  z.object({
    art: z.literal('frei'),
    url: linkAdresse,
    label: z
      .string()
      .trim()
      .min(1, 'Ein freier Link braucht einen Titel.')
      .max(MAX_LABEL_LAENGE, `Der Titel darf höchstens ${MAX_LABEL_LAENGE} Zeichen haben.`),
    verborgen: z.boolean().default(false),
    hervorgehoben: z.boolean().default(false),
  }),
]);

export type LinkEintragEingabe = z.infer<typeof linkEintragSchema>;

export const linksSchema = z.object({
  eintraege: z
    .array(linkEintragSchema)
    .max(MAX_LINKS, `Höchstens ${MAX_LINKS} Links.`)
    .superRefine((liste, ctx) => {
      const plattformen = new Set<string>();
      const adressen = new Set<string>();
      let hervorgehoben = 0;

      for (const [index, eintrag] of liste.entries()) {
        if (eintrag.hervorgehoben && !eintrag.verborgen) {
          hervorgehoben += 1;
        }
        if (eintrag.art === 'plattform') {
          if (plattformen.has(eintrag.plattform)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'plattform'],
              message: 'Diese Plattform steht schon in der Liste.',
            });
          }
          plattformen.add(eintrag.plattform);
          continue;
        }
        const geprueft = pruefeLinkAdresse(eintrag.url);
        const schluessel = geprueft.ok ? geprueft.url : eintrag.url;
        if (adressen.has(schluessel)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'url'],
            message: 'Dieser Link steht schon in der Liste.',
          });
        }
        adressen.add(schluessel);
      }

      if (hervorgehoben > MAX_HERVORGEHOBEN) {
        ctx.addIssue({
          code: 'custom',
          path: ['eintraege'],
          message: `Höchstens ${MAX_HERVORGEHOBEN} Links lassen sich hervorheben - sonst hebt sich keiner mehr ab.`,
        });
      }
    }),
});

export type LinksEingabe = z.infer<typeof linksSchema>;

/**
 * Ein Link, wie die oeffentliche Seite ihn zeichnet.
 *
 * Flach und ohne Bezug auf Prisma: die Karte soll einen Twitch-Kanal und einen
 * freien Link gleich darstellen koennen, ohne beide Tabellen zu kennen.
 */
export interface AngezeigterLink {
  /** Stabiler Schluessel fuer React - «twitch» oder die Adresse. */
  key: string;
  art: 'plattform' | 'frei';
  /** Was auf dem Knopf steht. */
  label: string;
  /** Die Kennung, falls es eine gibt - «swisshub» unter «Twitch». */
  handle: string | null;
  url: string;
  /** Name eines Lucide-Symbols. */
  symbol: string;
  hervorgehoben: boolean;
  /**
   * Ist die Inhaberschaft belegt?
   *
   * Heute nur bei einem Kanal, den der Streamer Hub per OAuth bestaetigt hat.
   * Ein selbst eingetippter Name ist kein Nachweis, und ein freier Link kann es
   * grundsaetzlich nicht sein - dort steht `false`, und zwar ohne Ausnahme.
   */
  verifiziert: boolean;
}

/**
 * Welches Symbol zu einer Plattform gehoert.
 *
 * Bewusst knapp: Lucide hat keine Markensymbole, also gibt es keine echten
 * Logos. Ein Symbol, das die Art des Ziels andeutet, ist ehrlicher als ein
 * nachgezeichnetes Logo, das falsch aussieht.
 */
const SYMBOLE: Record<string, string> = {
  twitch: 'Radio',
  youtube: 'Clapperboard',
  steam: 'Gamepad2',
  faceit: 'Swords',
  riot: 'Swords',
  epic: 'Gamepad2',
  battlenet: 'Gamepad2',
  xbox: 'Gamepad2',
  psn: 'Gamepad2',
  nintendo: 'Gamepad2',
};

export function linkSymbol(art: 'plattform' | 'frei', plattform?: string | null): string {
  if (art === 'frei') {
    return 'Link2';
  }
  return (plattform && SYMBOLE[plattform]) || 'Link2';
}
