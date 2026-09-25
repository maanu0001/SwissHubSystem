#!/usr/bin/env python3
"""Die Treffer von `restic find --json` als Tabelle.

Liest die JSON-Ausgabe auf der Standardeingabe. Eigene Datei aus demselben
Grund wie punkte-anzeigen.py: ein Here-Dokument in einer Pipe kaempft mit ihr um
die Standardeingabe.
"""

import json
import sys


def main() -> int:
    try:
        daten = json.load(sys.stdin)
    except Exception:
        print("  Die Antwort von restic war nicht lesbar.")
        return 1

    zeilen = []
    for eintrag in daten:
        snapshot = (eintrag.get("snapshot") or "")[:8]
        for treffer in eintrag.get("matches", []):
            zeilen.append(
                (
                    treffer.get("mtime", ""),
                    snapshot,
                    treffer.get("path", ""),
                    treffer.get("size", 0),
                )
            )

    if not zeilen:
        print("  Nichts gefunden.")
        return 1

    # Neueste zuerst: die gesuchte Datei ist meist die, die zuletzt bestand.
    zeilen.sort(reverse=True)
    print("  %-10s %-21s %-10s %s" % ("Snapshot", "Geaendert", "Groesse", "Pfad"))
    print("  " + "-" * 96)
    for mtime, snapshot, pfad, groesse in zeilen[:25]:
        print("  %-10s %-21s %-10s %s" % (snapshot, mtime[:19], groesse, pfad))
    if len(zeilen) > 25:
        print("  ... und %d weitere" % (len(zeilen) - 25))
    return 0


if __name__ == "__main__":
    sys.exit(main())
