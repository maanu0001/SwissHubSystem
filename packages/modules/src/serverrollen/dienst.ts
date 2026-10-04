import { prisma, recordAudit, AUDIT_ACTIONS } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { listCachedRoles } from '../discord/sync';
import { SERVERROLLEN_MODULE_ID, type ServerrollenSettings } from './config';
import { pruefeSelbstzuweisung, type SelbstzuweisungsUrteil } from './sicherheit';

const log = createLogger('modules:serverrollen');

/**
 * Der Dienst hinter der Rollenübersicht.
 *
 * ## Eine Abfrage, nicht eine je Rolle
 *
 * Die öffentliche Seite zeigt leicht fünfzig Rollen in acht Gruppen. Die
 * naheliegende Umsetzung - Gruppen laden, dann je Gruppe die Rollen, dann je
 * Rolle den Namen aus Discord - wären achtzig Abfragen für eine Seite, die
 * sich kaum ändert.
 *
 * Stattdessen drei: die Gruppen, die Metadaten, und der Rollen-Zwischenspeicher
 * (der seinerseits eine Minute lang gilt). Zusammengesetzt wird im Speicher.
 */

export interface OeffentlicheRolle {
  discordRoleId: string;
  name: string;
  /** Die **echte** Discord-Farbe als `#rrggbb` - `null` bei Discords «kein Farbwert». */
  farbe: string | null;
  beschreibung: string | null;
  /** Darf sich ein Mitglied diese Rolle selbst geben? Schon geprüft, nicht nur angehakt. */
  selbstVergebbar: boolean;
  selbstEntfernbar: boolean;
  /** Warum nicht - nur gesetzt, wenn jemand sie sonst erwarten würde. */
  sperrText: string | null;
}

export interface OeffentlicheKategorie {
  id: string;
  name: string;
  hinweis: string | null;
  /**
   * Nur **eine** Rolle aus dieser Gruppe gleichzeitig.
   *
   * Steht hier `true`, tauscht ein Klick statt zu stapeln. Die Seite sagt das
   * vorher - erzwungen wird es im Dienst, denn eine veraltete Seite darf keine
   * zweite Rolle durchlassen.
   */
  exklusiv: boolean;
  /**
   * Spalten auf dem Schreibtisch - 1 bis 4.
   *
   * Die Zahl kommt aus der Gruppe und nicht aus der Darstellung: ob eine
   * Gruppe mit drei kurzen Rollen in drei Spalten steht, weiss das Team und
   * nicht der Breakpoint. Tablet und Telefon deckeln sie trotzdem - siehe
   * oeffentliche Seite.
   */
  spalten: number;
  rollen: OeffentlicheRolle[];
}

export interface OeffentlicheRollenseite {
  untertitel: string;
  selbstvergabeAktiv: boolean;
  kategorien: OeffentlicheKategorie[];
}

/** Ist die öffentliche Seite freigegeben? Modul **und** Schalter. */
export async function oeffentlichErlaubt(): Promise<boolean> {
  if (!(await isModuleEnabled(SERVERROLLEN_MODULE_ID))) {
    return false;
  }
  const einstellungen = await getModuleSettings<ServerrollenSettings>(SERVERROLLEN_MODULE_ID);
  return einstellungen.oeffentlichAktiv;
}

/**
 * Discords Farbzahl als Hex - oder `null`.
 *
 * Discord schreibt `0` für «keine eigene Farbe». Daraus `#000000` zu machen
 * wäre falsch: die Rolle hat keine Farbe, sie ist nicht schwarz. Die Seite
 * zeigt dann den neutralen Ton statt eines Akzents, der keiner ist.
 */
export function rollenFarbe(color: number): string | null {
  if (!Number.isFinite(color) || color <= 0) {
    return null;
  }
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Die höchste Position der Bot-Rollen.
 *
 * `null`, wenn sie sich nicht ermitteln lässt - Discord antwortet gerade
 * nicht, der Bot ist nicht auf dem Server. `pruefeSelbstzuweisung` sperrt
 * dann; eine Hierarchie, die niemand kennt, ist kein Freibrief.
 */
export async function botPosition(): Promise<number | null> {
  try {
    const [rollen, botMitglied] = await Promise.all([listCachedRoles(), discord.bot.member()]);
    if (!botMitglied) {
      return null;
    }
    const eigene = new Set(botMitglied.roleIds);
    const hoechste = rollen
      .filter((rolle) => eigene.has(rolle.id))
      .reduce((bisher, rolle) => Math.max(bisher, rolle.position), -1);
    return hoechste < 0 ? null : hoechste;
  } catch {
    return null;
  }
}

/**
 * Die öffentliche Seite - Gruppen mit ihren Rollen.
 *
 * Ausgeblendete Gruppen und Rollen fallen hier heraus und nicht in der
 * Darstellung: eine Komponente, die filtert, hat die Daten schon im HTML.
 *
 * Rollen ohne Gruppe landen in «Sonstige» - sie gehen nicht verloren, nur
 * weil jemand beim Zuordnen aufgehört hat. Eine Rolle, die es auf Discord
 * nicht mehr gibt, verschwindet still: ihre Zeile bleibt stehen, damit die
 * Beschreibung nach einem Rollen-Neuaufbau nicht weg ist.
 */
export async function ladeOeffentlicheRollen(): Promise<OeffentlicheRollenseite | null> {
  if (!(await oeffentlichErlaubt())) {
    return null;
  }

  const einstellungen = await getModuleSettings<ServerrollenSettings>(SERVERROLLEN_MODULE_ID);
  const [kategorien, metadaten, rollen, position] = await Promise.all([
    prisma.serverRoleCategory.findMany({
      where: { publicVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.serverRoleMeta.findMany({
      where: { publicVisible: true },
      orderBy: [{ sortOrder: 'asc' }],
    }),
    listCachedRoles(),
    botPosition(),
  ]);

  const rollenNachId = new Map(rollen.map((rolle) => [rolle.id, rolle]));

  const baue = (meta: (typeof metadaten)[number]): OeffentlicheRolle | null => {
    const rolle = rollenNachId.get(meta.discordRoleId);
    if (!rolle) {
      return null;
    }
    const urteil = pruefeSelbstzuweisung({
      rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
      selfAssignable: meta.selfAssignable && einstellungen.selbstvergabeAktiv,
      botPosition: position,
      voraussetzungRoleId: meta.voraussetzungRoleId,
      // Die eigenen Rollen kennt diese Funktion nicht - sie baut die Seite für
      // alle. Die Voraussetzung prüft `weiseSelbstZu` noch einmal mit Person.
      eigeneRollen: meta.voraussetzungRoleId ? [meta.voraussetzungRoleId] : [],
    });

    return {
      discordRoleId: rolle.id,
      name: rolle.name,
      farbe: rollenFarbe(rolle.color),
      beschreibung: meta.beschreibung,
      selbstVergebbar: urteil.erlaubt,
      selbstEntfernbar: urteil.erlaubt && meta.selfRemovable,
      /*
       * Ein Grund steht nur da, wo er jemandem hilft.
       *
       * Bei einer Rolle, die gar nicht zur Selbstvergabe gedacht ist, wäre
       * «nicht freigegeben» Rauschen - das ist der Normalfall. Bei einer, die
       * angehakt ist und trotzdem gesperrt, ist es die Erklärung, die das Team
       * sonst suchen müsste.
       */
      sperrText: meta.selfAssignable && !urteil.erlaubt ? urteil.text : null,
    };
  };

  const nachKategorie = new Map<string | null, OeffentlicheRolle[]>();
  for (const meta of metadaten) {
    const rolle = baue(meta);
    if (!rolle) {
      continue;
    }
    const schluessel = meta.categoryId;
    nachKategorie.set(schluessel, [...(nachKategorie.get(schluessel) ?? []), rolle]);
  }

  const gruppen: OeffentlicheKategorie[] = kategorien
    .map((kategorie) => ({
      id: kategorie.id,
      name: kategorie.name,
      hinweis: kategorie.hinweis,
      exklusiv: kategorie.exklusiv,
      spalten: kategorie.spalten,
      rollen: nachKategorie.get(kategorie.id) ?? [],
    }))
    .filter((gruppe) => gruppe.rollen.length > 0);

  const ohneGruppe = nachKategorie.get(null) ?? [];
  if (ohneGruppe.length > 0) {
    /*
     * «Sonstige» ist keine Gruppe, sondern der Rest. Sie kann darum nicht
     * exklusiv sein - Rollen landen hier, weil ihnen eine Zuordnung fehlt, und
     * nicht weil sie zusammengehören.
     */
    gruppen.push({
      id: 'ohne',
      name: 'Sonstige',
      hinweis: null,
      exklusiv: false,
      // Eine Spalte: «Sonstige» ist der Rest, und der soll nicht breiter
      // aussehen als die Gruppen, die jemand gepflegt hat.
      spalten: 1,
      rollen: ohneGruppe,
    });
  }

  return {
    untertitel: einstellungen.untertitel,
    selbstvergabeAktiv: einstellungen.selbstvergabeAktiv,
    kategorien: gruppen,
  };
}

/** Was ein Mitglied von den freigegebenen Rollen bereits hat. */
export async function eigeneRollen(discordId: string): Promise<string[]> {
  const mitglied = await discord.members.get(discordId);
  return mitglied?.roleIds ?? [];
}

export interface ZuweisungsErgebnis {
  erfolg: boolean;
  /** Was der Person gesagt wird. */
  nachricht: string;
  urteil: SelbstzuweisungsUrteil | null;
  /**
   * Rollen, die beim Tausch weggefallen sind - mit Namen, nicht mit Kennung.
   *
   * Eine Oberfläche, die nur «gespeichert» sagt, während zwei Rollen den
   * Besitzer gewechselt haben, lässt die Person im Unklaren. Leer bei allem,
   * was kein Tausch war.
   */
  getauscht?: string[];
}

/**
 * Eine Rolle selbst nehmen oder abgeben.
 *
 * ## Warum hier noch einmal geprüft wird
 *
 * Weil zwischen dem Aufbau der Seite und dem Klick alles passiert sein kann:
 * die Rolle hat neue Rechte bekommen, die Bot-Rolle ist nach unten gerutscht,
 * das Team hat die Freigabe zurückgenommen. Die Seite zeigt den Stand von
 * vorhin; hier gilt der Stand von jetzt.
 *
 * Und weil die Seite nicht die einzige Tür ist. Eine Server Action lässt sich
 * aufrufen, ohne die Seite je gesehen zu haben - was dort ausgeblendet wird,
 * ist eine Bequemlichkeit und keine Sperre.
 *
 * ## Warum ein Fehlschlag kein Wurf ist
 *
 * «Diese Rolle kannst du dir nicht selbst geben» ist eine Antwort und keine
 * Störung. Geworfen wird nur, was wirklich unerwartet ist - ein abgeschaltetes
 * Modul, eine Rolle, die es nicht gibt.
 */
export async function aendereEigeneRolle(
  discordId: string,
  discordRoleId: string,
  richtung: 'hinzufuegen' | 'entfernen',
): Promise<ZuweisungsErgebnis> {
  if (!(await isModuleEnabled(SERVERROLLEN_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Serverrollen sind derzeit ausgeschaltet.' });
  }
  const einstellungen = await getModuleSettings<ServerrollenSettings>(SERVERROLLEN_MODULE_ID);
  if (!einstellungen.selbstvergabeAktiv) {
    return {
      erfolg: false,
      nachricht: 'Die Selbstvergabe ist derzeit ausgeschaltet.',
      urteil: null,
    };
  }

  const meta = await prisma.serverRoleMeta.findUnique({ where: { discordRoleId } });
  if (!meta) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Rolle gibt es hier nicht.' });
  }

  const [rollen, position, mitglied] = await Promise.all([
    listCachedRoles(),
    botPosition(),
    discord.members.get(discordId),
  ]);
  if (!mitglied) {
    return {
      erfolg: false,
      nachricht: 'Du bist auf dem Discord-Server gerade nicht zu finden.',
      urteil: null,
    };
  }

  const rolle = rollen.find((eintrag) => eintrag.id === discordRoleId);
  if (!rolle) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Rolle gibt es auf dem Server nicht mehr.' });
  }

  const urteil = pruefeSelbstzuweisung({
    rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
    selfAssignable: meta.selfAssignable,
    botPosition: position,
    eigeneRollen: mitglied.roleIds,
    voraussetzungRoleId: meta.voraussetzungRoleId,
  });

  if (!urteil.erlaubt) {
    /*
     * Ein gesperrter Versuch gehört ins Audit Log.
     *
     * Nicht, weil jemand etwas Böses getan hätte - der Normalfall ist eine
     * veraltete Seite. Sondern weil ein Muster hier das Erste wäre, was man
     * sehen will: zehn Versuche auf eine Admin-Rolle sind etwas anderes als
     * einer.
     */
    await recordAudit({
      action: AUDIT_ACTIONS.SERVERROLE_SELF_DENIED,
      module: SERVERROLLEN_MODULE_ID,
      actorDiscordId: discordId,
      targetLabel: rolle.name,
      success: false,
      metadata: { discordRoleId, grund: urteil.grund, rechte: urteil.gefundeneRechte },
    });
    return { erfolg: false, nachricht: urteil.text ?? 'Das geht hier nicht.', urteil };
  }

  const hatSie = mitglied.roleIds.includes(discordRoleId);
  if (richtung === 'entfernen' && !meta.selfRemovable) {
    return {
      erfolg: false,
      nachricht: 'Diese Rolle lässt sich nicht selbst wieder abgeben. Melde dich beim Team.',
      urteil,
    };
  }

  // Schon im gewünschten Zustand: kein Fehler, nur nichts zu tun. Zwei Klicks
  // auf denselben Knopf sollen nicht in einer roten Meldung enden.
  if ((richtung === 'hinzufuegen' && hatSie) || (richtung === 'entfernen' && !hatSie)) {
    return { erfolg: true, nachricht: 'Passt schon.', urteil };
  }

  const grund = `Selbstvergabe über SwissHub (${discordId})`;

  /*
   * Eine Gruppe, aus der nur eine Rolle gleichzeitig gilt.
   *
   * Der Tausch passiert hier und nicht in der Oberfläche: eine Seite, die
   * schon offen war, als die Gruppe exklusiv wurde, würde sonst eine zweite
   * Rolle durchlassen. Dass die Seite vorher fragt, ist Höflichkeit; dass es
   * danach nur eine ist, ist die Zusage.
   */
  const abzulegen =
    richtung === 'hinzufuegen' && meta.categoryId
      ? await geschwisterrollen(meta.categoryId, discordRoleId, mitglied.roleIds)
      : [];

  const nichtAbgebbar = abzulegen.filter((eintrag) => !eintrag.selfRemovable);
  if (nichtAbgebbar.length > 0) {
    /*
     * Eine Rolle, die man nicht selbst abgeben darf, steht im Weg.
     *
     * Sie über den Tausch stillschweigend wegzunehmen wäre eine Lücke in
     * `selfRemovable`: was über den Knopf «abgeben» nicht geht, darf über den
     * Knopf «andere nehmen» auch nicht gehen. Also eine Absage mit Grund.
     */
    const namen = nichtAbgebbar
      .map((eintrag) => rollen.find((treffer) => treffer.id === eintrag.discordRoleId)?.name)
      .filter((name): name is string => Boolean(name));
    return {
      erfolg: false,
      nachricht:
        namen.length > 0
          ? `Dafür müsste «${namen.join('», «')}» weg, und die lässt sich nicht selbst abgeben. Melde dich beim Team.`
          : 'Dafür müsste eine Rolle weg, die sich nicht selbst abgeben lässt. Melde dich beim Team.',
      urteil,
    };
  }

  const getauscht = abzulegen
    .map((eintrag) => rollen.find((treffer) => treffer.id === eintrag.discordRoleId)?.name)
    .filter((name): name is string => Boolean(name));

  if (richtung === 'hinzufuegen' && abzulegen.length > 0) {
    /*
     * Ein Aufruf für den ganzen Tausch.
     *
     * `setRoles` schreibt die Liste in einem PATCH. Nacheinander entfernen und
     * hinzufügen wären zwei Aufrufe, und zwischen ihnen hätte die Person
     * entweder zwei Rollen aus der Gruppe oder keine - je nachdem, welcher
     * fehlschlägt.
     */
    const abgelegt = new Set(abzulegen.map((eintrag) => eintrag.discordRoleId));
    const naechste = [...mitglied.roleIds.filter((eintrag) => !abgelegt.has(eintrag)), discordRoleId];
    await discord.members.setRoles(discordId, naechste, grund);
  } else if (richtung === 'hinzufuegen') {
    await discord.roles.add(discordId, discordRoleId, grund);
  } else {
    await discord.roles.remove(discordId, discordRoleId, grund);
  }

  await recordAudit({
    action:
      richtung === 'hinzufuegen'
        ? AUDIT_ACTIONS.SERVERROLE_SELF_ADDED
        : AUDIT_ACTIONS.SERVERROLE_SELF_REMOVED,
    module: SERVERROLLEN_MODULE_ID,
    actorDiscordId: discordId,
    targetDiscordId: discordId,
    targetLabel: rolle.name,
    success: true,
    metadata: { discordRoleId, ...(getauscht.length > 0 ? { getauscht } : {}) },
  });

  if (getauscht.length > 0) {
    return {
      erfolg: true,
      nachricht: `«${rolle.name}» ist jetzt deine - «${getauscht.join('», «')}» ist dafür weg.`,
      urteil,
      getauscht,
    };
  }

  return {
    erfolg: true,
    nachricht: richtung === 'hinzufuegen' ? `«${rolle.name}» ist jetzt deine.` : `«${rolle.name}» ist weg.`,
    urteil,
  };
}

/**
 * Die anderen Rollen derselben exklusiven Gruppe, die jemand gerade trägt.
 *
 * Leer, wenn die Gruppe keine Einschränkung hat - dann ist nichts zu tauschen.
 * Gefragt wird die Datenbank und nicht die Seite: welche Gruppe exklusiv ist,
 * kann sich geändert haben, seit die Seite gebaut wurde.
 */
async function geschwisterrollen(
  categoryId: string,
  discordRoleId: string,
  eigeneRollen: readonly string[],
): Promise<Array<{ discordRoleId: string; selfRemovable: boolean }>> {
  const kategorie = await prisma.serverRoleCategory.findUnique({
    where: { id: categoryId },
    select: { exklusiv: true },
  });
  if (!kategorie?.exklusiv) {
    return [];
  }

  const geschwister = await prisma.serverRoleMeta.findMany({
    where: {
      categoryId,
      discordRoleId: { in: [...eigeneRollen].filter((eintrag) => eintrag !== discordRoleId) },
    },
    select: { discordRoleId: true, selfRemovable: true },
  });
  return geschwister;
}

export interface GruppenWahlErgebnis {
  erfolg: boolean;
  nachricht: string;
  /** Rollen, die dazugekommen sind - mit Namen. */
  dazu: string[];
  /** Rollen, die weggefallen sind. */
  weg: string[];
}

/**
 * Die Auswahl einer Gruppe setzen - der Weg des Discord-Dropdowns.
 *
 * ## Warum «setzen» und nicht «hinzufuegen»
 *
 * Weil ein Auswahlmenue einen Wunsch ausdrueckt und keine Einzelaktion. Wer
 * in einer Sammelgruppe zwei Rollen markiert, meint «ich will diese zwei» -
 * und nicht «diese zwei zusaetzlich zu dem, was ich vergessen habe». Daraus
 * folgt auch, dass man ueber dasselbe Menue Rollen abgeben kann: was nicht
 * mehr markiert ist, faellt weg. Ohne diese Lesart braeuchte es einen zweiten
 * Weg zum Entfernen, und Discord haette dafuer keinen Platz.
 *
 * ## Was der Client nicht entscheidet
 *
 * Die Gruppenkennung steht in der Interaktion, die **erlaubten Rollen** kommen
 * aus der Datenbank. Eine Kennung, die nicht zu dieser Gruppe gehoert, wird
 * nicht einfach ignoriert, sondern fuehrt zur Absage mit Eintrag im Log: eine
 * fremde Rollenkennung in einem Rollenmenue ist nichts, was im normalen
 * Betrieb vorkommt.
 *
 * Danach gilt dieselbe Pruefung wie ueberall - `pruefeSelbstzuweisung` je
 * Rolle, gegen Rechte, `managed`, Bot-Hierarchie, Freigabe und Voraussetzung.
 *
 * ## Warum ein einziger Schreibvorgang
 *
 * `setRoles` schreibt die ganze Liste in einem PATCH. Nacheinander entfernen
 * und hinzufuegen waeren zwei Aufrufe, und zwischen ihnen stuende die Person
 * entweder mit zwei Rollen einer Exklusivgruppe da oder mit keiner - je
 * nachdem, welcher Aufruf scheitert. Scheitert der eine Aufruf, aendert sich
 * nichts, und das ist der Zustand, in dem man einen Fehlschlag haben will.
 */
export async function setzeGruppenauswahl(
  discordId: string,
  categoryId: string,
  gewaehlt: readonly string[],
): Promise<GruppenWahlErgebnis> {
  if (!(await isModuleEnabled(SERVERROLLEN_MODULE_ID))) {
    throw new AppError('CONFLICT', { userMessage: 'Serverrollen sind derzeit ausgeschaltet.' });
  }
  const einstellungen = await getModuleSettings<ServerrollenSettings>(SERVERROLLEN_MODULE_ID);
  if (!einstellungen.selbstvergabeAktiv) {
    return { erfolg: false, nachricht: 'Die Selbstvergabe ist derzeit ausgeschaltet.', dazu: [], weg: [] };
  }

  const gruppe = await prisma.serverRoleCategory.findUnique({ where: { id: categoryId } });
  if (!gruppe) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Rollengruppe gibt es nicht.' });
  }

  const [metadaten, rollen, position, mitglied] = await Promise.all([
    prisma.serverRoleMeta.findMany({ where: { categoryId } }),
    listCachedRoles(),
    botPosition(),
    discord.members.get(discordId),
  ]);
  if (!mitglied) {
    return {
      erfolg: false,
      nachricht: 'Du bist auf dem Discord-Server gerade nicht zu finden.',
      dazu: [],
      weg: [],
    };
  }

  const rollenNachId = new Map(rollen.map((rolle) => [rolle.id, rolle]));
  const metaNachId = new Map(metadaten.map((eintrag) => [eintrag.discordRoleId, eintrag]));
  const nameVon = (id: string): string => rollenNachId.get(id)?.name ?? id;

  /*
   * Eine Auswahl, die nicht zur Gruppe gehoert, ist eine Absage.
   *
   * Das kann der Normalfall nicht sein: das Menue traegt genau die Rollen
   * dieser Gruppe. Bleibt eine fremde Kennung uebrig, ist entweder die
   * Nachricht alt oder jemand hat die Interaktion nachgebaut - beides ist
   * nichts, was man stillschweigend zurechtbiegt.
   */
  const fremde = gewaehlt.filter((id) => !metaNachId.has(id));
  if (fremde.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.SERVERROLE_SELF_DENIED,
      module: SERVERROLLEN_MODULE_ID,
      actorDiscordId: discordId,
      targetLabel: gruppe.name,
      success: false,
      metadata: { categoryId, grund: 'fremde_rolle', rollen: fremde },
    });
    return {
      erfolg: false,
      nachricht: 'Diese Auswahl passt nicht zu dieser Gruppe. Lade die Nachricht neu.',
      dazu: [],
      weg: [],
    };
  }

  // Exklusiv heisst eine - auch wenn das Menue etwas anderes geschickt hat.
  if (gruppe.exklusiv && gewaehlt.length > 1) {
    return {
      erfolg: false,
      nachricht: 'Aus dieser Gruppe geht nur eine Rolle. Wähle eine.',
      dazu: [],
      weg: [],
    };
  }

  const inGruppe = new Set(metadaten.map((eintrag) => eintrag.discordRoleId));
  const hatJetzt = mitglied.roleIds.filter((id) => inGruppe.has(id));
  const soll = new Set(gewaehlt);

  const hinzu = [...soll].filter((id) => !hatJetzt.includes(id));
  const runter = hatJetzt.filter((id) => !soll.has(id));

  if (hinzu.length === 0 && runter.length === 0) {
    return { erfolg: true, nachricht: 'Passt schon - daran ändert sich nichts.', dazu: [], weg: [] };
  }

  // Jede neue Rolle wird einzeln geprueft - mit dem Stand von jetzt.
  for (const id of hinzu) {
    const meta = metaNachId.get(id);
    const rolle = rollenNachId.get(id);
    const urteil = rolle
      ? pruefeSelbstzuweisung({
          rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
          selfAssignable: meta?.selfAssignable ?? false,
          botPosition: position,
          eigeneRollen: mitglied.roleIds,
          voraussetzungRoleId: meta?.voraussetzungRoleId ?? null,
        })
      : null;

    if (!urteil?.erlaubt) {
      await recordAudit({
        action: AUDIT_ACTIONS.SERVERROLE_SELF_DENIED,
        module: SERVERROLLEN_MODULE_ID,
        actorDiscordId: discordId,
        targetLabel: nameVon(id),
        success: false,
        metadata: {
          categoryId,
          discordRoleId: id,
          grund: urteil?.grund ?? 'rolle_unbekannt',
          rechte: urteil?.gefundeneRechte ?? [],
        },
      });
      return {
        erfolg: false,
        nachricht: urteil?.text ?? 'Diese Rolle gibt es auf dem Server nicht mehr.',
        dazu: [],
        weg: [],
      };
    }
  }

  /*
   * Was man nicht abgeben darf, nimmt auch der Tausch nicht weg.
   *
   * Sonst waere `selfRemovable` eine Luecke mit zwei Tueren: ueber «abgeben»
   * gesperrt, ueber «etwas anderes waehlen» offen.
   */
  const festsitzend = runter.filter((id) => metaNachId.get(id)?.selfRemovable === false);
  if (festsitzend.length > 0) {
    return {
      erfolg: false,
      nachricht: `«${festsitzend.map(nameVon).join('», «')}» lässt sich nicht selbst abgeben. Melde dich beim Team.`,
      dazu: [],
      weg: [],
    };
  }

  const weg = new Set(runter);
  const naechste = [...mitglied.roleIds.filter((id) => !weg.has(id)), ...hinzu];
  await discord.members.setRoles(discordId, naechste, `Rollenauswahl über SwissHub (${discordId})`);

  /*
   * Nachsehen, ob es gewirkt hat.
   *
   * `setRoles` wirft bei einem Fehler, aber es gibt den Fall dazwischen:
   * Discord nimmt den Aufruf an und eine Rolle fehlt doch, weil sich die
   * Hierarchie in derselben Sekunde verschoben hat. Dann soll die Antwort das
   * sagen und nicht «erledigt» melden.
   */
  const danach = await discord.members.get(discordId).catch(() => null);
  if (danach) {
    const istJetzt = new Set(danach.roleIds);
    const fehlend = hinzu.filter((id) => !istJetzt.has(id));
    const haengend = runter.filter((id) => istJetzt.has(id));
    if (fehlend.length > 0 || haengend.length > 0) {
      log.warn('Rollenauswahl nicht vollständig angekommen', {
        discordId,
        categoryId,
        fehlend,
        haengend,
      });
      return {
        erfolg: false,
        nachricht: 'Discord hat die Änderung nicht vollständig übernommen. Versuch es noch einmal.',
        dazu: hinzu.filter((id) => istJetzt.has(id)).map(nameVon),
        weg: runter.filter((id) => !istJetzt.has(id)).map(nameVon),
      };
    }
  }

  if (hinzu.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.SERVERROLE_SELF_ADDED,
      module: SERVERROLLEN_MODULE_ID,
      actorDiscordId: discordId,
      targetDiscordId: discordId,
      targetLabel: hinzu.map(nameVon).join(', '),
      success: true,
      metadata: { categoryId, rollen: hinzu, ueber: 'discord-menue' },
    });
  }
  if (runter.length > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.SERVERROLE_SELF_REMOVED,
      module: SERVERROLLEN_MODULE_ID,
      actorDiscordId: discordId,
      targetDiscordId: discordId,
      targetLabel: runter.map(nameVon).join(', '),
      success: true,
      metadata: { categoryId, rollen: runter, ueber: 'discord-menue' },
    });
  }

  const teile: string[] = [];
  if (hinzu.length > 0) {
    teile.push(`«${hinzu.map(nameVon).join('», «')}» ist jetzt deine`);
  }
  if (runter.length > 0) {
    teile.push(`«${runter.map(nameVon).join('», «')}» ist weg`);
  }

  return {
    erfolg: true,
    nachricht: `${teile.join(' - ')}.`,
    dazu: hinzu.map(nameVon),
    weg: runter.map(nameVon),
  };
}
