/**
 * Der Levelstand als Ring.
 *
 * Die Zahl kommt aus dem bestehenden XP-System und wird hier nur gezeichnet -
 * kein Prozentwert, der im Browser noch einmal nachgerechnet wird.
 *
 * Der Ring laeuft beim Erscheinen einmal von leer auf den Stand. Bewegt wird
 * dabei genau eine `stroke-dashoffset`; die Zielwerte stehen als
 * CSS-Variablen, damit die Keyframes ohne erzeugtes Stylesheet auskommen.
 */
export function LevelRing({
  level,
  fortschritt,
  hoechstlevel,
  groesse = 96,
}: {
  level: number;
  /** 0 bis 1. */
  fortschritt: number;
  hoechstlevel: boolean;
  groesse?: number;
}): React.JSX.Element {
  const dicke = groesse <= 72 ? 5 : 7;
  const radius = (groesse - dicke) / 2;
  const umfang = 2 * Math.PI * radius;
  // Im Hoechstlevel ist der Ring voll - dort gibt es kein «noch 400 XP».
  const anteil = hoechstlevel ? 1 : Math.min(1, Math.max(0, fortschritt));

  return (
    <div
      className="relative shrink-0"
      style={{ width: groesse, height: groesse }}
      role="img"
      aria-label={
        hoechstlevel
          ? `Level ${level} - Höchstlevel erreicht`
          : `Level ${level}, ${Math.round(anteil * 100)} Prozent zum nächsten Level`
      }
    >
      <svg width={groesse} height={groesse} viewBox={`0 0 ${groesse} ${groesse}`} aria-hidden="true">
        <circle
          cx={groesse / 2}
          cy={groesse / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--foreground) / 0.12)"
          strokeWidth={dicke}
        />
        <circle
          cx={groesse / 2}
          cy={groesse / 2}
          r={radius}
          fill="none"
          stroke={hoechstlevel ? 'hsl(45 92% 58%)' : 'hsl(var(--profil-akzent, var(--primary-bright)))'}
          strokeWidth={dicke}
          strokeLinecap="round"
          strokeDasharray={umfang}
          strokeDashoffset={umfang * (1 - anteil)}
          className="pr-ring-lauf"
          style={
            {
              '--pr-ring-leer': `${umfang}`,
              transform: 'rotate(-90deg)',
              transformOrigin: '50% 50%',
            } as React.CSSProperties
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">Level</span>
        <span className="text-2xl font-bold leading-none tabular-nums">{level}</span>
      </div>
    </div>
  );
}
