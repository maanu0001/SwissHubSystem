'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import type { level } from '@swisshub/modules';
import { formatSwissNumber } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SymbolGrafik } from './symbol-grafik';

/**
 * Die Infotafel.
 *
 * ## Warum hier alles steht
 *
 * Weil es das Konzept verlangt - «transparent, keine versteckten
 * Bedingungen» - und weil es richtig ist. Jede Zahl, die ueber einen Gewinn
 * entscheidet, steht hier: die Auszahlung jedes aktiven Symbols fuer drei,
 * vier und fuenf Gleiche, die Wild-Regel, die Bonusbedingung, die
 * Freispielzahl samt Risikoleiter, Sticky Wilds, Retrigger, Jackpot, Premium,
 * die theoretische Quote, die Einsaetze, der Hoechstgewinn und die Grenzen.
 *
 * Die Zahlen kommen aus derselben Konfiguration, mit der gespielt wird - nicht
 * aus einem Text, den jemand von Hand nachfuehrt. Eine Infotafel, die man
 * pflegen muss, ist nach der ersten Aenderung falsch.
 */

type Ansicht = Awaited<ReturnType<typeof level.xpslot.slotAnsicht>>;

const ROLLEN: Record<string, string> = {
  WILD: 'Wild',
  SCATTER: 'Bonus',
  JACKPOT: 'Jackpot',
  PREMIUM: 'Premium',
};

/**
 * Ein Multiplikator als Text.
 *
 * Von Hand und nicht ueber `toLocaleString('de-CH')`: Node und die Browser
 * bringen unterschiedliche ICU-Fassungen mit und setzen mal den geraden, mal
 * den typografischen Apostroph. Derselbe Wert faellt dann serverseitig anders
 * aus als im Browser - und React meldet einen Hydration-Fehler. Genau dafuer
 * gibt es `formatSwissNumber`; hier kommen nur die Nachkommastellen dazu, die
 * jene Helferin bewusst nicht kennt.
 */
function faktor(wert: number): string {
  if (wert <= 0) {
    return '–';
  }
  const ganz = formatSwissNumber(Math.trunc(wert));
  const rest = Math.round((wert - Math.trunc(wert)) * 100);
  if (rest === 0) {
    return `${ganz}×`;
  }
  return `${ganz}.${String(rest).padStart(2, '0').replace(/0$/u, '')}×`;
}

export function Infotafel({ ansicht }: { ansicht: Ansicht }): React.JSX.Element {
  const [offen, setOffen] = useState(false);

  return (
    <Dialog open={offen} onOpenChange={setOffen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info aria-hidden="true" />
          Auszahlungen &amp; Regeln
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scrollbar-slim">
        <DialogHeader>
          <DialogTitle>Auszahlungen und Regeln</DialogTitle>
          <DialogDescription>
            Alle Werte stammen aus der laufenden Konfiguration. Auszahlungen sind Vielfache deines Einsatzes;
            mehrere Linien zahlen zusammen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 text-sm">
          <section>
            <h3 className="mb-2 font-semibold">Symbole</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left font-medium">Symbol</th>
                    <th className="p-2 text-right font-medium">3×</th>
                    <th className="p-2 text-right font-medium">4×</th>
                    <th className="p-2 text-right font-medium">5×</th>
                  </tr>
                </thead>
                <tbody>
                  {ansicht.symbole.map((symbol) => {
                    return (
                      <tr key={symbol.key} className="border-t border-border">
                        <td className="p-2">
                          <span className="flex items-center gap-2">
                            {/*
                              Derselbe Rueckfall wie in der Walze: die Tafel
                              soll zeigen, was das Spiel zeigt - auch dann,
                              wenn ein eigenes Bild nicht laedt.
                            */}
                            <SymbolGrafik symbol={symbol} className="size-6 object-contain" />
                            <span className="font-medium">{symbol.name}</span>
                            {ROLLEN[symbol.rolle] ? (
                              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--primary-bright))]">
                                {ROLLEN[symbol.rolle]}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {symbol.beschreibung}
                          </span>
                        </td>
                        {[0, 1, 2].map((stufe) => (
                          <td key={stufe} className="p-2 text-right tabular-nums">
                            {symbol.rolle === 'JACKPOT' && stufe === 2
                              ? `${ansicht.jackpotMultiplikator}× (Jackpot)`
                              : faktor(symbol.auszahlung[stufe] ?? 0)}
                            {symbol.premiumTage[stufe] ? (
                              <span className="block text-[10px] text-[hsl(var(--primary-bright))]">
                                + {symbol.premiumTage[stufe]} Tage Premium
                              </span>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Regel titel="Gewinnlinien">
              {ansicht.linien.length} feste Linien, gezählt von links. Mehrere Linien zahlen gleichzeitig; je
              Linie zählt der höchste Treffer.
            </Regel>
            <Regel titel="Wild">
              Ersetzt {ansicht.wildErsetztAlles ? 'jedes Symbol' : 'jedes gewöhnliche Symbol'}.
              {ansicht.jackpotNurEcht
                ? ' Für den Jackpot zählt es nicht - dafür braucht es fünf echte Logos.'
                : ''}
            </Regel>
            <Regel titel="Bonus">
              {ansicht.bonusAusloeser} Bonussymbole - irgendwo auf dem Feld, keine Linie nötig - starten die
              Bonusrunde mit {ansicht.bonusFreispiele} garantierten Freispielen.
            </Regel>
            <Regel titel="Risikoleiter">
              {ansicht.leiter.length === 0
                ? 'Keine Risikostufen eingerichtet.'
                : ansicht.leiter
                    .map((stufe) => `${stufe.freispiele} zu ${Math.round(stufe.chance * 100)} %`)
                    .join(', ')}
              . Ein verlorenes Risiko kostet die ganze Bonusrunde.
            </Regel>
            <Regel titel="Freispiele">
              Kein Einsatz, Gewinne zählen normal.
              {ansicht.stickyWilds ? ' Wilds bleiben für die ganze Runde stehen.' : ''}
              {ansicht.retriggerSpins > 0
                ? ` Erneute Bonussymbole bringen +${ansicht.retriggerSpins} Freispiele.`
                : ''}
            </Regel>
            <Regel titel="Jackpot">
              Fünf {ansicht.jackpotNurEcht ? 'echte ' : ''}Logos auf einer Linie zahlen{' '}
              {ansicht.jackpotMultiplikator}× deinen Einsatz. Kein Pott, der mitwächst - der Multiplikator
              steht fest.
            </Regel>
            {ansicht.premiumAktiv ? (
              <Regel titel="Premium">
                Das Premiumsymbol zahlt XP und zusätzlich Premium-Tage. Gutgeschrieben wird über das normale
                Premium-System; wer schon Premium hat, bekommt den Gewinn danach.
              </Regel>
            ) : null}
            <Regel titel="Höchstgewinn">
              {ansicht.maxGewinnMultiplikator > 0
                ? `${ansicht.maxGewinnMultiplikator}× Einsatz je Spin.`
                : 'Kein Deckel eingestellt.'}
            </Regel>
            <Regel titel="Theoretische Auszahlungsquote">
              {(ansicht.rtp * 100).toFixed(1)} % - aus dieser Konfiguration gerechnet, nicht gesetzt. Über
              viele Spins; ein einzelner Abend sagt nichts darüber.
            </Regel>
            <Regel titel="Einsätze">{ansicht.einsaetze.join(', ')} XP.</Regel>
          </section>

          {grenzenText(ansicht).length > 0 ? (
            <section>
              <h3 className="mb-2 font-semibold">Deine Grenzen</h3>
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {grenzenText(ansicht).map((zeile) => (
                  <li key={zeile}>{zeile}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            Spiele bewusst mit deinen XP. Der Slot ist ein Spiel und keine Einnahmequelle - über viele Spins
            bleibt ein Teil des Einsatzes im System.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Regel({ titel, children }: { titel: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titel}</p>
      <p className="mt-1 text-xs">{children}</p>
    </div>
  );
}

function grenzenText(ansicht: Ansicht): string[] {
  const zeilen: string[] = [];
  if (ansicht.grenzen.maxTagesverlust > 0) {
    zeilen.push(`Höchstens ${ansicht.grenzen.maxTagesverlust} XP Verlust pro Tag.`);
  }
  if (ansicht.grenzen.maxTagesgewinn > 0) {
    zeilen.push(`Höchstens ${ansicht.grenzen.maxTagesgewinn} XP Gewinn pro Tag.`);
  }
  if (ansicht.grenzen.maxSpinsJeSitzung > 0) {
    zeilen.push(
      `Höchstens ${ansicht.grenzen.maxSpinsJeSitzung} Spins je Sitzung` +
        (ansicht.grenzen.sitzungspauseSekunden > 0
          ? `, danach ${Math.ceil(ansicht.grenzen.sitzungspauseSekunden / 60)} Minuten Pause.`
          : '.'),
    );
  }
  return zeilen;
}
