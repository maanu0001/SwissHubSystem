#!/usr/bin/env python3
"""Prueft, ob Basis-Backups und WAL-Archiv eine lueckenlose Kette bilden.

Liest auf der Standardeingabe die Ausgabe von

    pgbackrest --stanza=<name> --output=json info

und gibt ein JSON-Objekt aus:

    {"in_ordnung": [...], "schwer": [...], "archiv_spanne": {...},
     "ansteuerbar_ab": "<ISO>"}

WARUM DIESE PRUEFUNG DIE WICHTIGSTE DER VIER STUFEN IST

Ein Basis-Backup allein stellt genau einen Zeitpunkt her: den seines eigenen
Endes. Jeden anderen erreicht man nur, wenn die WAL-Segmente von diesem
Backup bis zum Ziel LUECKENLOS vorliegen. Fehlt eines in der Mitte, endet die
Wiederherstellung dort - und zwar ohne dass eine Uebersicht vorher etwas
gesagt haette. In jeder Liste sieht so ein Backup aus wie ein Backup.

WORAUF ES BEI DER ZUORDNUNG ANKOMMT

`archive[].id` ist die Kennung der Datenbankhistorie im Format
«<version>-<db-id>», also etwa «16-1». Sie ist NICHT die Zeitlinie. Wer sie
mit den ersten acht Zeichen eines WAL-Dateinamens vergleicht - das ist die
Zeitlinie - findet nie eine Uebereinstimmung und meldet dann eine
unterbrochene Kette bei vollstaendig intakter Kette.

Zugeordnet wird deshalb ueber `database.id`, die beide Seiten tragen.
"""

import datetime
import json
import sys


def pruefe(daten):
    in_ordnung = []
    schwer = []
    spanne = {}
    aeltestes_ende = None

    for stanza in daten if isinstance(daten, list) else []:
        zustand = stanza.get("status", {})
        if zustand.get("code", 0) != 0:
            schwer.append(
                "pgBackRest meldet fuer die Stanza «%s»: %s"
                % (stanza.get("name", "?"), zustand.get("message", "?"))
            )

        for eintrag in stanza.get("archive", []):
            spanne[str(eintrag.get("database", {}).get("id"))] = {
                "von": eintrag.get("min"),
                "bis": eintrag.get("max"),
                "historie": eintrag.get("id"),
            }

        for sicherung in stanza.get("backup", []):
            label = sicherung.get("label", "?")
            archiv = sicherung.get("archive", {})
            start, stop = archiv.get("start"), archiv.get("stop")

            ende = sicherung.get("timestamp", {}).get("stop")
            if ende and (aeltestes_ende is None or ende < aeltestes_ende):
                aeltestes_ende = ende

            if not start or not stop:
                schwer.append(
                    "Sicherung %s nennt keine WAL-Spanne - sie ist nicht auf "
                    "einen Zeitpunkt zurueckfuehrbar." % label
                )
                continue

            historie = str(sicherung.get("database", {}).get("id"))
            vorhanden = spanne.get(historie)
            if not vorhanden:
                schwer.append(
                    "Fuer Sicherung %s (Datenbankhistorie %s) liegt kein "
                    "WAL-Archiv vor. Sie stellt nur ihren eigenen "
                    "Endzeitpunkt her, keinen anderen." % (label, historie)
                )
                continue

            # Verglichen wird lexikografisch. WAL-Dateinamen sind dafuer
            # gebaut: feste Laenge, Hexziffern, aufsteigend.
            if vorhanden["von"] and start < vorhanden["von"]:
                schwer.append(
                    "Sicherung %s beginnt bei WAL %s, das Archiv erst bei %s. "
                    "Der Anfang der Kette fehlt - diese Sicherung ist nicht "
                    "wiederherstellbar." % (label, start, vorhanden["von"])
                )
            elif vorhanden["bis"] and stop > vorhanden["bis"]:
                schwer.append(
                    "Sicherung %s endet bei WAL %s, das Archiv nur bei %s. Die "
                    "Sicherung ist unvollstaendig archiviert."
                    % (label, stop, vorhanden["bis"])
                )
            else:
                in_ordnung.append(
                    "Sicherung %s: WAL %s..%s liegt vollstaendig vor."
                    % (label, start, stop)
                )

    return {
        "in_ordnung": in_ordnung,
        "schwer": schwer,
        "archiv_spanne": spanne,
        # Ab wann ein Zeitpunkt ueberhaupt ansteuerbar ist: das Ende des
        # aeltesten noch vorhandenen Basis-Backups. Alles davor ist nicht
        # erreichbar, auch wenn WAL dafuer vorliegt.
        "ansteuerbar_ab": (
            datetime.datetime.fromtimestamp(
                aeltestes_ende, datetime.timezone.utc
            ).isoformat()
            if aeltestes_ende
            else None
        ),
    }


def main() -> int:
    try:
        daten = json.load(sys.stdin)
    except Exception as fehler:
        print(json.dumps({
            "in_ordnung": [],
            "schwer": ["pgbackrest info war nicht lesbar: %s" % fehler],
            "archiv_spanne": {},
            "ansteuerbar_ab": None,
        }))
        return 1
    print(json.dumps(pruefe(daten), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
