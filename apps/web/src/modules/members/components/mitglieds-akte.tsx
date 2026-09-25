import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bot, ExternalLink, Lock, Pencil, ShieldAlert, ShieldOff, UserX } from 'lucide-react';
import { can } from '@swisshub/auth';
import {
  clips,
  getModuleSettings,
  isModuleEnabled,
  jail,
  level,
  members,
  moderation,
  profile,
  verification,
} from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import { formatDate, formatDateTime, snowflakeSchema, systemRoutes } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { CommunityProfil } from './community-profil';
import { ProfilAvatar } from '@/modules/members/components/profil-avatar';
import { KopierKnopf } from '@/modules/members/components/kopier-knopf';
import { RoleBadge } from '@/components/shared/role-badge';
import { EmptyState } from '@/components/shared/states';
import { CreateJailDialog } from '@/modules/jail/components/create-jail-dialog';
import { ModerationDialog } from '@/modules/moderation/components/moderation-dialog';
import { ActionTypeBadge } from '@/modules/moderation/components/action-type-badge';
import { SourceBadge } from '@/modules/moderation/components/source-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { ReleaseJailButton } from '@/modules/jail/components/release-jail-button';
import { NotesPanel } from '@/modules/members/components/notes-panel';
import { ProfilFreigebenKnopf, TeilenKnopf } from '@/modules/profile/components/teilen-knopf';
import { RoleManager } from '@/modules/members/components/role-manager';
import { XpPanel } from '@/modules/members/components/xp-panel';
import { ClipBilanzBlock } from '@/modules/clips/components/clip-bilanz';
import { CustomCardPanel } from '@/modules/level/components/custom-card-panel';
import { KartenfarbeWaehler } from '@/modules/level/components/kartenfarbe-waehler';
import { RemoveCustomCardButton } from '@/modules/level/components/remove-custom-card-button';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { memberViewer } from '@/server/members';
import { alleReasonTemplates, moderationAbilities, moderationReasonTemplates } from '@/server/moderation';
import { cn } from '@/lib/utils';

/**
 * Die Mitgliederakte.
 *
 * Eine Darstellung, zwei Wege hinein: `/members/<id>` fuer die Akte eines
 * anderen und `/profile` fuer die eigene. Beide rendern diese Komponente.
 *
 * Warum nicht zwei Seiten? Weil dann an zwei Stellen stuende, wer welchen
 * Abschnitt sehen darf - und irgendwann stuende an einer davon etwas anderes.
 * Warum dann ueberhaupt zwei Routen? Weil «Mein Profil» eine eigene Adresse
 * braucht: die Seitenleiste markiert den aktiven Eintrag am Pfad, und eine
 * Weiterleitung auf `/members/<eigene-id>` markierte «Mitglieder» - einen
 * Eintrag, den ein gewoehnliches Mitglied gar nicht hat.
 *
 * Die Komponente entscheidet nichts. Sie zeigt, was der Aggregator geliefert
 * hat - und der liefert nur, was der Betrachter sehen darf. Ein Abschnitt, der
 * hier fehlt, fehlt schon in der Antwort: es gibt nichts zu verstecken, weil
 * nichts geladen wurde.
 */

/** Die Reiter, in der Reihenfolge, in der sie erscheinen. */
const REITER = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'aktivitaet', label: 'Aktivität', section: 'activity' },
  { id: 'level', label: 'Level', section: 'level' },
  { id: 'turniere', label: 'Turniere', section: 'tournaments' },
  { id: 'tickets', label: 'Tickets', section: 'tickets' },
  { id: 'premium', label: 'Premium', section: 'premium' },
  { id: 'rollen', label: 'Rollen', section: 'roles' },
  { id: 'moderation', label: 'Moderation', section: 'moderation' },
  { id: 'appeals', label: 'Entbannungsanträge', section: 'appeals' },
  { id: 'notizen', label: 'Notizen', section: 'notes' },
  /*
   * Das Community-Profil - was ein Mitglied ueber sich erzaehlt.
   *
   * Ohne `section`: die uebrigen Reiter haengen an den Sichtbarkeiten des
   * Member Center, dieser an zwei Verwaltungsberechtigungen. Er wird
   * deshalb unten gesondert gefiltert.
   */
  { id: 'community', label: 'Community-Profil' },
] as const;

/**
 * Reiter, die im eigenen Profil nicht erscheinen.
 *
 * «Mein Profil» ist die Selbstauskunft - was jemand ueber sich selbst
 * nachschlaegt. Die eigenen Turnierteilnahmen und Discord-Rollen
 * stehen jeweils dort, wo man sie auch bearbeitet, und in Discord ohnehin; als
 * Reiter im eigenen Profil waren sie eine dritte Darstellung derselben Sache.
 *
 * In der Akte eines *anderen* Mitglieds bleiben sie: dort beantworten sie eine
 * Frage, die man sonst nirgends stellen kann.
 */
const NICHT_IM_EIGENEN_PROFIL: ReadonlySet<string> = new Set(['tournaments', 'roles']);

export async function MitgliedsAkte({
  discordId,
  tab,
  /**
   * Der Pfad, auf dem die Reiter verlinken.
   *
   * Ohne ihn zeigten die Reiter im eigenen Profil auf `/members/<id>` - der
   * erste Klick verliesse «Mein Profil», und die Seitenleiste sprang auf
   * «Mitglieder».
   */
  basisPfad,
  von,
}: {
  discordId: string;
  tab?: string;
  basisPfad: string;
  /**
   * Der Kontext, aus dem die Akte geöffnet wurde.
   *
   * Er hängt an jedem Reiter-Link: sonst verlöre ein Klick auf «Verlauf» den
   * Weg zurück in die gefilterte Liste, aus der man kam.
   */
  von?: string;
}): Promise<React.JSX.Element> {
  // Bewusst nicht `requirePagePermission('members.view')`: wer nur sein
  // eigenes Profil sehen darf, braucht die Mitgliedersuche nicht. Wer gar
  // nichts sehen darf, bekommt unten dieselbe Antwort wie bei einem
  // unbekannten Mitglied.
  const context = await requireMember();
  const parsed = snowflakeSchema.safeParse(discordId);
  if (!parsed.success) {
    notFound();
  }

  const viewer = memberViewer(context);
  const profil = await members.getMemberCenterProfile({
    viewer,
    targetDiscordId: parsed.data,
  });
  if (!profil) {
    notFound();
  }

  const { basic, capabilities } = profil;
  const sichtbar = new Set(profil.sichtbar);
  const fehler = new Set(profil.fehler.map((eintrag) => eintrag.section));
  const gewaehlt = tab ?? 'uebersicht';

  /**
   * Der Ausgang der Verifikation - nur fuer Staff mit der Berechtigung.
   *
   * Bewusst nur Ergebnis und Methode, nie die Nachricht: die faellt unter die
   * Aufbewahrungsfrist des Verifikationsmoduls und ist hier nicht noetig.
   */
  const verifikation =
    can(context, verification.VERIFICATION_PERMISSIONS.historyView) &&
    (await isModuleEnabled(verification.VERIFICATION_MODULE_ID))
      ? await verification.verificationFuerMitglied(parsed.data).catch(() => null)
      : null;

  /*
   * Clip of the Week im Profil.
   *
   * Sichtbar fuer jeden, der die Akte sieht - die Ergebnisse stehen ohnehin
   * oeffentlich in der Hall of Fame. Ist das Modul aus, steht hier nichts;
   * ein leerer Block «0 Siege» waere eine Auskunft ueber ein Feature, das es
   * auf diesem Server nicht gibt.
   */
  const clipBilanz =
    can(context, clips.CLIPS_PERMISSIONS.view) && (await isModuleEnabled(clips.CLIPS_MODULE_ID))
      ? await clips.bilanz(await resolveGuildId(), parsed.data).catch(() => null)
      : null;

  const selbst = basic.discordId === context.user.discordId;
  const darfProfilBearbeiten = can(context, members.MEMBER_PERMISSIONS.profileEdit);
  const darfAuszeichnungen = can(context, members.MEMBER_PERMISSIONS.awardsManage);
  // Zwei verschiedene Handlungen: verleihen (oben) und festlegen, welche es
  // ueberhaupt gibt. Die zweite fuehrt nur zu einem Hinweis mit Link -
  // verwaltet wird dort, nicht hier.
  const darfArtenVerwalten = can(context, members.MEMBER_PERMISSIONS.awardsDefine);

  const reiter = REITER.filter((eintrag) => {
    if (eintrag.id === 'community') {
      /*
       * Nicht im eigenen Profil: dort ist «Mein Profil» der Ort dafuer, mit
       * dem vollen Editor. Ein zweiter, kleinerer Editor daneben waere eine
       * zweite Stelle fuer dieselben Felder.
       */
      return !selbst && (darfProfilBearbeiten || darfAuszeichnungen);
    }
    if (!('section' in eintrag)) {
      return true;
    }
    if (selbst && NICHT_IM_EIGENEN_PROFIL.has(eintrag.section)) {
      return false;
    }
    return sichtbar.has(eintrag.section);
  });
  // Ein Reiter, den es nicht mehr gibt, faellt auf die Uebersicht zurueck -
  // auch wenn jemand `?tab=rollen` von Hand eintraegt. Sonst stuende die
  // Seite mit leerem Inhalt da und saehe kaputt aus.
  const aktiv = reiter.some((eintrag) => eintrag.id === gewaehlt) ? gewaehlt : 'uebersicht';

  const csrfToken = csrfTokenFor(context);
  const [jailSettings, jailEnabled, grundVorlagen, alleVorlagen] = await Promise.all([
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    isModuleEnabled(jail.JAIL_MODULE_ID),
    moderationReasonTemplates('JAIL'),
    alleReasonTemplates(),
  ]);
  const canJail = capabilities.canJail && jailEnabled;
  // Am eigenen Profil gibt es nichts zu moderieren - der Dienst lehnt es ohnehin
  // ab, und eine Schaltflaeche, die immer scheitert, ist keine Schaltflaeche.
  const massnahmen = selbst ? null : moderationAbilities(context);
  const darfEigeneKarte = can(context, level.LEVEL_PERMISSIONS.cardCustom);
  /*
   * Die Akzentfarbe des Servers - nur fuer die Vorschau der eigenen Karte.
   *
   * Die Vorschau soll den Hintergrund zeigen, den die Karte tatsaechlich
   * bekommt, und der kommt aus den Moduleinstellungen. Geladen wird sie
   * deshalb nur dort, wo der Waehler ueberhaupt erscheint.
   */
  const kartenAkzent = selbst && darfEigeneKarte ? (await level.readLevelSettings()).accentColor : null;

  /*
   * Der eigene oeffentliche Schluessel - oder `null`.
   *
   * `slugVon` gibt ihn nur heraus, wenn das Profil tatsaechlich oeffentlich
   * steht; ein Slug allein genuegt nicht. Daraus ergibt sich oben die
   * Entscheidung zwischen «Teilen» und «Freigeben», ohne dass diese
   * Komponente die Sichtbarkeitsregel ein zweites Mal kennt.
   *
   * Nur im eigenen Profil geladen - in einer fremden Akte fuehrt der Weg
   * zum oeffentlichen Profil ueber den Reiter «Community-Profil».
   */
  const eigenerSlug = selbst ? await profile.slugVon(basic.discordId).catch(() => null) : null;

  /*
   * Der Sperrzustand des oeffentlichen Profils.
   *
   * Fuer Staff, damit die Massnahme nicht unsichtbar wirkt - und fuer die
   * betroffene Person selbst, damit sie nicht raetselt, warum ihr geteilter
   * Link ins Leere fuehrt. **Der Grund steht nur bei Staff**: er ist eine
   * interne Angabe und beantwortet eine Frage der Moderation, nicht des
   * Mitglieds.
   */
  const darfSperrenSehen = can(context, moderation.MODERATION_PERMISSIONS.historyView);
  const sperre =
    selbst || darfSperrenSehen ? await moderation.profilSperrStand(basic.discordId) : null;

  // Die Rollenliste braucht Discord und ist nur fuer die Verwaltung da.
  const rollenAngebot = capabilities.canManageRoles
    ? await members
        .rollenAngebot(viewer, { discordId: basic.discordId, roleIds: basic.roles.map((r) => r.id) })
        .catch(() => [])
    : [];

  const nichtVerfuegbar = <p className="text-sm text-muted-foreground">Daten momentan nicht verfügbar.</p>;

  return (
    <>
      {sperre?.gesperrt ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
          <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">
              {selbst
                ? 'Dein öffentliches Profil ist gesperrt.'
                : 'Das öffentliche Profil ist gesperrt.'}
            </span>{' '}
            {selbst
              ? 'Die Seite unter deinem Profil-Link ist derzeit nicht erreichbar. Hier drin bleibt alles wie gewohnt.'
              : `Seit ${formatDateTime(sperre.seit!)}${sperre.bis ? `, bis ${formatDateTime(sperre.bis)}` : ' - bis jemand sie aufhebt'}.`}
            {!selbst && darfSperrenSehen && sperre.grund ? ` Grund: ${sperre.grund}` : ''}
          </span>
        </p>
      ) : null}

      <PageHeader
        title={basic.displayName}
        description={`@${basic.username}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/*
             * Die eigenen Wege.
             *
             * Sie standen frueher in der zweiten, aufwendigen Profilansicht
             * unter «Mein Profil». Die gibt es intern nicht mehr - also
             * stehen sie hier, wo man sein Profil jetzt nachschlaegt.
             * Andernfalls waere mit der alten Ansicht auch der Teilen-Knopf
             * verschwunden.
             */}
            {selbst ? (
              <>
                <Link
                  href={systemRoutes.profilBearbeiten()}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  <Pencil aria-hidden="true" />
                  Profil bearbeiten
                </Link>
                {eigenerSlug ? (
                  <>
                    <a
                      href={`/u/${eigenerSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      <ExternalLink aria-hidden="true" />
                      Öffentliche Seite
                    </a>
                    <TeilenKnopf slug={eigenerSlug} variante="dezent" />
                  </>
                ) : (
                  <ProfilFreigebenKnopf />
                )}
              </>
            ) : null}
            {can(context, 'members.view') ? (
              <Link href="/members" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                <ArrowLeft aria-hidden="true" />
                Zurück
              </Link>
            ) : null}
            {basic.activeJail && capabilities.canReleaseJail ? (
              <ReleaseJailButton
                csrfToken={csrfToken}
                jailId={basic.activeJail.id}
                memberLabel={basic.displayName}
              />
            ) : null}
            {massnahmen?.any ? (
              <ModerationDialog
                grundVorlagen={alleVorlagen}
                csrfToken={csrfToken}
                abilities={massnahmen}
                presetMember={{
                  discordId: basic.discordId,
                  username: basic.username,
                  displayName: basic.displayName,
                  avatarHash: basic.avatarHash,
                  jailed: Boolean(basic.activeJail),
                }}
              />
            ) : null}
            {!basic.activeJail && canJail ? (
              <CreateJailDialog
                csrfToken={csrfToken}
                durationPresets={jail.JAIL_DURATION_PRESETS}
                maxDurationSeconds={jailSettings.maxDurationSeconds}
                reasonPresets={grundVorlagen}
                announceByDefault={!jailSettings.silentByDefault}
                presetMember={{
                  discordId: basic.discordId,
                  username: basic.username,
                  displayName: basic.displayName,
                  avatarHash: basic.avatarHash,
                  jailed: false,
                }}
                triggerLabel="Mitglied jailen"
                variant="outline"
              />
            ) : null}
          </div>
        }
      />

      {!profil.discordVerfuegbar ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          Discord-Daten momentan nicht verfügbar. Der Verlauf unten stammt aus der Datenbank und ist
          vollständig.
        </p>
      ) : !profil.imServer ? (
        <p className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">
          <UserX className="size-4" aria-hidden="true" />
          Nicht mehr auf dem Server. Historische Daten bleiben erhalten.
        </p>
      ) : null}

      {/*
        `min-w-0` an beiden Rasterkindern ist hier kein Feinschliff, sondern
        die Ursache: Rasterelemente haben von sich aus `min-width: auto` und
        schrumpfen deshalb nicht unter die Eigenbreite ihres Inhalts. Die
        Reiterleiste rechts ist in der Summe rund 870 Pixel breit - sie
        scrollt zwar in sich, gab diese Breite aber nach oben weiter und zog
        die ganze Seite auf 891 Pixel, unabhaengig vom Bildschirm. Genau das
        war das seitliche Schieben auf dem Telefon.
      */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Kopf ------------------------------------------------------- */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>
              {profil.discordVerfuegbar ? 'Live von Discord geladen.' : 'Aus der Datenbank.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <ProfilAvatar
                discordId={basic.discordId}
                avatarHash={basic.avatarHash}
                name={basic.displayName}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{basic.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">@{basic.username}</p>
              </div>
            </div>

            {/*
              Der Weg zu Discord.

              `discord.com/users/<id>` ist der von Discord unterstuetzte Weg
              zu einem Profil: im Browser oeffnet er die Web-App, mit
              installierter Anwendung uebernimmt diese. Die Kennung ist der
              stabile Bezeichner - ein Benutzername aendert sich, und eine
              Adresse darauf waere morgen falsch.

              Daneben die Kennung zum Kopieren: wer die Anwendung ohne
              Weiterleitung nutzt, sucht damit direkt.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`https://discord.com/users/${basic.discordId}`}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Discord-Profil öffnen
              </a>
              <KopierKnopf wert={basic.discordId} label="Discord-ID kopieren" />
            </div>

            <div className="flex flex-wrap gap-2">
              {basic.isBot ? (
                <Badge variant="secondary">
                  <Bot className="size-3" aria-hidden="true" />
                  Bot
                </Badge>
              ) : null}
              {basic.activeJail ? (
                <Badge variant="warning">
                  <Lock className="size-3" aria-hidden="true" />
                  {basic.activeJail.endsAt
                    ? `Gejailt bis ${formatDateTime(basic.activeJail.endsAt)}`
                    : 'Permanent gejailt'}
                </Badge>
              ) : null}
              {basic.timedOut ? (
                <Badge variant="destructive">
                  <ShieldAlert className="size-3" aria-hidden="true" />
                  Discord Timeout
                </Badge>
              ) : null}
              {basic.boosting ? <Badge variant="default">Server Booster</Badge> : null}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Server-Beitritt</dt>
                <dd>{basic.joinedAt ? formatDate(basic.joinedAt) : 'unbekannt'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Account erstellt</dt>
                <dd>{basic.accountCreatedAt ? formatDate(basic.accountCreatedAt) : 'unbekannt'}</dd>
              </div>
            </dl>

            {profil.roles ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Rollen ({profil.roles.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {profil.roles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Keine Rollen.</p>
                  ) : (
                    profil.roles.map((role) => (
                      <RoleBadge key={role.id} name={role.name} color={role.color} />
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* --- Reiter ----------------------------------------------------- */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <nav aria-label="Bereiche" className="-mx-1 flex gap-1 overflow-x-auto scrollbar-slim px-1 pb-1">
            {reiter.map((eintrag) => (
              <Link
                key={eintrag.id}
                href={`${basisPfad}?tab=${eintrag.id}${von ? `&von=${encodeURIComponent(von)}` : ''}`}
                aria-current={eintrag.id === aktiv ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  eintrag.id === aktiv
                    ? 'bg-primary/15 text-foreground ring-1 ring-primary/45'
                    : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                )}
              >
                {eintrag.label}
              </Link>
            ))}
          </nav>

          <Card>
            <CardContent className="space-y-4 pt-6">
              {aktiv === 'uebersicht' ? (
                <>
                  <Uebersicht profil={profil} selbst={selbst} />
                  {clipBilanz ? <ClipBilanzBlock bilanz={clipBilanz} /> : null}
                  {/* Verifikation: nur der Ausgang und die Methode, nie die
                      Nachricht selbst - die faellt unter die Aufbewahrung des
                      Verifikationsmoduls und geht das Member Center nichts an. */}
                  {verifikation ? (
                    <dl className="mt-4 grid grid-cols-2 gap-4 rounded-xl border border-border p-4 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Verifikation</dt>
                        <dd className="mt-0.5 font-medium">
                          {verifikation.status === 'VERIFIED'
                            ? 'Verifiziert'
                            : verifikation.status === 'REJECTED'
                              ? 'Abgelehnt'
                              : verifikation.status === 'EXPIRED'
                                ? 'Abgelaufen'
                                : 'Server verlassen'}
                          {verifikation.decidedAt
                            ? ` · ${new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium' }).format(verifikation.decidedAt)}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Methode</dt>
                        <dd className="mt-0.5">
                          {verifikation.decidedBy === 'AI'
                            ? 'AI-Prüfung'
                            : verifikation.decidedBy === 'SYSTEM'
                              ? 'Zeitsteuerung'
                              : (verifikation.decidedByUsername ?? 'Moderation')}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </>
              ) : aktiv === 'aktivitaet' ? (
                fehler.has('activity') ? (
                  nichtVerfuegbar
                ) : (
                  <Aktivitaet activity={profil.activity} />
                )
              ) : aktiv === 'level' ? (
                fehler.has('level') ? (
                  nichtVerfuegbar
                ) : (
                  <>
                    <LevelAnsicht level={profil.level} />
                    {/*
                      Die eigene Karte nur im eigenen Profil und nur mit der
                      Berechtigung. Wer fremde Profile verwaltet, sieht die
                      Karte weiter unten und kann sie entfernen - hochladen
                      darf sie ausschliesslich die Person selbst.
                    */}
                    {selbst && darfEigeneKarte ? (
                      <>
                        <CustomCardPanel
                          csrfToken={csrfToken}
                          discordId={basic.discordId}
                          vorhanden={profil.level?.eigeneKarte ?? false}
                          empfohlen={level.CUSTOM_CARD_SIZE}
                          maxBytes={level.MAX_CUSTOM_CARD_BYTES}
                        />
                        <KartenfarbeWaehler
                          csrfToken={csrfToken}
                          anzeigename={basic.displayName ?? basic.username}
                          xp={profil.level?.xp ?? 0}
                          rang={profil.level?.rang ?? 1}
                          akzentfarbe={kartenAkzent ?? '#83060A'}
                          gespeichert={profil.level?.kartenTextfarbe ?? null}
                        />
                      </>
                    ) : null}
                    {!selbst && profil.level?.eigeneKarte && capabilities.canManageXp ? (
                      <FremdeKarte discordId={basic.discordId} csrfToken={csrfToken} />
                    ) : null}
                    {capabilities.canManageXp ? (
                      <XpPanel discordId={basic.discordId} csrfToken={csrfToken} />
                    ) : null}
                  </>
                )
              ) : aktiv === 'turniere' ? (
                fehler.has('tournaments') ? (
                  nichtVerfuegbar
                ) : (
                  <Turniere daten={profil.tournaments} />
                )
              ) : aktiv === 'tickets' ? (
                fehler.has('tickets') ? (
                  nichtVerfuegbar
                ) : (
                  <Tickets zeilen={profil.tickets ?? []} />
                )
              ) : aktiv === 'premium' ? (
                fehler.has('premium') ? (
                  nichtVerfuegbar
                ) : (
                  <PremiumAnsicht daten={profil.premium ?? null} />
                )
              ) : aktiv === 'rollen' ? (
                capabilities.canManageRoles ? (
                  <RoleManager
                    discordId={basic.discordId}
                    csrfToken={csrfToken}
                    rollen={rollenAngebot.map((rolle) => ({
                      id: rolle.id,
                      name: rolle.name,
                      color: rolle.color,
                      vergeben: rolle.vergeben,
                      verwaltbar: rolle.verwaltbar,
                      grund: rolle.grund,
                    }))}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(profil.roles ?? []).map((role) => (
                      <RoleBadge key={role.id} name={role.name} color={role.color} />
                    ))}
                  </div>
                )
              ) : aktiv === 'moderation' ? (
                fehler.has('moderation') ? (
                  nichtVerfuegbar
                ) : (
                  <Moderation daten={profil.moderation} />
                )
              ) : aktiv === 'appeals' ? (
                fehler.has('appeals') ? (
                  nichtVerfuegbar
                ) : (profil.appeals ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Entbannungsanträge.</p>
                ) : (
                  <ul className="space-y-2">
                    {(profil.appeals ?? []).map((antrag) => (
                      <li
                        key={antrag.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
                      >
                        <Link
                          href={`/appeals/${antrag.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {antrag.fallnummer}
                        </Link>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{antrag.status}</span>
                        <span className="text-xs text-muted-foreground">
                          {(antrag.entschiedenAm ?? antrag.eingereichtAm)?.toLocaleDateString('de-CH') ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )
              ) : aktiv === 'community' ? (
                <CommunityProfil
                  discordId={basic.discordId}
                  csrfToken={csrfToken}
                  darfBearbeiten={darfProfilBearbeiten}
                  darfAuszeichnungen={darfAuszeichnungen}
                  darfVerwalten={darfArtenVerwalten}
                />
              ) : aktiv === 'notizen' ? (
                fehler.has('notes') ? (
                  nichtVerfuegbar
                ) : (
                  <NotesPanel
                    discordId={basic.discordId}
                    csrfToken={csrfToken}
                    canCreate={capabilities.canCreateNote}
                    notizen={(profil.notes ?? []).map((notiz) => ({
                      id: notiz.id,
                      content: notiz.content,
                      category: notiz.category,
                      pinned: notiz.pinned,
                      author: notiz.author,
                      createdAt: notiz.createdAt.toISOString(),
                      editedAt: notiz.editedAt?.toISOString() ?? null,
                      canEdit: notiz.canEdit,
                      canDelete: notiz.canDelete,
                    }))}
                  />
                )
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Die Übersicht.
 *
 * Zeigt nur Kacheln zu Abschnitten, die dieser Betrachter ohnehin sehen darf.
 * Eine Kachel «0 Jails» waere bereits eine Auskunft aus der Moderationsakte -
 * auch eine Null sagt etwas.
 */
function Uebersicht({
  profil,
  selbst,
}: {
  profil: members.MemberCenterProfile;
  selbst: boolean;
}): React.JSX.Element {
  const kacheln: Array<{ label: string; wert: string }> = [];

  if (profil.level) {
    kacheln.push({ label: 'Level', wert: `${profil.level.level} · ${profil.level.xp} XP` });
  }
  /*
   * Turniere stehen im eigenen Profil nicht.
   *
   * Dieselbe Regel wie beim Reiter daneben - `NICHT_IM_EIGENEN_PROFIL`. Der
   * Reiter war bereits weg, die Kachel blieb stehen: eine Zahl, die auf
   * einen Abschnitt zeigte, den es hier gar nicht gibt. Sie kommt aus
   * derselben Menge, damit die beiden nicht ein zweites Mal auseinander
   * laufen.
   *
   * Geloescht wird dabei nichts. In der Akte eines anderen Mitglieds steht
   * die Kachel weiterhin, und die Turnierverwaltung merkt davon nichts.
   */
  if (profil.tournaments && !(selbst && NICHT_IM_EIGENEN_PROFIL.has('tournaments'))) {
    kacheln.push({ label: 'Turniere', wert: String(profil.tournaments.gesamt) });
  }
  if (profil.tickets) {
    kacheln.push({ label: 'Tickets', wert: String(profil.tickets.length) });
  }
  if (profil.premium !== undefined) {
    kacheln.push({ label: 'Premium', wert: profil.premium?.aktiv ? 'Aktiv' : 'Kein Abo' });
  }
  if (profil.moderation) {
    kacheln.push({ label: 'Jails', wert: String(profil.moderation.jailsGesamt) });
  }

  if (kacheln.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Nichts freigegeben"
        description="Für dieses Mitglied sind dir keine weiteren Bereiche freigegeben."
      />
    );
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {kacheln.map((kachel) => (
        <div key={kachel.label} className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{kachel.label}</dt>
          <dd className="mt-1 text-lg font-semibold">{kachel.wert}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Die eigene Karte eines anderen Mitglieds - ansehen und entfernen. */
function FremdeKarte({ discordId, csrfToken }: { discordId: string; csrfToken: string }): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">Eigene Level-Card dieses Mitglieds</p>
      <div className="overflow-hidden rounded-lg border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/level/custom-card/${discordId}`}
          alt="Level-Card des Mitglieds"
          className="block aspect-[4/1] w-full object-cover"
        />
      </div>
      <RemoveCustomCardButton discordId={discordId} csrfToken={csrfToken} />
    </div>
  );
}

function Aktivitaet({ activity }: { activity?: members.MemberActivity }): React.JSX.Element {
  if (!activity) {
    return <EmptyState className="border-0" title="Keine Aktivität" description="Nichts erfasst." />;
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nachrichten</dt>
          <dd className="mt-1 text-lg font-semibold">{activity.messagesGesamt}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Voice-Minuten</dt>
          <dd className="mt-1 text-lg font-semibold">{activity.voiceMinutenGesamt}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Zeitraum</th>
              <th className="pb-2 pr-4 font-medium">XP</th>
              <th className="pb-2 pr-4 font-medium">Spielrunden</th>
              <th className="pb-2 pr-4 font-medium">Talks</th>
              <th className="pb-2 font-medium">Turniere</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activity.fenster.map((fenster) => (
              <tr key={fenster.tage}>
                <td className="py-2 pr-4">{fenster.tage} Tage</td>
                <td className="py-2 pr-4">{fenster.xpSumme}</td>
                <td className="py-2 pr-4">{fenster.spielrunden}</td>
                <td className="py-2 pr-4">{fenster.talks}</td>
                <td className="py-2">{fenster.turniere}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Nachrichten und Voice-Zeit führt das Level-System als Gesamtzahlen - für sie gibt es keine Zeiträume,
        und dafür eine Erfassung einzuführen wäre neue Überwachung für eine Anzeige.
      </p>
    </div>
  );
}

function LevelAnsicht({ level }: { level?: members.MemberLevelView }): React.JSX.Element {
  if (!level) {
    return <EmptyState className="border-0" title="Kein Level" description="Noch keine XP gesammelt." />;
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Level</dt>
          <dd className="mt-1 text-lg font-semibold">{level.level}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">XP</dt>
          <dd className="mt-1 text-lg font-semibold">{level.xp}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rang</dt>
          <dd className="mt-1 text-lg font-semibold">{level.rang ?? '–'}</dd>
        </div>
      </dl>
      {level.hoechstlevel ? (
        <p className="text-sm text-muted-foreground">Höchstlevel erreicht.</p>
      ) : (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent-gradient"
              style={{ width: `${Math.round(level.fortschritt * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Noch {level.fehlendeXp} XP bis Level {level.level + 1}.
          </p>
        </div>
      )}
    </div>
  );
}

function Turniere({ daten }: { daten?: members.MemberTournamentView }): React.JSX.Element {
  if (!daten || daten.teilnahmen.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Noch keine Turnierteilnahmen"
        description="Dieses Mitglied hat noch an keinem Turnier teilgenommen."
      />
    );
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Teilnahmen</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.gesamt}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Siege</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.siege}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Podeste</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.podeste}</dd>
        </div>
      </dl>
      <ul className="divide-y divide-border">
        {daten.teilnahmen.map((eintrag) => (
          <li key={eintrag.turnier.id} className="py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/turniere/${eintrag.turnier.slug}`}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {eintrag.turnier.name}
              </Link>
              <span className="flex items-center gap-2">
                {eintrag.platzierung !== null ? (
                  <Badge variant="secondary">Platz {eintrag.platzierung}</Badge>
                ) : null}
                <Badge variant="outline">{eintrag.turnier.status}</Badge>
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {eintrag.turnier.gameName}
              {eintrag.team ? ` · Team ${eintrag.team}` : ''}
              {eintrag.turnier.startsAt ? ` · ${formatDate(eintrag.turnier.startsAt)}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tickets({ zeilen }: { zeilen: members.MemberTicketRow[] }): React.JSX.Element {
  if (zeilen.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Keine Tickets vorhanden"
        description="Für dieses Mitglied sind dir keine Tickets sichtbar."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {zeilen.map((ticket) => (
        <li key={ticket.id} className="py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/tickets/${ticket.id}`} className="min-w-0 truncate font-medium hover:underline">
              #{ticket.nummer} · {ticket.betreff}
            </Link>
            <span className="flex items-center gap-2">
              <Badge variant="outline">{ticket.status}</Badge>
              <Badge variant="secondary">{ticket.prioritaet}</Badge>
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {ticket.kategorie ?? 'Ohne Kategorie'} · erstellt {formatDate(ticket.erstelltAm)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PremiumAnsicht({ daten }: { daten: members.MemberPremiumView | null }): React.JSX.Element {
  if (!daten) {
    return <EmptyState className="border-0" title="Kein Premium" description="Kein Abonnement vorhanden." />;
  }
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{daten.aktiv ? 'Aktiv' : (daten.status ?? 'Kein Abo')}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Plan</dt>
        <dd>{daten.plan ?? '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Laufend seit</dt>
        <dd>{daten.beginn ? formatDate(daten.beginn) : '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Läuft bis</dt>
        <dd>{daten.ende ? formatDate(daten.ende) : '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Stübli</dt>
        <dd>{daten.discordRolleGesetzt ? 'Vorhanden' : '–'}</dd>
      </div>
    </dl>
  );
}

function Moderation({ daten }: { daten?: members.MemberModerationView }): React.JSX.Element {
  // Jail-Vorgaenge stehen bereits im Jail-Verlauf - sie hier ein zweites Mal
  // aufzuzaehlen liesse die Akte doppelt so schwer aussehen, wie sie ist.
  const massnahmen = (daten?.moderationHistory ?? []).filter((eintrag) => !eintrag.type.startsWith('JAIL_'));

  if (!daten || (daten.jailHistory.length === 0 && massnahmen.length === 0)) {
    return (
      <EmptyState
        className="border-0"
        title="Keine Moderationseinträge"
        description="Gegen dieses Mitglied wurde noch keine Massnahme ergriffen."
      />
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Jail-Verlauf ({daten.jailsGesamt})</h3>
        {daten.jailHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch nie gejailt.</p>
        ) : (
          <ol className="divide-y divide-border">
            {daten.jailHistory.map((eintrag) => (
              <li key={eintrag.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/moderation/jail/${eintrag.id}`} className="font-medium hover:underline">
                    {formatDateTime(eintrag.startedAt)}
                  </Link>
                  {eintrag.releasedAt ? (
                    <Badge variant="secondary">Beendet</Badge>
                  ) : (
                    <Badge variant="warning">Aktiv</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {eintrag.reason} · Moderator: {eintrag.moderatorUsername}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {massnahmen.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Massnahmen ({massnahmen.length})</h3>
          <ol className="divide-y divide-border">
            {massnahmen.map((eintrag) => (
              <li key={eintrag.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionTypeBadge type={eintrag.type} />
                  {/* Nur Fremdes wird ausgewiesen: dass eine Massnahme ueber
                      dieses Dashboard lief, ist der Normalfall und muss an
                      jeder Zeile nicht wiederholt werden. */}
                  {eintrag.source === 'DISCORD' ? <SourceBadge source={eintrag.source} /> : null}
                  {eintrag.status === 'COMPLETED' ? null : <StatusBadge status={eintrag.status} />}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(eintrag.createdAt)} · {eintrag.actorUsername}
                    {eintrag.actorType === 'BOT' ? ' (Bot)' : ''}
                  </span>
                </div>
                {eintrag.reason ? (
                  <p className="mt-0.5 break-words text-muted-foreground">{eintrag.reason}</p>
                ) : null}
                {eintrag.expiresAt ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Bis {formatDateTime(eintrag.expiresAt)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
