import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUECKKEHR_PARAM, istInterneRoute, mitRueckkehr, sichereRueckkehr } from '@swisshub/shared';
import { listenKontext, rueckkehrAus } from '../../apps/web/src/server/navigation-context';

/**
 * «Zurück zu …» - der Kontext, aus dem jemand kam.
 *
 * Filter, Suche, Sortierung und Seitenzahl stehen in dieser Anwendung
 * durchgehend in der Adresse. Zurück, Vorwärts und Neuladen im Browser
 * erledigen den grössten Teil deshalb von selbst - was fehlte, war der Weg
 * von einer Detailseite zurück in genau die Liste, aus der man kam.
 *
 * Diese Adresse kommt aus einem Query-Parameter, also aus fremder Hand. Ohne
 * Prüfung wäre sie eine offene Weiterleitung: ein präparierter Link in einem
 * Discord-Kanal führte nach einem Klick auf «Zurück» auf eine fremde Seite,
 * die wie SwissHub aussieht. Der grösste Teil dieser Datei prüft deshalb
 * nicht, was durchkommt, sondern was nicht.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('Keine offenen Weiterleitungen', () => {
  it('weist absolute Adressen ab', () => {
    for (const boese of [
      'https://external-site.example',
      'http://example.org/pfad',
      'https://system.swisshub.gg.evil.example/dashboard',
    ]) {
      expect(istInterneRoute(boese), boese).toBe(false);
    }
  });

  it('weist schemalose Adressen ab', () => {
    // `//example.org` ist für den Browser eine absolute Adresse - der
    // gefährlichste Fall, weil er wie ein Pfad aussieht.
    expect(istInterneRoute('//example.org')).toBe(false);
    expect(istInterneRoute('//example.org/dashboard')).toBe(false);
  });

  it('weist den Backslash-Trick ab', () => {
    // Manche Browser lesen `/\example.org` wie `//example.org`.
    expect(istInterneRoute('/\\example.org')).toBe(false);
  });

  it('weist Schemata ohne Schrägstrich ab', () => {
    for (const boese of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c']) {
      expect(istInterneRoute(boese), boese).toBe(false);
    }
  });

  it('weist Steuerzeichen ab', () => {
    // Ein eingeschobenes `\n` trennt Prüfung und Verwendung.
    expect(istInterneRoute('/tickets\n/evil')).toBe(false);
    expect(istInterneRoute('/tickets\u0000')).toBe(false);
  });

  it('weist leere, zu lange und nicht-textuelle Werte ab', () => {
    expect(istInterneRoute('')).toBe(false);
    expect(istInterneRoute(`/${'a'.repeat(600)}`)).toBe(false);
    expect(istInterneRoute(undefined)).toBe(false);
    expect(istInterneRoute(null)).toBe(false);
    expect(istInterneRoute(42)).toBe(false);
  });

  it('lässt interne Adressen mit Abfrage und Fragment durch', () => {
    // Genau das ist der Kontext, der erhalten bleiben soll.
    expect(istInterneRoute('/tickets/offen?status=open&page=3&q=manuel')).toBe(true);
    expect(istInterneRoute('/members?rolle=123#liste')).toBe(true);
  });

  it('fällt auf den kanonischen Elternbereich zurück, statt zu folgen', () => {
    expect(sichereRueckkehr('https://external-site.example', '/tickets')).toBe('/tickets');
    expect(sichereRueckkehr(undefined, '/members')).toBe('/members');
    expect(sichereRueckkehr('/tickets/offen?page=3', '/tickets')).toBe('/tickets/offen?page=3');
  });
});

describe('Die Adresse der Liste reist mit', () => {
  it('hängt den Rückweg an ein Detailziel', () => {
    expect(mitRueckkehr('/tickets/abc', '/tickets/offen?page=3')).toBe(
      `/tickets/abc?${RUECKKEHR_PARAM}=${encodeURIComponent('/tickets/offen?page=3')}`,
    );
  });

  it('hängt ihn mit `&` an, wenn das Ziel schon eine Abfrage hat', () => {
    expect(mitRueckkehr('/members/1?tab=verlauf', '/members?q=a')).toContain('?tab=verlauf&von=');
  });

  it('lässt ein Fragment am Ende stehen', () => {
    expect(mitRueckkehr('/tickets/abc#verlauf', '/tickets')).toBe(
      `/tickets/abc?${RUECKKEHR_PARAM}=${encodeURIComponent('/tickets')}#verlauf`,
    );
  });

  it('hängt nichts an, wenn der Rückweg unbrauchbar ist', () => {
    expect(mitRueckkehr('/tickets/abc', 'https://external-site.example')).toBe('/tickets/abc');
    expect(mitRueckkehr('/tickets/abc', null)).toBe('/tickets/abc');
  });

  it('schaukelt sich nicht auf', () => {
    // Die Liste trägt ihren eigenen Vorgänger nicht mit - sonst wäre die
    // Adresse nach fünf Schritten länger als ein Browserfeld.
    const kontext = listenKontext('/tickets/offen', {
      status: 'open',
      page: '3',
      [RUECKKEHR_PARAM]: '/tickets',
    });
    expect(kontext).not.toContain(RUECKKEHR_PARAM);
    expect(kontext).toBe('/tickets/offen?status=open&page=3');
  });
});

describe('Was in den Kontext gehört', () => {
  it('nimmt Filter, Suche, Sortierung und Seitenzahl mit', () => {
    expect(listenKontext('/tickets/offen', { status: 'open', q: 'manuel', page: '3', sort: 'updated' })).toBe(
      '/tickets/offen?status=open&q=manuel&page=3&sort=updated',
    );
  });

  it('lässt leere und fehlende Werte weg', () => {
    expect(listenKontext('/members', { q: '', rolle: undefined, seite: '2' })).toBe('/members?seite=2');
  });

  it('kommt ohne Parameter mit dem blanken Pfad zurück', () => {
    expect(listenKontext('/tickets/offen', {})).toBe('/tickets/offen');
  });

  it('nimmt mehrfach gesetzte Parameter vollständig mit', () => {
    expect(listenKontext('/kalender', { kategorie: ['a', 'b'] })).toBe('/kalender?kategorie=a&kategorie=b');
  });

  it('liest aus den Suchparametern nur einen geprüften Rückweg', () => {
    expect(rueckkehrAus({ von: '/tickets/offen?page=3' })).toBe('/tickets/offen?page=3');
    expect(rueckkehrAus({ von: 'https://external-site.example' })).toBeNull();
    expect(rueckkehrAus(undefined)).toBeNull();
  });
});

describe('Die Module geben den Kontext weiter', () => {
  it('Tickets: Liste hängt ihn an, Detailseite liest ihn', () => {
    expect(lies('apps/web/src/modules/tickets/components/ticket-list.tsx')).toContain(
      'mitRueckkehr(systemRoutes.ticket(ticket.id), kontext)',
    );
    for (const seite of ['offen', 'meine', 'archiv']) {
      expect(lies(`apps/web/src/app/(app)/tickets/${seite}/page.tsx`), seite).toContain('listenKontext(');
    }
    expect(lies('apps/web/src/app/(app)/tickets/[ticketId]/page.tsx')).toContain(
      '<ZurueckLink von={von} fallback={systemRoutes.tickets()}',
    );
  });

  it('Mitglieder: die Karte hängt ihn an, die Akte behält ihn über die Reiter', () => {
    expect(lies('apps/web/src/components/shared/member-card.tsx')).toContain(
      'mitRueckkehr(systemRoutes.mitglied(member.discordId), kontext)',
    );
    expect(lies('apps/web/src/app/(app)/members/page.tsx')).toContain("listenKontext('/members'");
    // Ohne das verlöre ein Klick auf «Verlauf» den Weg zurück in die Liste.
    expect(lies('apps/web/src/modules/members/components/mitglieds-akte.tsx')).toContain(
      "${von ? `&von=${encodeURIComponent(von)}` : ''}",
    );
  });

  it('Moderation: die Jail-Liste hängt ihn an, der Vorgang liest ihn', () => {
    const liste = lies('apps/web/src/app/(app)/moderation/jail/page.tsx');
    expect(liste).toContain('mitRueckkehr(systemRoutes.jail(entry.id), kontext)');
    expect(liste).toContain('listenKontext(systemRoutes.jails(), params)');
    expect(lies('apps/web/src/app/(app)/moderation/jail/[id]/page.tsx')).toContain(
      'sichereRueckkehr(von, systemRoutes.jails())',
    );
  });

  it('Kalender: Zeitraum und Ansicht reisen an jedem Termin mit', () => {
    expect(lies('apps/web/src/modules/calendar/components/shared.tsx')).toContain(
      'mitRueckkehr(systemRoutes.event(zeile.slug), kontext)',
    );
    expect(lies('apps/web/src/app/(app)/kalender/page.tsx')).toContain(
      'listenKontext(systemRoutes.kalender(), params)',
    );
    expect(lies('apps/web/src/app/(app)/kalender/[slug]/page.tsx')).toContain(
      '<ZurueckLink von={von} fallback={systemRoutes.kalender()}',
    );
  });
});

describe('Die Adresse bleibt die Quelle der Wahrheit', () => {
  it('sucht und filtert weiterhin über ein GET-Formular', () => {
    // Damit funktionieren Zurück, Vorwärts und Neuladen von selbst - ein
    // globaler Zustand, der dasselbe noch einmal nachhält, wäre die zweite
    // Wahrheit.
    expect(lies('apps/web/src/modules/tickets/components/ticket-filters.tsx')).toContain('method="get"');
    // Die Mitgliedersuche nennt kein `method` - das ist HTML-seitig GET und
    // tut dasselbe. Geprueft wird deshalb, dass sie nicht absendet, sondern
    // ihren Zustand weiterhin aus der Adresse liest.
    const mitglieder = lies('apps/web/src/app/(app)/members/page.tsx');
    expect(mitglieder).not.toContain('method="post"');
    expect(mitglieder).toContain('querySchema.parse(roheSuche)');
    expect(mitglieder).toContain('defaultValue={params.q}');
  });

  it('blättert weiterhin über Links mit Adresse', () => {
    const blaetterung = lies('apps/web/src/components/shared/pagination.tsx');
    expect(blaetterung).toContain('href={buildHref(page - 1)}');
    expect(blaetterung).toContain('href={buildHref(page + 1)}');
  });

  it('überlässt die Scrollposition dem Router', () => {
    // Der App Router stellt sie bei Zurück und Vorwärts selbst wieder her.
    // Eine eigene Scroll-Engine daneben wäre ein zweites System für etwas,
    // das der Browser bereits kann - und sie geriete mit ihm in Streit.
    const zurueck = lies('apps/web/src/components/shared/zurueck-link.tsx');
    expect(zurueck).toContain('<Link');
    expect(zurueck).not.toContain('scrollTo');
    expect(zurueck).not.toContain('scroll={false}');
  });
});

describe('Der Rückweg heisst nach dem Bereich, in den er führt', () => {
  it('nimmt die Beschriftung aus der Module Registry', () => {
    // Eine zweite Liste von Pfad zu Beschriftung liefe beim ersten
    // umbenannten Bereich auseinander.
    expect(lies('apps/web/src/components/shared/zurueck-link.tsx')).toContain('routenBezeichnung(ziel)');
  });

  it('hat immer einen Rückfall', () => {
    // Eine Detailseite, die man über einen Deep Link aus Discord betritt, hat
    // keinen Kontext - und braucht trotzdem einen Weg nach oben.
    expect(lies('apps/web/src/components/shared/zurueck-link.tsx')).toContain(
      'sichereRueckkehr(von, fallback)',
    );
  });
});
