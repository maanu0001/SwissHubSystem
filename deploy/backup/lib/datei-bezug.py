#!/usr/bin/env python3
"""Passen Dateisicherungen und Datenbank-Wiederherstellungspunkte zusammen?

Aufruf:

    restic snapshots --json | datei-bezug.py <wiederherstellungspunkte.json>

Gibt eine Zeile aus:

    stimmig
    keine-dateisicherung
    ohne-passende-dateien:<kennung>,<kennung>,...

DIE REGEL, UM DIE ES GEHT

Die Uploads dieser Anwendung werden unter serverseitig erzeugten Namen genau
einmal geschrieben und danach nie geaendert (siehe
packages/modules/src/branding/storage.ts). Daraus folgt:

    Eine Dateisicherung, die NICHT AELTER ist als der Zielzeitpunkt der
    Datenbank, enthaelt jede Datei, auf die diese Datenbank verweist.

Umgekehrt gilt es nicht. Eine aeltere Dateisicherung laesst Verweise ins
Leere zeigen: ein wiederhergestelltes Ticket mit einem Verlauf, den es nicht
mehr gibt. Ueberzaehlige Dateien dagegen sind harmlos - Waisen, die nichts
kaputt machen.

Deshalb muss nicht eingefroren werden. Es muss nur der richtige Snapshot
gewaehlt werden, und dafuer ist diese Pruefung da.
"""

import datetime
import json
import sys


def zeit(roh):
    if not roh:
        return None
    try:
        wert = datetime.datetime.fromisoformat(str(roh).replace("Z", "+00:00"))
    except ValueError:
        return None
    if wert.tzinfo is None:
        wert = wert.replace(tzinfo=datetime.timezone.utc)
    return wert


def pruefe(snapshots, punkte):
    datei_zeiten = sorted(
        filter(
            None,
            (
                zeit(snapshot.get("time"))
                for snapshot in snapshots
                if "uploads" in (snapshot.get("tags") or [])
            ),
        )
    )
    if not datei_zeiten:
        return "keine-dateisicherung"

    ohne = []
    for punkt in punkte:
        if punkt.get("art") != "datenbank":
            continue
        ende = zeit(punkt.get("ende"))
        if ende is None:
            continue
        if not any(datei >= ende for datei in datei_zeiten):
            kennung = punkt.get("kennung")
            if kennung:
                ohne.append(kennung)

    if ohne:
        return "ohne-passende-dateien:" + ",".join(ohne[:3])
    return "stimmig"


def main() -> int:
    try:
        snapshots = json.load(sys.stdin)
    except Exception:
        print("unbekannt")
        return 1
    if not isinstance(snapshots, list):
        print("unbekannt")
        return 1

    punkte = []
    if len(sys.argv) > 1:
        try:
            punkte = json.loads(sys.argv[1]).get("punkte", [])
        except Exception:
            punkte = []

    print(pruefe(snapshots, punkte))
    return 0


if __name__ == "__main__":
    sys.exit(main())
