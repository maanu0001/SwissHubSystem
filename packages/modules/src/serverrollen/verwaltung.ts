import { prisma } from '@swisshub/database';
import { AppError, sanitizeText } from '@swisshub/shared';
import { listCachedRoles } from '../discord/sync';
import { botPosition, rollenFarbe } from './dienst';
import { pruefeSelbstzuweisung, type SperrGrund } from './sicherheit';
import type { DiscordPermissionName } from '@swisshub/discord';

/**
 * Was das Dashboard braucht.
 *
 * ## Warum hier mehr steht als auf der öffentlichen Seite
 *
 * Weil hier entschieden wird. Wer einen Haken setzt, soll **vorher** sehen,
 * ob er etwas bewirkt: eine Rolle mit «Mitglieder kicken» lässt sich nicht zur
 * Selbstvergabe freigeben, und das soll an der Rolle stehen und nicht erst
 * beim ersten Versuch eines Mitglieds auffallen.
 *
 * Die gefundenen Rechte stehen deshalb nur hier. Auf der öffentlichen Seite
 * wären sie eine Liste der interessanten Rollen für jemanden, der sie nicht
 * haben soll.
 */

export interface RolleFuerVerwaltung {
  discordRoleId: string;
  name: string;
  farbe: string | null;
  position: number;
  managed: boolean;
  /** Steht eine Zeile in `ServerRoleMeta`? */
  gepflegt: boolean;
  categoryId: string | null;
  beschreibung: string | null;
  sortOrder: number;
  publicVisible: boolean;
  selfAssignable: boolean;
  selfRemovable: boolean;
  voraussetzungRoleId: string | null;
  /** Könnte diese Rolle überhaupt freigegeben werden? */
  freigabeMoeglich: boolean;
  sperrGrund: SperrGrund | null;
  sperrText: string | null;
  kritischeRechte: DiscordPermissionName[];
}

export interface KategorieFuerVerwaltung {
  id: string;
  name: string;
  hinweis: string | null;
  sortOrder: number;
  publicVisible: boolean;
  /** Nur eine Rolle aus dieser Gruppe gleichzeitig. */
  exklusiv: boolean;
  anzahlRollen: number;
}

export interface VerwaltungsAnsicht {
  kategorien: KategorieFuerVerwaltung[];
  rollen: RolleFuerVerwaltung[];
  /** `null`, wenn die Bot-Position nicht zu ermitteln war - dann ist alles gesperrt. */
  botPosition: number | null;
}

/**
 * Alle Rollen des Servers mit ihrem gepflegten Zustand.
 *
 * Drei Abfragen für die ganze Seite: Gruppen, Metadaten, Rollen aus dem
 * Zwischenspeicher. Keine je Rolle - die Verbindung passiert im Speicher.
 */
export async function ladeVerwaltung(): Promise<VerwaltungsAnsicht> {
  const [kategorien, metadaten, rollen, position] = await Promise.all([
    prisma.serverRoleCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { rollen: true } } },
    }),
    prisma.serverRoleMeta.findMany(),
    listCachedRoles(),
    botPosition(),
  ]);

  const metaNachId = new Map(metadaten.map((eintrag) => [eintrag.discordRoleId, eintrag]));

  return {
    botPosition: position,
    kategorien: kategorien.map((kategorie) => ({
      id: kategorie.id,
      name: kategorie.name,
      hinweis: kategorie.hinweis,
      sortOrder: kategorie.sortOrder,
      publicVisible: kategorie.publicVisible,
      exklusiv: kategorie.exklusiv,
      anzahlRollen: kategorie._count.rollen,
    })),
    rollen: rollen
      // Die `@everyone`-Rolle hat jeder; sie zu beschreiben hiesse, den Server
      // zu beschreiben. Discord fuehrt sie mit der Guild-Kennung.
      .filter((rolle) => rolle.name !== '@everyone')
      .map((rolle) => {
        const meta = metaNachId.get(rolle.id);
        /*
         * Geprüft wird mit `selfAssignable: true`, egal was eingetragen ist.
         *
         * Die Frage hier ist nicht «ist sie freigegeben», sondern «dürfte sie
         * es sein». Nur so kann das Dashboard den Haken ausgrauen, statt ihn
         * anzubieten und später nichts zu tun.
         */
        const urteil = pruefeSelbstzuweisung({
          rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
          selfAssignable: true,
          botPosition: position,
        });

        return {
          discordRoleId: rolle.id,
          name: rolle.name,
          farbe: rollenFarbe(rolle.color),
          position: rolle.position,
          managed: rolle.managed,
          gepflegt: meta !== undefined,
          categoryId: meta?.categoryId ?? null,
          beschreibung: meta?.beschreibung ?? null,
          sortOrder: meta?.sortOrder ?? 0,
          publicVisible: meta?.publicVisible ?? true,
          selfAssignable: meta?.selfAssignable ?? false,
          selfRemovable: meta?.selfRemovable ?? true,
          voraussetzungRoleId: meta?.voraussetzungRoleId ?? null,
          freigabeMoeglich: urteil.erlaubt,
          sperrGrund: urteil.grund,
          sperrText: urteil.text,
          kritischeRechte: urteil.gefundeneRechte,
        };
      }),
  };
}

export interface KategorieEingabe {
  name: string;
  hinweis?: string | null;
  sortOrder?: number;
  publicVisible?: boolean;
  exklusiv?: boolean;
}

export async function erstelleKategorie(eingabe: KategorieEingabe): Promise<string> {
  const name = sanitizeText(eingabe.name, 60).trim();
  if (name.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Eine Gruppe braucht einen Namen.' });
  }
  const kategorie = await prisma.serverRoleCategory.create({
    data: {
      name,
      hinweis: eingabe.hinweis ? sanitizeText(eingabe.hinweis, 200).trim() || null : null,
      sortOrder: eingabe.sortOrder ?? 0,
      publicVisible: eingabe.publicVisible ?? true,
      // Aus, weil die Sammlung der Normalfall ist. Wer tauschen will, sagt es.
      exklusiv: eingabe.exklusiv ?? false,
    },
  });
  return kategorie.id;
}

export async function bearbeiteKategorie(id: string, eingabe: Partial<KategorieEingabe>): Promise<void> {
  const vorhanden = await prisma.serverRoleCategory.findUnique({ where: { id } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }
  await prisma.serverRoleCategory.update({
    where: { id },
    data: {
      ...(eingabe.name !== undefined ? { name: sanitizeText(eingabe.name, 60).trim() } : {}),
      ...(eingabe.hinweis !== undefined
        ? { hinweis: eingabe.hinweis ? sanitizeText(eingabe.hinweis, 200).trim() || null : null }
        : {}),
      ...(eingabe.sortOrder !== undefined ? { sortOrder: eingabe.sortOrder } : {}),
      ...(eingabe.publicVisible !== undefined ? { publicVisible: eingabe.publicVisible } : {}),
      ...(eingabe.exklusiv !== undefined ? { exklusiv: eingabe.exklusiv } : {}),
    },
  });
}

/**
 * Eine Gruppe löschen.
 *
 * Die Rollen darin bleiben. `onDelete: SetNull` lässt ihre Beschreibungen
 * stehen und sortiert sie nach «Sonstige» - eine Gruppe aufzulösen ist etwas
 * anderes, als die Arbeit daran wegzuwerfen.
 */
export async function loescheKategorie(id: string): Promise<void> {
  const vorhanden = await prisma.serverRoleCategory.findUnique({ where: { id } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Gruppe gibt es nicht.' });
  }
  await prisma.serverRoleCategory.delete({ where: { id } });
}

export interface RollenEingabe {
  categoryId?: string | null;
  beschreibung?: string | null;
  sortOrder?: number;
  publicVisible?: boolean;
  selfAssignable?: boolean;
  selfRemovable?: boolean;
  voraussetzungRoleId?: string | null;
}

/**
 * Die Angaben zu einer Rolle schreiben.
 *
 * ## Warum die Freigabe hier noch einmal geprüft wird
 *
 * Weil ein gespeicherter Haken, der nie wirkt, schlimmer ist als eine
 * Fehlermeldung: das Dashboard zeigte «freigegeben», die Mitglieder bekämen
 * «geht nicht», und niemand wüsste, wer recht hat.
 *
 * Geprüft wird gegen den Stand von jetzt. Ändert sich die Rolle später, bleibt
 * der Haken stehen und `aendereEigeneRolle` sperrt - das ist richtig so: der
 * Haken ist der Wunsch des Teams, die Prüfung beim Zugriff ist die Wahrheit.
 */
export async function speichereRolle(discordRoleId: string, eingabe: RollenEingabe): Promise<void> {
  const [rollen, position] = await Promise.all([listCachedRoles(), botPosition()]);
  const rolle = rollen.find((eintrag) => eintrag.id === discordRoleId);
  if (!rolle) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Rolle gibt es auf dem Server nicht.' });
  }

  if (eingabe.selfAssignable === true) {
    const urteil = pruefeSelbstzuweisung({
      rolle: { permissions: rolle.permissions, managed: rolle.managed, position: rolle.position },
      selfAssignable: true,
      botPosition: position,
    });
    if (!urteil.erlaubt) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: urteil.text ?? 'Diese Rolle lässt sich nicht zur Selbstvergabe freigeben.',
      });
    }
  }

  if (eingabe.categoryId) {
    const kategorie = await prisma.serverRoleCategory.findUnique({ where: { id: eingabe.categoryId } });
    if (!kategorie) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Diese Gruppe gibt es nicht.' });
    }
  }

  const beschreibung =
    eingabe.beschreibung === undefined
      ? undefined
      : eingabe.beschreibung
        ? sanitizeText(eingabe.beschreibung, 280).trim() || null
        : null;

  await prisma.serverRoleMeta.upsert({
    where: { discordRoleId },
    create: {
      discordRoleId,
      categoryId: eingabe.categoryId ?? null,
      beschreibung: beschreibung ?? null,
      sortOrder: eingabe.sortOrder ?? 0,
      publicVisible: eingabe.publicVisible ?? true,
      selfAssignable: eingabe.selfAssignable ?? false,
      selfRemovable: eingabe.selfRemovable ?? true,
      voraussetzungRoleId: eingabe.voraussetzungRoleId ?? null,
    },
    update: {
      ...(eingabe.categoryId !== undefined ? { categoryId: eingabe.categoryId } : {}),
      ...(beschreibung !== undefined ? { beschreibung } : {}),
      ...(eingabe.sortOrder !== undefined ? { sortOrder: eingabe.sortOrder } : {}),
      ...(eingabe.publicVisible !== undefined ? { publicVisible: eingabe.publicVisible } : {}),
      ...(eingabe.selfAssignable !== undefined ? { selfAssignable: eingabe.selfAssignable } : {}),
      ...(eingabe.selfRemovable !== undefined ? { selfRemovable: eingabe.selfRemovable } : {}),
      ...(eingabe.voraussetzungRoleId !== undefined
        ? { voraussetzungRoleId: eingabe.voraussetzungRoleId }
        : {}),
    },
  });
}

/** Die Angaben zu einer Rolle wieder entfernen - sie verschwindet damit von der Seite. */
export async function entferneRolle(discordRoleId: string): Promise<void> {
  await prisma.serverRoleMeta.deleteMany({ where: { discordRoleId } });
}
