#!/usr/bin/env python3
"""Fasst alle Zustandsdateien zu einer Antwort zusammen.

Aufruf:  status.py <zustandsverzeichnis>

Liest jede *.json im Verzeichnis und die letzten Zeilen von laeufe.jsonl und
gibt alles als ein JSON-Objekt aus. Genau das liest die WebApp.

WARUM DER ZUSTAND IN DATEIEN LIEGT UND NICHT IN DER DATENBANK

Der Ernstfall ist der, in dem die Datenbank kaputt ist. Das ist der Moment, in
dem jemand wissen muss, welche Sicherungen es gibt. Eine Backup-Uebersicht, die
dafuer die Datenbank braeuchte, antwortete genau dann nicht, wenn man sie
braucht.

Deshalb Dateien - und deshalb liest die WebApp sie nur, schreibend kommt sie
nicht heran.
"""

import glob
import json
import os
import sys


def sammle(verzeichnis):
    ergebnis = {}
    for pfad in sorted(glob.glob(os.path.join(verzeichnis, "*.json"))):
        name = os.path.basename(pfad)[:-5]
        try:
            with open(pfad, encoding="utf-8") as datei:
                ergebnis[name] = json.load(datei)
        except Exception as fehler:
            # Eine unlesbare Zustandsdatei ist eine Auskunft und kein Grund,
            # die ganze Antwort zu verweigern - sonst faellt mit einer
            # beschaedigten Datei die ganze Uebersicht aus.
            ergebnis[name] = {"fehler": str(fehler)}

    verlauf = os.path.join(verzeichnis, "laeufe.jsonl")
    ergebnis["laeufe"] = []
    if os.path.exists(verlauf):
        try:
            with open(verlauf, encoding="utf-8") as datei:
                zeilen = datei.readlines()[-200:]
        except Exception:
            zeilen = []
        # Neueste zuerst - so liest sie auch die Uebersicht.
        for zeile in reversed(zeilen):
            try:
                ergebnis["laeufe"].append(json.loads(zeile))
            except ValueError:
                # Eine abgebrochene letzte Zeile kostet genau diese Zeile.
                continue
    return ergebnis


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"fehler": "Kein Zustandsverzeichnis angegeben."}))
        return 64
    print(json.dumps(sammle(sys.argv[1]), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
