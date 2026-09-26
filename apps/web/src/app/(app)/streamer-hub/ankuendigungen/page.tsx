import type { Metadata } from 'next';
import Link from 'next/link';
import { streamer } from '@swisshub/modules';
import { PLATTFORMEN } from '@swisshub/modules/streamer/typen';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/shared/page-header';
import { ModulNavigation } from '@/components/shared/modul-navigation';
import { requirePagePermission } from '@/server/auth';
import { streamerNavigation } from '@/modules/streamer/navigation';

export const metadata: Metadata = { title: 'Live-Ankündigungen' };
export const dynamic = 'force-dynamic';

/**
 * Was gesendet wurde - und was nicht.
 *
 * ## Warum gescheiterte Versuche hier stehen
 *
 * Weil sonst niemand erfaehrt, dass eine Ankuendigung ausgefallen ist. Eine
 * Zeile ohne Sendezeitpunkt und mit Fehlertext ist die einzige Stelle, an der
 * ein fehlender Discord-Beitrag sichtbar wird - im Kanal fehlt er still.
 *
 * ## Warum es keine Schaltflaeche «nochmal senden» gibt
 *
 * Weil der Job es selbst wiederholt, solange der Stream laeuft und die Grenze
 * von drei Versuchen nicht erreicht ist. Ein Knopf daneben waere ein vierter
 * Weg zu einer Nachricht, die schon draussen sein koennte.
 */
export default async function AnkuendigungenSeite(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(streamer.STREAMER_PERMISSIONS.announce);

  const [zeilen, einstellungen] = await Promise.all([
    streamer.ladeAnkuendigungen(),
    streamer.leseStreamerEinstellungen(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ModulNavigation
        eintraege={streamerNavigation(context)}
        aktiv="ankuendigungen"
        label="Bereiche im Streamer Hub"
      />
      <PageHeader
        title="Live-Ankündigungen"
        description="Höchstens eine je Stream - auch nach einem Neustart."
      />

      <Card>
        <CardHeader>
          <CardTitle>Einstellung</CardTitle>
          <CardDescription>
            Änderbar unter{' '}
            <Link href="/modules/streamer" className="text-primary underline-offset-4 hover:underline">
              System → Module → Streamer Hub
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Ankündigungen</div>
            <div className={einstellungen.ankuendigungAktiv ? 'text-success' : 'text-muted-foreground'}>
              {einstellungen.ankuendigungAktiv ? 'aktiv' : 'aus'}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Kanal</div>
            <div className="font-mono text-xs">
              {einstellungen.ankuendigungChannelId || <span className="text-warning">nicht gewählt</span>}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Ruhezeit je Streamer</div>
            <div>{einstellungen.cooldownMinuten} Minuten</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Höchstens pro Tag</div>
            <div>{einstellungen.maxProTag}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verlauf</CardTitle>
          <CardDescription>Die letzten {zeilen.length} Einträge, neueste zuerst.</CardDescription>
        </CardHeader>
        <CardContent>
          {zeilen.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Noch keine Ankündigung. Sie entstehen, sobald ein freigegebener Streamer live geht.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Streamer</TableHead>
                  <TableHead>Stream</TableHead>
                  <TableHead>Gestartet</TableHead>
                  <TableHead>Gesendet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zeilen.map((zeile) => (
                  <TableRow key={zeile.id}>
                    <TableCell>
                      <div className="font-medium">{zeile.anzeigename}</div>
                      <div className="text-xs text-muted-foreground">
                        {PLATTFORMEN[zeile.plattform as 'TWITCH' | 'YOUTUBE'].label} · {zeile.handle}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <span className="line-clamp-2 text-sm">{zeile.titel ?? '–'}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(zeile.gestartetAm)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {zeile.gesendetAm ? (
                        <span className="text-sm">{formatDateTime(zeile.gesendetAm)}</span>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Badge variant="destructive">nicht gesendet</Badge>
                          {zeile.fehler ? (
                            <span className="text-xs text-muted-foreground">
                              {zeile.fehler} ({zeile.versuche} {zeile.versuche === 1 ? 'Versuch' : 'Versuche'}
                              )
                            </span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
