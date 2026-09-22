import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { listPermissions, resolvePermissions } from '@swisshub/permissions';

/**
 * «Ansicht als …» - die Vorschau.
 *
 * Sie beantwortet eine Frage: *Wie sähe das Dashboard für diese Person oder
 * diese Rolle aus?* Sie ist **keine** Identitätsübernahme - und der ganze
 * Unterschied steckt in drei Eigenschaften, die hier geprüft werden:
 *
 * 1. Sie kann nur **wegnehmen**, nie hinzufügen. Eine gefälschte Kennung im
 *    Cookie bringt deshalb nichts.
 * 2. Der echte Handelnde bleibt sichtbar - in `context.user` und im Audit Log.
 * 3. Gehandelt wird während einer Vorschau überhaupt nicht.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

const MAPPINGS = [
  { discordRoleId: 'admin', permission: 'admin.full', effect: 'ALLOW' as const },
  { discordRoleId: 'mod', permission: 'moderation.view', effect: 'ALLOW' as const },
  { discordRoleId: 'mod', permission: 'jail.view', effect: 'ALLOW' as const },
  { discordRoleId: 'premium', permission: 'level.card.custom', effect: 'ALLOW' as const },
];

function kontext(eigene: string[], vorschauRollen?: string[]): AuthContext {
  const echt = resolvePermissions({ discordId: '1', roleIds: eigene, isOwner: false }, MAPPINGS);
  const basis = {
    user: {
      id: 'u1',
      discordId: '1',
      username: 'admin',
      globalName: null,
      displayName: 'Admin',
      avatarHash: null,
      appRole: 'ADMIN' as const,
      isOwner: false,
    },
    sessionId: 's1',
    identity: { discordId: '1', isMember: true, roleIds: eigene } as AuthContext['identity'],
    isMember: true,
    moderationLevel: 0,
    roleIds: eigene,
  };

  if (!vorschauRollen) {
    return { ...basis, permissions: echt, permissionKeys: [] } as AuthContext;
  }

  const vorschau = resolvePermissions({ discordId: '2', roleIds: vorschauRollen, isOwner: false }, MAPPINGS);
  return {
    ...basis,
    permissions: vorschau,
    realPermissions: echt,
    preview: {
      kind: 'ROLE',
      subjectId: '900000000000000001',
      label: 'Premium',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  } as AuthContext;
}

describe('Die Vorschau kann nur wegnehmen', () => {
  it('blendet aus, was die Vorschau-Person nicht sähe', () => {
    const admin = kontext(['admin']);
    expect(can(admin, 'moderation.view')).toBe(true);

    const alsPremium = kontext(['admin'], ['premium']);
    expect(can(alsPremium, 'moderation.view')).toBe(false);
    expect(can(alsPremium, 'level.card.custom')).toBe(true);
  });

  it('gibt nichts dazu, was der Betrachter selbst nicht darf', () => {
    // Der gefährliche Fall: ein Moderator wählt «Ansicht als Admin». Sähe er
    // dann die Admin-Oberfläche, wäre die Vorschau eine Rechteausweitung.
    const modAlsAdmin = kontext(['mod'], ['admin']);
    expect(can(modAlsAdmin, 'admin.full')).toBe(false);
    expect(can(modAlsAdmin, 'settings.edit')).toBe(false);
    // Was er ohnehin darf und die Vorschau-Rolle auch, bleibt.
    expect(can(modAlsAdmin, 'moderation.view')).toBe(true);
  });

  it('macht eine gefälschte Vorschau-Kennung wirkungslos', () => {
    // Auch wenn jemand das Cookie auf die stärkste Rolle des Servers setzte:
    // die Schnittmenge bleibt seine eigene Menge.
    const gewoehnlichAlsAdmin = kontext(['premium'], ['admin']);
    for (const recht of ['admin.full', 'moderation.view', 'jail.view', 'settings.edit']) {
      expect(can(gewoehnlichAlsAdmin, recht), recht).toBe(false);
    }
  });

  it('ist ohne Vorschau die gewöhnliche Prüfung', () => {
    const mod = kontext(['mod']);
    expect(can(mod, 'jail.view')).toBe(true);
    expect(can(mod, 'admin.full')).toBe(false);
    expect(mod.realPermissions).toBeUndefined();
  });

  it('lässt ein Nicht-Mitglied auch in der Vorschau nichts sehen', () => {
    const draussen = { ...kontext(['admin'], ['admin']), isMember: false };
    expect(can(draussen, 'moderation.view')).toBe(false);
  });
});

describe('Serverseitig zählt der echte Handelnde', () => {
  it('prüft Aktionen gegen die echten Rechte, nicht gegen die Vorschau', () => {
    // Sonst hinge die Autorisierung des Servers an einem Cookie, das der
    // Browser schickt.
    expect(lies('packages/auth/src/context.ts')).toContain(
      'hasPermission(context.realPermissions ?? context.permissions, permission)',
    );
  });

  it('verlangt in der Oberfläche beide Seiten', () => {
    const quelle = lies('packages/auth/src/context.ts');
    expect(quelle).toContain('if (!hasPermission(context.permissions, permission))');
    expect(quelle).toContain(
      'return context.realPermissions ? hasPermission(context.realPermissions, permission) : true;',
    );
  });

  it('übernimmt keine fremde Identität', () => {
    // `context.user` bleibt die angemeldete Person - es gibt keine Stelle,
    // an der sie überschrieben würde.
    const quelle = lies('apps/web/src/server/preview.ts');
    // Der ergaenzte Kontext uebernimmt alles Bestehende und setzt nur die
    // Permissions neu - `user` und `sessionId` bleiben unberuehrt.
    expect(quelle).toContain('...context,');
    expect(quelle).not.toContain('user: {');
    expect(quelle).not.toContain('sessionId:');
    expect(quelle).toContain('realPermissions: context.permissions');
  });
});

describe('Vorschau ist nur zum Ansehen', () => {
  const action = lies('apps/web/src/server/action.ts');

  it('sperrt jede Aktion, nicht eine Liste ausgewählter', () => {
    // Eine Liste der schreibenden Aktionen zu pflegen hiesse, sie beim
    // nächsten neuen Knopf zu vergessen.
    expect(action).toContain('if (context.preview && !definition.allowDuringPreview)');
  });

  it('sperrt, bevor irgendetwas geprüft oder ausgeführt wird', () => {
    const sperre = action.indexOf('context.preview && !definition.allowDuringPreview');
    const handler = action.indexOf('const result = await handler(');
    expect(sperre).toBeGreaterThan(0);
    expect(handler).toBeGreaterThan(sperre);
  });

  it('hält jeden Versuch als Sicherheitsereignis fest', () => {
    const abschnitt = action.slice(action.indexOf('context.preview && !definition.allowDuringPreview'));
    expect(abschnitt.slice(0, 600)).toContain('recordSecurityEvent');
  });

  it('lässt genau zwei Aktionen durch: starten und beenden', () => {
    const quellen = [
      'apps/web/src/modules/preview/actions.ts',
      'apps/web/src/modules/notifications/actions.ts',
      'apps/web/src/modules/jail/actions.ts',
      'apps/web/src/modules/level/actions.ts',
    ];
    let gefunden = 0;
    for (const quelle of quellen) {
      gefunden += (lies(quelle).match(/allowDuringPreview:\s*true/gu) ?? []).length;
    }
    expect(gefunden).toBe(2);
  });

  it('lässt das Beenden nie an einer Berechtigung scheitern', () => {
    // Sonst käme man aus einer Vorschau nur noch über das Löschen eines
    // Cookies heraus - etwa nach einem Rechteentzug mitten in der Vorschau.
    const quelle = lies('apps/web/src/modules/preview/actions.ts');
    const stopp = quelle.slice(quelle.indexOf("name: 'preview.stop'"));
    expect(stopp.slice(0, 400)).not.toContain('permission:');
  });
});

describe('Das Cookie lässt sich nicht fälschen und nicht verlängern', () => {
  const quelle = lies('apps/web/src/server/preview.ts');

  it('ist signiert', () => {
    expect(quelle).toContain('hmacSha256(env.AUTH_SECRET, `preview:${roh}`)');
    expect(quelle).toContain('safeEqual(');
  });

  it('trägt den Ablauf innerhalb der Signatur', () => {
    // Stünde er nur am Cookie, liesse er sich im Browser verlängern.
    expect(quelle).toContain('expiresAt: number');
    expect(quelle).toContain('nutzlast.expiresAt <= Date.now()');
  });

  it('ist kurzlebig', () => {
    // Kein Zustand, in dem ein Admin am nächsten Tag unbemerkt weiter in
    // einer Vorschau sässe.
    expect(quelle).toContain('export const PREVIEW_TTL_MS = 30 * 60 * 1000');
  });

  it('prüft die Gestalt der Kennung', () => {
    expect(quelle).toContain('/^\\d{17,20}$/u.test(nutzlast.subjectId)');
  });

  it('ist nicht aus dem Browser lesbar', () => {
    expect(quelle).toContain('httpOnly: true');
    expect(quelle).toContain("sameSite: 'lax'");
  });

  it('wird ohne die Berechtigung ignoriert', () => {
    // Ein technisch gültiges Cookie nach einem Rechteentzug ist keine
    // laufende Vorschau mehr.
    expect(quelle).toContain('hasPermission(context.permissions, PREVIEW_PERMISSIONS.use)');
  });
});

describe('Die Vorschau rechnet nicht selbst', () => {
  it('benutzt die bestehende Permission Engine', () => {
    const quelle = lies('apps/web/src/server/preview.ts');
    expect(quelle).toContain('resolvePermissions(');
    expect(quelle).toContain('loadRoleConfiguration()');
    // Keine zweite Rechteberechnung: keine eigene Wildcard-Logik, kein
    // eigener Umgang mit Ausnahmen.
    expect(quelle).not.toContain('admin.full');
    expect(quelle).not.toContain("'DENY'");
  });

  it('nimmt die Rollen der Person aus dem bestehenden Zwischenspeicher', () => {
    expect(lies('apps/web/src/server/preview.ts')).toContain('prisma.discordIdentityCache');
  });
});

describe('Der Admin kann nicht vergessen, dass eine Vorschau läuft', () => {
  it('trägt einen Banner über der gesamten Oberfläche', () => {
    const shell = lies('apps/web/src/components/layout/app-shell.tsx');
    expect(shell).toContain('<PreviewBanner');
    // Über dem Grundgerüst, nicht in einer Seite - er gehört zum Zustand der
    // Sitzung, nicht zum Inhalt.
    expect(shell.indexOf('<PreviewBanner')).toBeLessThan(shell.indexOf('<div className="flex min-h-dvh">'));
  });

  it('bietet das Beenden im Banner an', () => {
    expect(lies('apps/web/src/modules/preview/components/preview-banner.tsx')).toContain('Vorschau beenden');
  });

  it('kennzeichnet eine Rollenvorschau als solche', () => {
    // Was eine Rolle erlaubt, ist nicht dasselbe wie das, was eine konkrete
    // Person mit dieser Rolle sieht - sie trägt meist noch andere.
    expect(lies('apps/web/src/modules/preview/components/preview-banner.tsx')).toContain(
      'Rollenvorschau aktiv',
    );
  });

  it('zeigt statt einer 403-Seite, dass die Seite für diese Person unsichtbar wäre', () => {
    expect(lies('apps/web/src/server/auth.ts')).toContain('redirect(`/vorschau/gesperrt?permission=');
    expect(lies('apps/web/src/app/(app)/vorschau/gesperrt/page.tsx')).toContain(
      'wäre für {context.preview.label} nicht sichtbar',
    );
  });
});

describe('Die Glocke bleibt in der Vorschau stumm', () => {
  it('lädt die Benachrichtigungen gar nicht erst', () => {
    // Weder die der Vorschau-Person - das wäre ihr Posteingang - noch die
    // eigenen: die Vorschau behauptete dann etwas, das die Person nie sähe.
    expect(lies('apps/web/src/app/(app)/layout.tsx')).toContain(
      'context.preview\n    ? { eintraege: [], ungelesen: 0 }',
    );
  });

  it('sagt an der Glocke, warum sie stumm ist', () => {
    expect(lies('apps/web/src/components/layout/notification-bell.tsx')).toContain(
      'Persönliche Benachrichtigungen werden in der Vorschau nicht angezeigt.',
    );
  });
});

describe('Start und Ende stehen im Audit Log', () => {
  const quelle = lies('apps/web/src/modules/preview/actions.ts');

  it('hält beide Enden fest', () => {
    expect(quelle).toContain('AUDIT_ACTIONS.PREVIEW_STARTED');
    expect(quelle).toContain('AUDIT_ACTIONS.PREVIEW_ENDED');
  });

  it('nennt den echten Handelnden, nicht die Vorschau-Person', () => {
    expect(quelle).toContain('actorDiscordId: ctx.user.discordId');
    expect(quelle).toContain('actorUsername: ctx.user.username');
  });

  it('hält keine Inhalte fest, die der Admin dabei gesehen hat', () => {
    // Das wären fremde Daten in einem Protokoll, das niemand darum gebeten
    // hat. Festgehalten wird, wer worauf und wie lange geschaut hat.
    expect(quelle).toContain('metadata: { kind: input.kind, subjectId: input.subjectId');
  });
});

describe('Die Berechtigungen sind angemeldet und granular', () => {
  it('trennt «überhaupt», «Person» und «Rolle»', () => {
    const schluessel = listPermissions().map((recht) => recht.key);
    for (const recht of ['preview.use', 'preview.user', 'preview.role']) {
      expect(schluessel, recht).toContain(recht);
    }
  });

  it('kennzeichnet sie als kritisch', () => {
    for (const recht of ['preview.use', 'preview.user', 'preview.role']) {
      expect(listPermissions().find((eintrag) => eintrag.key === recht)?.critical, recht).toBe(true);
    }
  });

  it('hängt an keiner festen Discord-Rollen-ID', () => {
    expect(lies('apps/web/src/server/preview.ts')).not.toMatch(/\d{17,20}/u);
  });
});
