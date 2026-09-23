import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@swisshub/database';
import { wrapped } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { BuehneRahmen } from '@/modules/wrapped/components/buehne-rahmen';
import { requirePagePermission } from '@/server/auth';
import { baueVorschau } from '@/server/wrapped-vorschau';

export const metadata: Metadata = { title: 'Wrapped Bühne', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Die nackte Buehne - der Inhalt des Rahmens im Studio.
 *
 * ## Warum ein eigener Seitenaufruf und kein Kasten
 *
 * Die Geschichte rechnet in `vw`, `dvh` und Breakpoints. Alle drei beziehen
 * sich auf das **Fenster**, nicht auf einen Kasten darin. Ein auf 390 Pixel
 * verkleinerter Kasten in einem 1440 Pixel breiten Fenster zeigte deshalb
 * Telefonbreite mit Desktop-Schriftgroessen - also eine Komposition, die es
 * auf keinem Geraet gibt. In einem `iframe` ist das Fenster 390 Pixel
 * breit, und was man sieht, ist das, was auch ein Telefon zeigt.
 *
 * ## Was hier nicht passiert
 *
 * Nichts Schreibendes. Dieselbe lesende Vorschau-Maschine wie im Studio,
 * dieselbe Zusage: keine Momentaufnahme, kein XP, keine Benachrichtigung,
 * kein Discord-Beitrag, kein «angesehen»-Vermerk. Die Story bekommt
 * `vorschau` gesetzt und meldet deshalb gar keinen Fortschritt.
 *
 * Die Adresse ist nicht geheim, aber sie verlangt dieselbe Berechtigung wie
 * das Studio - und sie wird nicht indiziert.
 */

const zahl = z.coerce.number().int().min(0);

const parameter = z.object({
  quelle: z.enum(['person', 'fixture']).default('fixture'),
  persona: z.string().trim().max(40).optional(),
  discordId: z
    .string()
    .trim()
    .regex(/^[0-9]{5,25}$/)
    .optional(),
  szene: zahl.max(99).optional(),
  einzeln: z.enum(['0', '1']).optional(),
  ruhig: z.enum(['0', '1']).optional(),
  hilfslinien: z.enum(['0', '1']).optional(),
  voiceSeconds: zahl.max(40_000_000).optional(),
  messages: zahl.max(5_000_000).optional(),
  activeDays: zahl.max(366).optional(),
  levelEnd: zahl.max(999).optional(),
  clipWins: zahl.max(999).optional(),
  primeTimeStunde: zahl.max(23).optional(),
});

export default async function WrappedBuehnePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const [{ id }, roh] = await Promise.all([params, searchParams]);
  await requirePagePermission(wrapped.WRAPPED_PERMISSIONS.preview);

  const gelesen = parameter.safeParse(roh);
  if (!gelesen.success) {
    notFound();
  }
  const eingabe = gelesen.data;

  const guildId = await resolveGuildId();
  const campaign = await prisma.wrappedCampaign.findUnique({ where: { id } });
  if (!campaign || campaign.guildId !== guildId) {
    notFound();
  }

  const ueberschreibung: wrapped.FixtureUeberschreibung = {};
  for (const feld of [
    'voiceSeconds',
    'messages',
    'activeDays',
    'levelEnd',
    'clipWins',
    'primeTimeStunde',
  ] as const) {
    const wert = eingabe[feld];
    if (wert !== undefined) {
      ueberschreibung[feld] = wert;
    }
  }

  const ergebnis = await baueVorschau(campaign, {
    quelle: eingabe.quelle,
    discordId: eingabe.discordId ?? null,
    persona: eingabe.persona ?? wrapped.WRAPPED_PERSONAS[0]?.key ?? null,
    ...(Object.keys(ueberschreibung).length > 0 ? { ueberschreibung } : {}),
  });

  const einzeln = eingabe.einzeln === '1';
  const start = Math.min(eingabe.szene ?? 0, Math.max(0, ergebnis.sceneKeys.length - 1));

  return (
    <BuehneRahmen
      daten={ergebnis.daten}
      sceneKeys={ergebnis.sceneKeys}
      jahr={campaign.displayYear}
      zurueckHref={`/system/wrapped/${campaign.id}/vorschau`}
      startIndex={start}
      einzeln={einzeln}
      ruhig={eingabe.ruhig === '1'}
      hilfslinien={eingabe.hilfslinien === '1'}
      vorschau={{ label: `Vorschau · ${ergebnis.herkunft === 'live' ? 'echte Zahlen' : 'Testperson'}` }}
    />
  );
}
