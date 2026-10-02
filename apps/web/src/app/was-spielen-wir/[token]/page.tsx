import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DoorOpen, LogIn } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { isModuleEnabled, spielwahl } from '@swisshub/modules';
import { ErrorState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { Buehne } from '@/modules/spielwahl/components/buehne';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { gastCsrfToken, gastKennung } from '@/server/gast';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Was spielen wir?',
  /*
   * `noindex`, und zwar hier ausdrücklich.
   *
   * Diese Seite liegt ausserhalb von `(app)` und ist damit ohne Anmeldung
   * erreichbar - die Stelle also, an der eine Suchmaschine sie im Gegensatz zu
   * früher tatsächlich lesen könnte. Ein Einladungslink wandert durch
   * Discord-Nachrichten; er soll nicht in einem Index landen.
   */
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Eine Spielauswahl - für Mitglieder und für Gäste.
 *
 * ## Eine Bühne, zwei Arten hereinzukommen
 *
 * Diese Seite lag früher in `(app)` und war damit hinter der Anmeldung. Sie
 * steht jetzt daneben, wie das öffentliche Profil, die Rangliste und die
 * Turnierseiten - und zwar dieselbe Seite und dieselbe Bühne. Eine zweite
 * Seite für Gäste wäre eine zweite Stelle, an der jeder neue Knopf, jede neue
 * Szene und jeder Fehler doppelt auftaucht; die eine davon, die man vergisst,
 * ist die öffentliche.
 *
 * ## Die drei Fälle
 *
 *  1. **Mitglied mit Leserecht.** Alles wie vorher: volle Bühne, Vorschläge,
 *     Führung, wenn die Rolle es erlaubt.
 *  2. **Besucher ohne Konto**, und die Runde lässt Gäste zu. Er trägt einen
 *     Namen ein und macht mit - beitreten, vorschlagen, abstimmen, und wenn
 *     es seine Runde ist, sie auch führen. Was er darf, setzt der Server
 *     durch (`spielwahl/gast.ts`), nicht diese Seite.
 *  3. **Alles andere**, und das ist genau ein Fall: die Runde lässt keine
 *     Gäste zu. Dann eine Einladung, sich anzumelden - kein 404, weil das
 *     falsch informiert: die Runde gibt es, sie steht diesem Besucher nur
 *     nicht offen.
 *
 * ## Warum ein Gast auch über die Sessionkennung hereinkommt
 *
 * Hier stand einmal: nur über den Einladungswert, denn «eine cuid ist nicht
 * geheim genug, um eine Tür zu sein». Das war richtig, solange die Übersicht
 * hinter der Anmeldung lag - die Kennung war damals nur Mitgliedern bekannt.
 *
 * Sie liegt jetzt offen: `/was-spielen-wir` ist öffentlich und listet die
 * laufenden Runden **mit ihrer Kennung** als Ziel. Der Einladungswert zu
 * verlangen schützte damit nichts mehr; er machte bloss den gewöhnlichen Weg
 * unmöglich - Besucher sieht eine offene Runde, klickt darauf, landet auf
 * einer Anmeldemaske. Genau das war als «verlangt weiterhin Login» gemeldet.
 *
 * Die Tür ist weiterhin `gaesteErlaubt`, und die entscheidet der Host. Der
 * Einladungswert bleibt, was er immer war: die Adresse, die man teilt.
 */
export default async function SpielwahlSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  if (!(await isModuleEnabled(spielwahl.SPIELWAHL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="«Was spielen wir?» ist derzeit ausgeschaltet." />;
  }

  const { token } = await params;
  const guildId = await resolveGuildId();
  const context = await getOptionalAuthContext();

  const istEinladung = spielwahl.einladungsSchema.safeParse(token).success;
  const session = istEinladung
    ? await spielwahl.findeUeberEinladung(guildId, token)
    : spielwahl.sessionIdSchema.safeParse(token).success
      ? await spielwahl.finde(guildId, token)
      : null;

  if (!session) {
    notFound();
  }

  /*
   * Erst das Mitglied fragen.
   *
   * Wer angemeldet ist, Mitglied ist und das Leserecht hat, ist Mitglied -
   * auch wenn er über den Einladungslink kommt und die Runde Gäste zulässt.
   * Andernfalls verlöre jemand durch einen geteilten Link seine eigenen
   * Vorschläge und seine Hostrolle.
   */
  const alsMitglied = context?.isMember === true && can(context, spielwahl.SPIELWAHL_PERMISSIONS.view);

  if (alsMitglied) {
    const stand = await spielwahl.baueAnsicht(session.id, context.user.discordId);
    if (!stand) {
      notFound();
    }
    return (
      <Buehne
        anfang={stand}
        csrfToken={csrfTokenFor(context)}
        darfModerieren={can(context, spielwahl.SPIELWAHL_PERMISSIONS.manage)}
      />
    );
  }

  /*
   * Dann den Gast.
   *
   * `gaesteErlaubt` entscheidet - und nichts sonst. Die Kennung wird hier nur
   * **gelesen**: eine Seite darf keine Cookies setzen, und wer nur zusieht,
   * braucht keines. Sie entsteht beim ersten Klick, in
   * `defineOeffentlicheAktion`.
   */
  if (session.gaesteErlaubt) {
    const kennung = await gastKennung();
    const stand = await spielwahl.baueAnsicht(session.id, kennung ?? spielwahl.GAST_PRAEFIX);
    if (!stand) {
      notFound();
    }
    return (
      <Buehne
        anfang={stand}
        // Ohne Kennung gibt es noch kein gültiges Token - die erste Aktion
        // vergibt beides zusammen und die Seite lädt danach neu.
        csrfToken={kennung ? gastCsrfToken(kennung) : ''}
        darfModerieren={false}
      />
    );
  }

  return <Einladung angemeldet={context !== null} token={token} />;
}

/**
 * Der eine Fall, in dem es ohne Anmeldung nicht weitergeht.
 *
 * **Die Runde lässt keine Gäste zu.** Das hat der Host entschieden (oder der
 * Server ganz abgeschaltet) - es ist keine Hürde dieser Anwendung, sondern
 * eine Einstellung dieser Runde. Für jede andere Runde führt der Weg ohne
 * Konto weiter, und auf der Übersicht steht der Knopf, eine eigene zu
 * eröffnen.
 *
 * Bewusst kein 404. Die Runde gibt es - sie steht diesem Besucher nur nicht
 * offen, und das sind zwei verschiedene Auskünfte. «Gibt es nicht» würde
 * jemanden, der einen gültigen Link bekommen hat, ratlos zurücklassen.
 */
function Einladung({ angemeldet, token }: { angemeldet: boolean; token: string }): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-border bg-card">
        <DoorOpen className="size-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Diese Runde läuft schon</h1>
        <p className="text-sm text-muted-foreground">
          {angemeldet
            ? 'Für diese Runde ist die Teilnahme ohne Konto nicht eingeschaltet, und dein Konto gehört (noch) nicht zum Server. Tritt dem Server bei, dann bist du dabei.'
            : 'Für diese Runde hat der Host die Teilnahme ohne Konto ausgeschaltet. Melde dich an - oder mach auf der Übersicht eine eigene Runde auf, dafür brauchst du kein Konto.'}
        </p>
      </div>
      <Link
        href={`/login?redirect=${encodeURIComponent(`/was-spielen-wir/${token}`)}`}
        className={cn(buttonVariants())}
      >
        <LogIn className="size-4" aria-hidden="true" />
        Anmelden
      </Link>
    </div>
  );
}
