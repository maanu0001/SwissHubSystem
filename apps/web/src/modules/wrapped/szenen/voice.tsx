'use client';

import { kanalText, matesText, primeTime, voiceText, voiceVergleich } from '@swisshub/modules/wrapped/texte';
import { primeTimeStunde } from '@swisshub/modules/wrapped/vorlage';
import { Faden } from '../teile/faden';
import { Nachsatz, Satz, SzenenRahmen, Vorzeile, WrappedAvatar, ZaehlZahl } from '../teile/bausteine';
import type { SzenenProps } from './registry';

/**
 * Die Sprachzeit - die Szene, an der sich Wrapped entscheidet.
 *
 * ## Der Aufbau
 *
 * Setup, Pause, Zahl, Visualisierung, Pointe. Fuenf Schritte, und jeder
 * bekommt seine eigene Verzoegerung. Kaeme alles auf einmal, waere es eine
 * Kachel.
 *
 * ## Die Wellenform
 *
 * Kein zufaelliges Rauschen, sondern **die eigene Stundenverteilung**. Die
 * Balken zeigen, wann diese Person im Sprachkanal war - der Ausschlag um
 * 22 Uhr gehoert ihr. Eine erfundene Welle haette gleich gut ausgesehen und
 * nichts bedeutet; genau das ist der Unterschied zwischen Dekoration und
 * Visualisierung.
 */
/**
 * Zahl und Einheit fuer eine Dauer.
 *
 * Unter einer Stunde wird in Minuten gezaehlt. Sonst stand bei einer
 * Viertelstunde im Lieblingskanal gross eine **0** auf dem Schirm - eine
 * Szene, die gar nichts erzaehlt, und genau das, was ein Rueckblick nie
 * zeigen darf.
 */
function dauer(sekunden: number): { wert: number; einheit: string } {
  if (sekunden < 3600) {
    const minuten = Math.max(1, Math.round(sekunden / 60));
    return { wert: minuten, einheit: minuten === 1 ? 'Minute' : 'Minuten' };
  }
  const stunden = Math.round(sekunden / 3600);
  return { wert: stunden, einheit: stunden === 1 ? 'Stunde' : 'Stunden' };
}

/** Kurzform fuer Nebenzeilen: «12h» oder «40m». */
function kurzeDauer(sekunden: number): string {
  return sekunden < 3600 ? `${Math.max(1, Math.round(sekunden / 60))}m` : `${Math.round(sekunden / 3600)}h`;
}

export function VoiceGesamtSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  const gesamt = dauer(daten.voice.seconds);
  const text = voiceText(daten.voice.seconds);
  const vergleich = voiceVergleich(daten.voice.seconds);
  const spitze = Math.max(1, ...daten.voice.hours);

  return (
    <SzenenRahmen>
      <div className="space-y-7">
        <Satz verzug={150}>{text.setup}</Satz>

        <div>
          <ZaehlZahl wert={gesamt.wert} verzug={900} dauer={1700} stillstand={stillstand} />
          <p className="w-auf w-label mt-3 text-white/55" style={{ ['--verzug' as string]: '1500ms' }}>
            {gesamt.einheit} im Voice
          </p>
        </div>

        {/* Die eigene Stundenverteilung als Wellenform. */}
        {/*
          Vierundzwanzig Balken ueber die volle Breite.
          Die erste Fassung gab jedem Balken eine feste Breite und zentrierte
          sie - bei einem Schwerpunkt am Abend sass die Welle dadurch als
          schmales Buendel am rechten Rand und sah aus wie ein Fehler.
          `flex-1` verteilt sie ueber den ganzen Raum: die Kurve wird zur
          Form, und man sieht auf einen Blick, wann der Tag lief.
        */}
        <div
          className="flex h-20 items-end gap-[2px] sm:gap-1"
          role="img"
          aria-label={`Verteilung der Sprachzeit über den Tag, Höhepunkt um ${String(
            primeTimeStunde(daten.voice.hours) ?? 0,
          ).padStart(2, '0')} Uhr`}
        >
          {daten.voice.hours.map((wert, stunde) => (
            <span
              key={stunde}
              className="w-balken min-w-0 flex-1 rounded-full bg-[hsl(var(--w-rot-hell))]"
              style={{
                height: `${Math.max(5, (wert / spitze) * 100)}%`,
                ['--verzug' as string]: `${1700 + stunde * 26}ms`,
                opacity: 0.28 + (wert / spitze) * 0.72,
              }}
            />
          ))}
        </div>
        <div className="-mt-5 flex justify-between text-[0.6rem] font-medium tabular-nums text-white/25">
          {['00', '06', '12', '18', '23'].map((marke) => (
            <span key={marke}>{marke}</span>
          ))}
        </div>

        {vergleich ? <Nachsatz verzug={2500}>{vergleich}</Nachsatz> : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Der Lieblingskanal.
 *
 * ## Die Idee
 *
 * Die uebrigen Kanaele ziehen vorbei und werden blass; einer bleibt. Das ist
 * dieselbe Bewegung, die man macht, wenn man eine Liste durchgeht und bei
 * einem Namen haengenbleibt - nur sichtbar gemacht.
 *
 * Linksbuendig, nicht mittig: hier geht es um Namen, und Namen liest man von
 * links.
 */
export function VoiceKanalSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  const [oben, ...weitere] = daten.voice.topChannels;
  if (!oben) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }
  const oberste = dauer(oben.seconds);
  const text = kanalText(oben.seconds);

  return (
    <SzenenRahmen ausrichtung="links">
      <div className="w-full space-y-6">
        <Vorzeile verzug={120}>Dein Kanal</Vorzeile>

        <div className="space-y-1">
          <p
            className="w-vorhang text-[clamp(2rem,10vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
            style={{ ['--verzug' as string]: '350ms' }}
          >
            {oben.name ?? 'Unbekannter Kanal'}
          </p>
          <Faden
            variante="linie"
            className="h-5 w-full max-w-sm text-[hsl(var(--w-rot-hell))]"
            verzug={stillstand ? 0 : 900}
            breite={5}
          />
        </div>

        <div className="flex items-baseline gap-3">
          <ZaehlZahl
            wert={oberste.wert}
            verzug={1000}
            dauer={1400}
            stillstand={stillstand}
            className="w-zahl-klein"
          />
          <span className="w-auf w-label text-white/55" style={{ ['--verzug' as string]: '1500ms' }}>
            {oberste.einheit}
          </span>
        </div>

        <Satz verzug={1750} className="text-white/85">
          {text.setup}
        </Satz>

        {weitere.length > 0 ? (
          <ul className="space-y-1.5 pt-2">
            {weitere.slice(0, 3).map((kanal, index) => (
              <li
                key={kanal.channelId}
                className="w-auf flex items-center justify-between gap-4 text-sm text-white/40"
                style={{ ['--verzug' as string]: `${2000 + index * 130}ms` }}
              >
                <span className="min-w-0 truncate">{kanal.name ?? 'Unbekannt'}</span>
                <span className="shrink-0 tabular-nums">{kurzeDauer(kanal.seconds)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </SzenenRahmen>
  );
}

/**
 * Die Voice Mates.
 *
 * ## Die Idee
 *
 * Die eigene Person in der Mitte, die anderen darum - verbunden durch
 * Faeden, die sich zeichnen. Naehe und Groesse folgen der gemeinsamen Zeit,
 * aber nur grob: die Abstufung ist bewusst flach.
 *
 * ## Datenschutz
 *
 * Es steht keine Zeitangabe an den anderen Personen. Wer wie lange mit wem
 * zusammensass, ist eine Auskunft ueber Leute, die diesen Rueckblick nicht
 * angefordert haben - die Reihenfolge und die Naehe genuegen fuer die
 * Aussage «ihr wart viel zusammen unterwegs».
 *
 * ## Der Uebergang
 *
 * Die Punkte kommen aus der Mitte - dort, wo in der Szene davor die Zahl
 * stand. Das ist kein zufaelliges Auffliegen, sondern die Fortsetzung
 * derselben Bewegung.
 */
export function VoiceMatesSzene({ daten }: SzenenProps): React.JSX.Element {
  const mates = daten.voice.mates.slice(0, 6);
  const text = matesText(mates.length);
  const name = daten.person.displayName ?? daten.person.username ?? 'Du';
  const spitze = Math.max(1, ...mates.map((mate) => mate.sharedSecondsRounded));

  return (
    <SzenenRahmen>
      <div className="space-y-8">
        <Satz verzug={120}>{text.setup}</Satz>

        <div className="relative mx-auto aspect-square w-full max-w-[21rem]">
          {/* Die Verbindungen - sie zeichnen sich von innen nach aussen. */}
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
            {mates.map((mate, index) => {
              const anteil = mate.sharedSecondsRounded / spitze;
              const { x, y } = platz(index, mates.length, anteil);
              /*
               * Die Linie beginnt am Rand des eigenen Bildes und endet am
               * Rand des anderen - nicht in den Mittelpunkten.
               *
               * In der ersten Fassung liefen alle Linien durch die Mitte
               * hindurch und kreuzten sich dort: das sah nach Spinnennetz
               * aus und legte einen roten Stern ueber das eigene Bild.
               */
              const strecke = Math.hypot(x - 100, y - 100);
              // Die Radien in Koordinaten des Sichtfelds: das eigene Bild ist
              // 64 von 336 Pixeln breit, also rund 19 von 200 Einheiten im
              // Radius. Drei Einheiten Luft, damit die Linie nicht am Rand
              // klebt.
              const innen = 22 / strecke;
              const aussen = 1 - (13 + anteil * 6) / strecke;
              return (
                <line
                  key={mate.discordId}
                  className="wrapped-faden"
                  style={{
                    ['--faden-laenge' as string]: '120',
                    ['--faden-verzug' as string]: `${500 + index * 120}ms`,
                  }}
                  x1={100 + (x - 100) * innen}
                  y1={100 + (y - 100) * innen}
                  x2={100 + (x - 100) * aussen}
                  y2={100 + (y - 100) * aussen}
                  stroke="hsl(var(--w-rot-hell))"
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Die anderen - Groesse nach gemeinsamer Zeit, aber flach abgestuft. */}
          {mates.map((mate, index) => {
            const anteil = mate.sharedSecondsRounded / spitze;
            const { x, y } = platz(index, mates.length, anteil);
            const groesse = 30 + anteil * 14;
            return (
              /*
               * Zwei Ebenen, und beide werden gebraucht.
               *
               * Aussen sitzt die Position: (x, y) ist die Mitte des Bildes,
               * und `-translate-*-1/2` schiebt das Kaestchen darauf. Innen
               * sitzt der Auftritt. Beides an einem Element ging nicht - die
               * Animation endet auf `transform: none` und hat die
               * Verschiebung damit wieder aufgehoben; die Bilder sassen um
               * einen halben Durchmesser daneben, und die Linien endeten
               * sichtbar im Leeren.
               *
               * Der Name haengt absolut unter dem Bild, damit er die Mitte
               * des Kaestchens nicht nach oben zieht.
               */
              <div
                key={mate.discordId}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${(x / 200) * 100}%`, top: `${(y / 200) * 100}%` }}
              >
                <div
                  className="w-punkt relative"
                  style={{
                    // Sie kommen aus der Mitte - dort stand eben noch die Zahl.
                    ['--von-x' as string]: `${(100 - x) * 0.8}px`,
                    ['--von-y' as string]: `${(100 - y) * 0.8}px`,
                    ['--verzug' as string]: `${700 + index * 120}ms`,
                  }}
                >
                  <WrappedAvatar
                    discordId={mate.discordId}
                    avatarHash={mate.avatarHash}
                    name={mate.displayName ?? mate.username ?? '?'}
                    groesse={groesse}
                    className="ring-2 ring-white/15"
                  />
                  <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 truncate text-center text-[0.65rem] text-white/50 [max-width:5.5rem]">
                    {mate.displayName ?? mate.username ?? '—'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Die eigene Person - in der Mitte, groesser, mit rotem Ring. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <WrappedAvatar
              discordId={daten.person.discordId}
              avatarHash={daten.person.avatarHash}
              name={name}
              groesse={64}
              className="w-einrasten ring-[3px] ring-[hsl(var(--w-rot-hell))]"
            />
          </div>
        </div>

        <Nachsatz verzug={1600}>
          {mates.length === 1
            ? 'Eine Person war besonders oft dabei.'
            : `${mates.length} Leute waren besonders oft mit dir im Kanal.`}
        </Nachsatz>
      </div>
    </SzenenRahmen>
  );
}

/**
 * Wo jemand auf dem Kreis sitzt.
 *
 * Oben beginnend und im Uhrzeigersinn. Der Radius folgt der gemeinsamen
 * Zeit, aber nur zwischen 62 und 84 von 100 - die Naehe soll ablesbar sein
 * und trotzdem darf niemand am Rand verschwinden.
 */
/**
 * Runden, weil Node und Browser anders rechnen.
 *
 * `Math.cos` liefert auf dem Server und im Browser Ergebnisse, die sich in
 * der letzten Stelle unterscheiden. React vergleicht die Zeichenketten und
 * meldet dann eine Abweichung beim Hydrieren. Drei Nachkommastellen sind
 * fuer eine SVG-Koordinate in einem 200er-Raster mehr als genug.
 */
const gerundet = (wert: number): number => Number(wert.toFixed(3));

function platz(index: number, gesamt: number, anteil: number): { x: number; y: number } {
  const winkel = (index / Math.max(1, gesamt)) * Math.PI * 2 - Math.PI / 2;
  /*
   * Der Radius schwankt nur wenig.
   *
   * Die erste Fassung liess ihn zwischen 62 und 84 wandern - die engste
   * Person rueckte damit so nah, dass ihr Name den Ring in der Mitte
   * beruehrte. Naehe soll ablesbar sein, aber niemand darf dem Zentrum auf
   * die Pelle ruecken.
   */
  const radius = 82 - anteil * 9;
  return { x: gerundet(100 + Math.cos(winkel) * radius), y: gerundet(100 + Math.sin(winkel) * radius) };
}

/**
 * Die Prime Time.
 *
 * ## Die Idee
 *
 * Eine Uhr, deren Zeiger einmal durch den Tag laeuft und stehenbleibt. Der
 * Kreis ist dabei kein Zifferblatt, sondern die Stundenverteilung selbst:
 * 24 Striche, deren Laenge zeigt, wann diese Person da war. Der Zeiger
 * bleibt auf dem laengsten stehen.
 *
 * Das ist der Uebergang `morph`: aus der Wellenform der Voice-Szene wird
 * derselbe Datensatz, nur im Kreis gelegt.
 */
export function PrimeTimeSzene({ daten, stillstand }: SzenenProps): React.JSX.Element {
  const prime = primeTime(daten);
  if (!prime) {
    return <SzenenRahmen>{null}</SzenenRahmen>;
  }
  const spitze = Math.max(1, ...daten.voice.hours);
  // 24 Stunden auf 360 Grad, und der Zeiger zeigt auf die Mitte der Stunde.
  const winkel = ((prime.stunde + 0.5) / 24) * 360 - 90;

  return (
    <SzenenRahmen>
      <div className="space-y-8">
        <Satz verzug={120}>{prime.text.setup}</Satz>

        <div className="relative mx-auto aspect-square w-full max-w-[17rem]">
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
            {daten.voice.hours.map((wert, stunde) => {
              const grad = (stunde / 24) * 360 - 90;
              const bogen = (grad * Math.PI) / 180;
              const innen = 62;
              const aussen = innen + 8 + (wert / spitze) * 28;
              return (
                <line
                  key={stunde}
                  x1={gerundet(100 + Math.cos(bogen) * innen)}
                  y1={gerundet(100 + Math.sin(bogen) * innen)}
                  x2={gerundet(100 + Math.cos(bogen) * aussen)}
                  y2={gerundet(100 + Math.sin(bogen) * aussen)}
                  stroke="hsl(var(--w-rot-hell))"
                  strokeOpacity={gerundet(0.25 + (wert / spitze) * 0.7)}
                  strokeWidth={4}
                  strokeLinecap="round"
                  className="w-auf"
                  style={{ ['--verzug' as string]: `${300 + stunde * 30}ms` }}
                />
              );
            })}
            <circle cx={100} cy={100} r={54} fill="none" stroke="white" strokeOpacity={0.08} />
          </svg>

          {/* Der Zeiger. */}
          <div
            className="w-zeiger absolute inset-0"
            style={{
              ['--ziel-winkel' as string]: `${winkel}deg`,
              ['--verzug' as string]: stillstand ? '0ms' : '900ms',
            }}
          >
            {/* Nur das aeussere Stueck ist sichtbar: ein Zeiger, der quer
                durch die Uhrzeit in der Mitte laeuft, macht sie unleserlich. */}
            <span className="absolute left-1/2 top-1/2 h-[2px] w-[56%] origin-left rounded-full bg-[linear-gradient(to_right,transparent_0,transparent_62%,white_62%,white_100%)]" />
          </div>

          <div className="absolute inset-0 grid place-items-center">
            <span
              className="w-einrasten text-[clamp(2rem,11vw,3.25rem)] font-extrabold tabular-nums tracking-tight"
              style={{ ['--verzug' as string]: '2400ms' }}
            >
              {String(prime.stunde).padStart(2, '0')}
              <span className="text-white/40">:00</span>
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="w-auf w-label text-white/55" style={{ ['--verzug' as string]: '2700ms' }}>
            Deine Prime Time
          </p>
          {prime.text.pointe ? <Nachsatz verzug={2900}>{prime.text.pointe}</Nachsatz> : null}
        </div>
      </div>
    </SzenenRahmen>
  );
}
