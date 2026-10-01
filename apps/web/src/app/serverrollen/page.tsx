import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { serverrollen } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { RollenKnopf } from '@/modules/serverrollen/components/rollen-knopf';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

/**
 * Die öffentliche Rollenübersicht.
 *
 * ## Ohne Anmeldung lesbar, mit Anmeldung bedienbar
 *
 * Wer die Rollen verstehen will, ist meist neu - oft noch nicht einmal auf
 * dem Server. Eine Seite, die zuerst den Login verlangt, beantwortet die
 * Frage für genau die Leute nicht, die sie stellen.
 *
 * Die Knöpfe zum Selbstnehmen erscheinen nur für angemeldete Mitglieder, und
 * nicht, weil sie sonst «unschön» wären: ohne Sitzung gibt es keine Kennung,
 * auf die eine Zuweisung wirken könnte, und ohne Sitzung gibt es kein
 * CSRF-Token. Die Sperre sitzt in `aendereEigeneRolle`, nicht hier.
 *
 * ## Warum die Farbe von Discord kommt
 *
 * Weil sie das Erkennungsmerkmal ist. Wer im Chat eine grüne «Moderation»
 * gesehen hat, sucht hier nach Grün. Eine zweite, in SwissHub gepflegte Farbe
 * wäre genau die, die nach dem ersten Umfärben auf Discord falsch ist.
 *
 * Discords «0» heisst «keine eigene Farbe» und wird nicht zu Schwarz gemacht -
 * `rollenFarbe` gibt dafür `null`, und die Seite zeigt den neutralen Ton. Ein
 * schwarzer Punkt im Dark Mode wäre ohnehin unsichtbar.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Serverrollen · ${branding.name}`,
  description: 'Was die Rollen auf dem Server bedeuten und welche man sich selbst geben kann.',
};

export default async function OeffentlicheRollenSeite(): Promise<React.JSX.Element> {
  /*
   * Ausgeschaltet heisst 404.
   *
   * Diese Seite liegt ausserhalb von `(app)` - die Anmeldung steckt dort im
   * Layout, nicht in der Middleware. Ohne diese Prüfung wäre sie die einzige
   * Ansicht eines abgeschalteten Moduls, die weiterläuft.
   */
  const seite = await serverrollen.ladeOeffentlicheRollen();
  if (!seite) {
    notFound();
  }

  const context = await getOptionalAuthContext();
  const mitglied = context?.isMember ? context : null;
  // Nur für Angemeldete: welche der Rollen hat die Person schon? Für Gäste
  // bleibt die Liste leer - es gibt niemanden, über den etwas zu sagen wäre.
  const meine = mitglied ? new Set(await serverrollen.eigeneRollen(mitglied.user.discordId)) : new Set<string>();
  const csrfToken = mitglied ? csrfTokenFor(mitglied) : null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Serverrollen</h1>
        {seite.untertitel ? (
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
            {seite.untertitel}
          </p>
        ) : null}
      </header>

      {seite.kategorien.length === 0 ? (
        <EmptyState
          title="Noch nichts beschrieben"
          description="Das Team hat die Rollen noch nicht erklärt. Schau später wieder vorbei."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {seite.kategorien.map((gruppe) => (
            <Card key={gruppe.id} className="h-fit">
              <CardHeader>
                <CardTitle className="text-lg">{gruppe.name}</CardTitle>
                {gruppe.hinweis ? <CardDescription>{gruppe.hinweis}</CardDescription> : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {gruppe.rollen.map((rolle) => (
                  <div
                    key={rolle.discordRoleId}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        {/*
                          Die Farbe als Punkt und nicht als Textfarbe: ein
                          dunkles Discord-Rot auf dunklem Grund waere im Dark
                          Mode unlesbar, und ein hellgelbes im White Mode. Der
                          Punkt traegt die Farbe, der Name die Lesbarkeit.
                        */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            'size-2.5 shrink-0 rounded-full',
                            rolle.farbe ? '' : 'bg-muted-foreground/40',
                          )}
                          style={rolle.farbe ? { backgroundColor: rolle.farbe } : undefined}
                        />
                        <span className="truncate font-medium">{rolle.name}</span>
                      </div>
                      {rolle.beschreibung ? (
                        <p className="text-pretty text-sm text-muted-foreground">{rolle.beschreibung}</p>
                      ) : null}
                    </div>

                    {mitglied && csrfToken ? (
                      <div className="shrink-0">
                        <RollenKnopf
                          discordRoleId={rolle.discordRoleId}
                          name={rolle.name}
                          csrfToken={csrfToken}
                          hatSie={meine.has(rolle.discordRoleId)}
                          vergebbar={rolle.selbstVergebbar}
                          entfernbar={rolle.selbstEntfernbar}
                          sperrText={rolle.sperrText}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/*
        Der Hinweis für Gäste steht unten und nicht oben: wer die Seite öffnet,
        will zuerst die Rollen sehen. Er erscheint nur, wenn es überhaupt etwas
        selbst zu nehmen gibt - sonst waere er eine Einladung zu nichts.
      */}
      {!mitglied && seite.selbstvergabeAktiv ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Einige dieser Rollen kannst du dir selbst geben - dafür musst du mit Discord angemeldet sein.
            </p>
            <Link href="/login" className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
              Anmelden
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
