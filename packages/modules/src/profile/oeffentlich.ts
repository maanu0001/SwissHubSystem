/**
 * Das oeffentliche Profil - was ohne Anmeldung herausgeht.
 *
 * ## Die eine Stelle
 *
 * Alles, was `/u/<slug>` ausliefert, kommt hier durch. Nicht, weil es
 * huebscher waere, sondern weil eine Allowlist nur dann eine ist, wenn es
 * genau eine gibt. Eine zweite Stelle, die «auch noch schnell» ein Feld
 * durchreicht, macht die erste wertlos.
 *
 * Gebaut wird **aufzaehlend**, nicht abziehend: es entsteht ein neues
 * Objekt aus benannten Feldern, statt aus dem vollen Profil etwas zu
 * loeschen. Der Unterschied zaehlt beim naechsten Feld, das jemand dem
 * Profil hinzufuegt - abziehend waere es sofort oeffentlich, und niemand
 * haette es entschieden.
 *
 * ## Was hier nicht vorkommt
 *
 * Kein Level-Rang, keine Tickets, keine Moderationsdaten, keine
 * Berechtigungen, keine E-Mail, keine interne Kennung, kein Jail, keine
 * Verifikation. Sie kommen nicht vor, weil `ProfilAnsicht` sie gar nicht
 * erst enthaelt - `service.ts` laedt sie nicht. Hier wird nichts
 * herausgefiltert, was vorher da war.
 *
 * Die **Discord-Kennung** ist die eine Ausnahme, und sie ist keine: ohne
 * sie gaebe es kein Avatarbild, denn Discords CDN adressiert danach. Sie
 * steht ohnehin in jeder Discord-Nachricht dieser Person.
 */
import { prisma } from '@swisshub/database';
import { ladeProfilFuer, type ProfilAnsicht } from './service';
import { istGueltigerSlug } from './slug';

export interface OeffentlichesProfil {
  slug: string;
  identitaet: {
    /** Fuer die Bildadresse - siehe oben. */
    discordId: string;
    name: string;
    /** Der selbst gewaehlte Name, falls es einen gibt. */
    profilname: string | null;
    avatarHash: string | null;
    mitgliedSeit: Date | null;
    boostet: boolean;
  };
  gestaltung: ProfilAnsicht['gestaltung'];
  angaben?: ProfilAnsicht['angaben'];
  level: ProfilAnsicht['level'];
  spiele?: ProfilAnsicht['spiele'];
  socials?: ProfilAnsicht['socials'];
  vitrine: ProfilAnsicht['vitrine'];
  /** Nur die erreichten - der Fortschritt zu unerreichten gehoert niemandem sonst. */
  auszeichnungen: ProfilAnsicht['auszeichnungen'];
}

/**
 * Aus der Profilansicht das machen, was ein Besucher sehen darf.
 *
 * Die Sichtbarkeit je Abschnitt hat `ladeProfilFuer('oeffentlich')` bereits
 * entschieden: was dort nicht freigegeben war, fehlt in der Ansicht schon.
 * Hier wird deshalb nichts mehr geprueft - es waere die zweite Stelle mit
 * derselben Regel, und zwei Stellen laufen auseinander.
 *
 * Was hier passiert, ist die Umwandlung in ein Objekt, das nur benannte
 * Felder hat.
 */
export function baueOeffentlichesProfil(ansicht: ProfilAnsicht, slug: string): OeffentlichesProfil {
  return {
    slug,
    identitaet: {
      discordId: ansicht.identitaet.discordId,
      name: ansicht.identitaet.discordName,
      profilname: ansicht.identitaet.profilname,
      avatarHash: ansicht.identitaet.avatarHash,
      mitgliedSeit: ansicht.identitaet.mitgliedSeit,
      boostet: ansicht.identitaet.boostet,
    },
    gestaltung: ansicht.gestaltung,
    ...(ansicht.angaben ? { angaben: ansicht.angaben } : {}),
    level: ansicht.level,
    ...(ansicht.spiele ? { spiele: ansicht.spiele } : {}),
    ...(ansicht.socials ? { socials: ansicht.socials } : {}),
    vitrine: ansicht.vitrine,
    // Nur Erreichtes. Eine Liste dessen, was jemand *nicht* geschafft hat,
    // gehoert ins eigene Profil und nicht auf eine oeffentliche Seite.
    auszeichnungen: ansicht.auszeichnungen.filter((eintrag) => eintrag.erreicht),
  };
}

/**
 * Zurueck in eine Ansicht, die die bestehenden Komponenten zeichnen koennen.
 *
 * Damit teilen sich «Mein Profil» und die oeffentliche Seite dieselben
 * Bauteile - und sehen deshalb gleich aus, statt sich langsam
 * auseinanderzuentwickeln. `eigenes: false` schaltet die Knoepfe ab, die
 * einem Besucher nichts nuetzen.
 *
 * `verborgen` bleibt leer: der Hinweis «Teile dieses Profils sind privat»
 * ist eine Auskunft ueber die Entscheidungen einer Person und geht einen
 * anonymen Besucher nichts an.
 */
export function alsAnsicht(oeffentlich: OeffentlichesProfil): ProfilAnsicht {
  return {
    identitaet: {
      discordId: oeffentlich.identitaet.discordId,
      discordName: oeffentlich.identitaet.name,
      profilname: oeffentlich.identitaet.profilname,
      avatarHash: oeffentlich.identitaet.avatarHash,
      mitgliedSeit: oeffentlich.identitaet.mitgliedSeit,
      verlassen: false,
      boostet: oeffentlich.identitaet.boostet,
    },
    gestaltung: oeffentlich.gestaltung,
    ...(oeffentlich.angaben ? { angaben: oeffentlich.angaben } : {}),
    level: oeffentlich.level,
    ...(oeffentlich.spiele ? { spiele: oeffentlich.spiele } : {}),
    ...(oeffentlich.socials ? { socials: oeffentlich.socials } : {}),
    vitrine: oeffentlich.vitrine,
    auszeichnungen: oeffentlich.auszeichnungen,
    eigenes: false,
    verborgen: [],
  };
}

/**
 * Ein oeffentliches Profil ueber seine Adresse holen.
 *
 * Gibt `null` zurueck, wenn es den Slug nicht gibt, die Person nicht mehr
 * da ist **oder** das Profil nicht oeffentlich steht. Bewusst dieselbe
 * Antwort fuer alle drei: ein Besucher soll nicht unterscheiden koennen,
 * ob eine Adresse frei ist oder ob dahinter jemand steht, der sein Profil
 * nicht zeigt. Die zweite Auskunft gaebe es sonst gratis dazu, und sie
 * gehoert niemandem ausser der Person selbst.
 *
 * `visibilityProfile` ist der Hauptschalter: steht er nicht auf `PUBLIC`,
 * gibt es die Seite nicht. Die uebrigen Abschnitte entscheiden danach nur
 * noch, was auf ihr steht.
 */
export async function ladeOeffentlichesProfil(slug: string): Promise<OeffentlichesProfil | null> {
  const ergebnis = await ladeOeffentlichesProfilOderSperre(slug);
  return ergebnis.art === 'profil' ? ergebnis.profil : null;
}

/**
 * Was hinter einer oeffentlichen Adresse steckt - einschliesslich einer Sperre.
 *
 * Drei Ausgaenge, und die Unterscheidung ist Absicht:
 *
 * - `profil`   - es gibt eines, und es darf gezeigt werden.
 * - `gesperrt` - es gibt eines, seine Besitzerin hat es oeffentlich
 *   gestellt, und die Moderation hat es vom Netz genommen.
 * - `keines`   - Adresse unbekannt, Person weg, oder das Profil steht nicht
 *   oeffentlich.
 *
 * ## Warum «gesperrt» ueberhaupt sichtbar ist
 *
 * Fuer alles andere gilt weiterhin dieselbe 404, und zwar bewusst: wer die
 * drei Faelle unterscheiden koennte, koennte Adressen durchprobieren und
 * erfahren, wer ein Profil hat, das er nicht zeigt.
 *
 * Bei einer Sperre ist diese Ueberlegung erledigt. Die Besitzerin hat die
 * Seite selbst veroeffentlicht - dass es sie gibt, ist bereits oeffentlich
 * bekannt, oft mit einem geteilten Link, den Leute anklicken. Die einzige
 * neue Auskunft ist «gerade nicht verfuegbar», und die ist freundlicher als
 * ein «gibt es nicht» auf einen Link, den jemand von einem Freund hat.
 *
 * **Der Grund bleibt innen.** Was nach aussen geht, ist ein Satz ohne Namen,
 * ohne Datum und ohne Anlass.
 */
export type OeffentlicheAntwort =
  { art: 'profil'; profil: OeffentlichesProfil } | { art: 'gesperrt' } | { art: 'keines' };

export async function ladeOeffentlichesProfilOderSperre(slug: string): Promise<OeffentlicheAntwort> {
  if (!istGueltigerSlug(slug)) {
    return { art: 'keines' };
  }

  const zeile = await prisma.memberProfile.findUnique({
    where: { publicSlug: slug },
    select: { discordId: true, visibilityProfile: true, publicLockedAt: true },
  });
  if (!zeile || zeile.visibilityProfile !== 'PUBLIC') {
    return { art: 'keines' };
  }

  /*
   * Die Sperre steht vor dem Laden, nicht danach.
   *
   * Nach dem Laden auszublenden hiesse: die Daten sind bereits geholt, und
   * ein Fehler in der Darstellung liesse sie ins HTML rutschen. Hier ist der
   * Dienst fertig, ehe irgendetwas zusammengestellt wurde.
   */
  if (zeile.publicLockedAt !== null) {
    return { art: 'gesperrt' };
  }

  const ansicht = await ladeProfilFuer(zeile.discordId, 'oeffentlich');
  if (!ansicht) {
    return { art: 'keines' };
  }

  return { art: 'profil', profil: baueOeffentlichesProfil(ansicht, slug) };
}

/** Der Slug eines Mitglieds - fuer den Teilen-Knopf im eigenen Profil. */
export async function slugVon(discordId: string): Promise<string | null> {
  const zeile = await prisma.memberProfile.findUnique({
    where: { discordId },
    select: { publicSlug: true, visibilityProfile: true, publicLockedAt: true },
  });
  if (!zeile?.publicSlug || zeile.visibilityProfile !== 'PUBLIC') {
    return null;
  }
  /*
   * Kein Teilen-Knopf fuer eine gesperrte Seite.
   *
   * Er fuehrte sonst zu einer Adresse, an der nichts steht - und die Person
   * verteilte einen Link, der bei jedem Empfaenger ins Leere laeuft.
   */
  if (zeile.publicLockedAt !== null) {
    return null;
  }
  return zeile.publicSlug;
}
