'use client';

import { useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import type { SystemFeld } from '@/server/automation';
import { aendereSystemautomationAction } from '@/modules/automation/actions';
import { FeldZeile } from './feld-zeile';

/**
 * Die freigegebenen Felder einer Systemautomation.
 *
 * ## Warum nicht der Builder
 *
 * Weil an einer Systemautomation fast alles vorgegeben ist: Name, Ablauf,
 * Bedingungen und Text kommen aus der Vorlage und werden bei jedem Start
 * abgeglichen. Gäbe der Builder sie frei, liesse sich alles davon ändern -
 * und beim nächsten Deployment wäre es weg. Das wäre die verwirrendste Art,
 * eine Änderung zu verlieren.
 *
 * Also zeigt diese Karte genau die Felder, die bleiben: die Werte, die nur
 * der Server kennt. Der Builder bleibt daneben stehen und zeigt den Ablauf -
 * lesbar, aber gesperrt. Eine Automation, deren Inhalt man nicht ansehen
 * kann, würde niemand einschalten.
 *
 * ## Warum dieselben Eingabefelder
 *
 * `FeldZeile` ist die Zeile, die auch der Builder benutzt - mit derselben
 * Rollen- und Kanalauswahl wie die Moduleinstellungen. Eine zweite
 * Rollenauswahl zu bauen hiesse, zwei zu pflegen.
 */

export function Systemfelder({
  csrfToken,
  automationId,
  felder,
  roles,
  channels,
  darfSpeichern,
}: {
  csrfToken: string;
  automationId: string;
  felder: SystemFeld[];
  roles: RoleOption[];
  channels: ChannelOption[];
  darfSpeichern: boolean;
}): React.JSX.Element {
  const [werte, setWerte] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(felder.map((eintrag) => [eintrag.pfad, eintrag.wert])),
  );
  const [pending, setPending] = useState(false);

  const speichern = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await aendereSystemautomationAction({ csrfToken, id: automationId, werte });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      toast.success('Gespeichert.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title="Für diesen Server ausfüllen" description="Bleibt auch nach einem Update stehen.">
      <div className="space-y-4">
        {felder.map((eintrag) => (
          <FeldZeile
            key={eintrag.pfad}
            feld={eintrag.feld}
            wert={werte[eintrag.pfad]}
            onChange={(naechster): void => setWerte((vorher) => ({ ...vorher, [eintrag.pfad]: naechster }))}
            roles={roles}
            channels={channels}
            disabled={!darfSpeichern || pending}
          />
        ))}

        {darfSpeichern ? (
          <Button onClick={(): void => void speichern()} disabled={pending} className="w-full sm:w-auto">
            <Save className="size-4" aria-hidden="true" />
            {pending ? 'Speichert …' : 'Speichern'}
          </Button>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Zum Ändern fehlt dir die Berechtigung.
          </p>
        )}
      </div>
    </Panel>
  );
}
