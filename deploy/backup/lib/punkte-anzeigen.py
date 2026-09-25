#!/usr/bin/env python3
"""Die Wiederherstellungspunkte als Tabelle fuer die Kommandozeile.

Liest `pgbackrest --output=json info` auf der Standardeingabe.

Eine eigene Datei und kein eingebettetes Here-Dokument: ein
`printf | python3 - <<'PY'` hat ZWEI Quellen fuer die Standardeingabe, und die
zweite gewinnt. Python liest dann das Programm aus dem Here-Dokument und findet
auf `sys.stdin` nichts mehr - der Aufruf scheitert mit einem
JSONDecodeError, mitten in der Wiederherstellung, wenn man die Liste am
dringendsten braucht. Genau so ist es in der ersten Uebung passiert.
"""

import datetime
import json
import sys


def zeit(wert):
    if not wert:
        return "?"
    return datetime.datetime.fromtimestamp(wert).strftime("%Y-%m-%d %H:%M:%S")


def groesse(bytes_):
    if not bytes_:
        return "?"
    wert = float(bytes_)
    for einheit in ["B", "KiB", "MiB", "GiB", "TiB"]:
        if wert < 1024 or einheit == "TiB":
            return "%.1f %s" % (wert, einheit)
        wert /= 1024
    return "?"


def main() -> int:
    try:
        daten = json.load(sys.stdin)
    except Exception as fehler:
        print("  Die Auskunft von pgBackRest war nicht lesbar: %s" % fehler)
        print()
        print("  Haeufigste Ursachen:")
        print("    - Die Repository-Zugangsdaten stimmen nicht. Fuer eine")
        print("      Wiederherstellung werden die LESENDEN gebraucht.")
        print("    - SWISSHUB_PGBACKREST_CIPHER_PASS ist falsch. Ohne das richtige")
        print("      Passwort ist das Repository nicht lesbar, und der Fehler sieht")
        print("      aus wie ein Verbindungsfehler.")
        print("    - pgBackRest laeuft nicht als der Benutzer, der die")
        print("      Konfigurationsdatei lesen darf (sie ist 0640).")
        return 1

    if not daten:
        print("  Keine Stanza im Repository gefunden.")
        return 1

    for stanza in daten:
        zustand = stanza.get("status", {})
        print("  Stanza: %s   Zustand: %s" % (stanza.get("name"), zustand.get("message", "?")))
        for datenbank in stanza.get("db", []):
            print(
                "  PostgreSQL-Version der Sicherung: %s  (System-ID %s)"
                % (datenbank.get("version"), datenbank.get("system-id"))
            )
        print("  Verschluesselung des Repositories: %s" % stanza.get("cipher", "keine"))
        print()

        # Zugeordnet wird ueber `database.id` - `archive[].id` ist die Kennung
        # der Datenbankhistorie («16-1») und NICHT die Zeitlinie.
        spanne = {
            eintrag.get("database", {}).get("id"): (eintrag.get("min"), eintrag.get("max"))
            for eintrag in stanza.get("archive", [])
        }

        print(
            "  %-20s %-5s %-21s %-21s %-10s %s"
            % ("Sicherung", "Typ", "Beginn", "Ende", "Groesse", "WAL-Kette")
        )
        print("  " + "-" * 100)

        sicherungen = stanza.get("backup", [])
        for sicherung in sicherungen:
            stempel = sicherung.get("timestamp", {})
            archiv = sicherung.get("archive", {})
            von, bis = spanne.get(sicherung.get("database", {}).get("id"), (None, None))
            start, stop = archiv.get("start"), archiv.get("stop")

            if not start or von is None:
                kette = "FEHLT"
            elif start < (von or "") or (bis and stop > bis):
                kette = "UNVOLLSTAENDIG"
            else:
                kette = "vollstaendig"

            print(
                "  %-20s %-5s %-21s %-21s %-10s %s"
                % (
                    sicherung.get("label", "?"),
                    sicherung.get("type", "?"),
                    zeit(stempel.get("start")),
                    zeit(stempel.get("stop")),
                    groesse(sicherung.get("info", {}).get("repository", {}).get("delta")),
                    kette,
                )
            )

        if sicherungen:
            aeltestes_ende = min(
                sicherung.get("timestamp", {}).get("stop", 0) for sicherung in sicherungen
            )
            print()
            print("  ANSTEUERBARER ZEITRAUM")
            print("  Ein Zeitpunkt ist erreichbar, wenn er NACH dem Ende des")
            print("  aeltesten Basis-Backups liegt und die WAL-Kette bis dorthin")
            print("  reicht:")
            print()
            print("      frueheste:  %s" % zeit(aeltestes_ende))
            print("      spaeteste:  bis zum jungsten archivierten WAL-Segment")
            print()
            for kennung, (von, bis) in spanne.items():
                print("      WAL-Archiv (Historie %s): %s .. %s" % (kennung, von, bis))

    return 0


if __name__ == "__main__":
    sys.exit(main())
