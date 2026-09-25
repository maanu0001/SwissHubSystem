#!/usr/bin/env python3
"""Stellt die Liste der Wiederherstellungspunkte zusammen.

Erwartet zwei Umgebungsvariablen mit JSON:

    SWISSHUB_PG_JSON       Ausgabe von `pgbackrest --output=json info`
    SWISSHUB_RESTIC_JSON   Ausgabe von `restic snapshots --json`

Gibt ein JSON-Objekt aus, das das Recovery Center im Dashboard direkt anzeigt.

WARUM DIE LISTE NICHT SELBST GEFUEHRT WIRD

Sie kommt aus pgBackRest und Restic selbst. Eine eigene Buchhaltung - eine
Tabelle, in die jeder Lauf einen Eintrag schreibt - liefe irgendwann
auseinander: ein abgebrochener Lauf, ein von Hand geloeschtes Backup, eine
Aufbewahrungsregel, und schon zeigt das Dashboard einen
Wiederherstellungspunkt an, den es nicht mehr gibt. Im Ernstfall waehlt
dann jemand genau diesen aus.

Die Werkzeuge wissen es besser als jede Kopie ihres Wissens.
"""

import datetime
import json
import os
import sys


def lade(name):
    try:
        return json.loads(os.environ.get(name) or "[]")
    except ValueError:
        return []


def iso(wert):
    if not wert:
        return None
    return datetime.datetime.fromtimestamp(wert, datetime.timezone.utc).isoformat()


def sammle(pg, snapshots):
    punkte = []
    aeltester = jungster = None
    wal_von = wal_bis = None
    postgres_version = None

    for stanza in pg if isinstance(pg, list) else []:
        datenbanken = stanza.get("db") or []
        if datenbanken:
            postgres_version = datenbanken[0].get("version")

        for sicherung in stanza.get("backup", []):
            zeit = sicherung.get("timestamp", {})
            beginn, ende = zeit.get("start"), zeit.get("stop")
            punkte.append({
                "art": "datenbank",
                "typ": sicherung.get("type"),
                "kennung": sicherung.get("label"),
                "beginn": iso(beginn),
                "ende": iso(ende),
                # `repository.delta` ist, was diese Sicherung im Repository
                # belegt; `size` waere die Groesse der Datenbank. Bei einem
                # inkrementellen Backup unterscheiden sich die beiden um
                # Groessenordnungen, und in einer Uebersicht ist der
                # Platzbedarf die interessante Zahl.
                "bytes": sicherung.get("info", {}).get("repository", {}).get("delta"),
                "bytes_datenbank": sicherung.get("info", {}).get("size"),
                "wal_von": sicherung.get("archive", {}).get("start"),
                "wal_bis": sicherung.get("archive", {}).get("stop"),
                # In welchem Repository sie liegt. Eine Sicherung, die nur in
                # Repository 1 liegt, ueberlebt den Serververlust nicht - und
                # genau das muss die Uebersicht zeigen, statt alle gleich
                # aussehen zu lassen.
                "repo": sicherung.get("database", {}).get("repo-key", 1),
                "postgres": postgres_version,
                "verschluesselt": bool(stanza.get("cipher")) and stanza.get("cipher") != "none",
                # Worauf diese Sicherung aufbaut. Ein inkrementelles Backup
                # ohne seinen Vorgaenger ist nicht wiederherstellbar, und im
                # Recovery Center soll man das sehen koennen, bevor man es
                # auswaehlt.
                "baut_auf": sicherung.get("prior"),
            })
            if beginn and (aeltester is None or beginn < aeltester):
                aeltester = beginn
            if ende and (jungster is None or ende > jungster):
                jungster = ende

        # Die WAL-Spanne ist die eigentliche Antwort auf «welchen Zeitpunkt
        # kann ich ansteuern». Ein Basis-Backup allein kann nur seinen eigenen
        # Endzeitpunkt.
        for archiv in stanza.get("archive", []):
            if archiv.get("min"):
                wal_von = archiv["min"] if wal_von is None else min(wal_von, archiv["min"])
            if archiv.get("max"):
                wal_bis = archiv["max"] if wal_bis is None else max(wal_bis, archiv["max"])

    for snapshot in snapshots if isinstance(snapshots, list) else []:
        marken = snapshot.get("tags") or []
        if "uploads" in marken:
            art = "dateien"
        elif "recovery" in marken:
            art = "schluessel"
        else:
            art = "konfiguration"
        punkte.append({
            "art": art,
            "typ": "snapshot",
            "kennung": snapshot.get("short_id") or (snapshot.get("id") or "")[:8],
            "beginn": snapshot.get("time"),
            "ende": snapshot.get("time"),
            "bytes": None,
            # Der Datenbankzeitpunkt, zu dem diese Dateisicherung gehoert.
            # Damit laesst sich im Recovery Center ein zusammenpassendes Paar
            # waehlen statt zweimal unabhaengig zu raten.
            "db_zeitpunkt": next((m[3:] for m in marken if m.startswith("db:")), None),
            "pfade": snapshot.get("paths", []),
            "repo": 1,
            "verschluesselt": True,
        })

    punkte.sort(key=lambda eintrag: eintrag.get("beginn") or "", reverse=True)

    return {
        "erhoben": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "aeltester": iso(aeltester),
        "jungster": iso(jungster),
        "wal_von": wal_von,
        "wal_bis": wal_bis,
        "postgres": postgres_version,
        "anzahl": len(punkte),
        # Nur die letzten 200: die Uebersicht blaettert nicht weiter zurueck,
        # und eine unbegrenzt wachsende Zustandsdatei ist ein spaeterer Fehler.
        "punkte": punkte[:200],
    }


def main() -> int:
    print(json.dumps(
        sammle(lade("SWISSHUB_PG_JSON"), lade("SWISSHUB_RESTIC_JSON")),
        ensure_ascii=False,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
