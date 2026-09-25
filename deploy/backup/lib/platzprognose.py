#!/usr/bin/env python3
"""Wie lange reicht der Platz noch?

Aufruf:  platzprognose.py <zustandsverzeichnis> <freie_gb>

Gibt aus:  "<tage> <begruendung>"  oder  "unbekannt"

WARUM EINE PROGNOSE UND NICHT NUR EIN SCHWELLWERT

«Noch 12 GB frei» sagt nicht, ob das viel ist. Ein Laufwerk, das taeglich um
3 GB waechst, ist in vier Tagen voll - und ein volles Laufwerk nimmt PostgreSQL
und damit den Bot mit. Die Warnung muss kommen, solange noch Zeit zum Handeln
ist, und dafuer braucht es das Wachstum und nicht den Stand.

Gerechnet wird aus den Laufeintraegen der letzten Tage: die Summe der
geschriebenen Bytes je Tag ist das Wachstum. Das ist eine groebere Schaetzung
als eine Messung des Dateisystems, aber sie hat einen Vorteil, der schwerer
wiegt: sie waechst mit den Sicherungen und nicht mit allem, was sonst auf dem
Laufwerk passiert.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone


def lade_laeufe(verzeichnis: str):
    pfad = os.path.join(verzeichnis, "laeufe.jsonl")
    if not os.path.exists(pfad):
        return []
    eintraege = []
    try:
        with open(pfad, encoding="utf-8") as datei:
            for zeile in datei.readlines()[-1000:]:
                try:
                    eintraege.append(json.loads(zeile))
                except ValueError:
                    continue
    except OSError:
        return []
    return eintraege


def wachstum_pro_tag(eintraege) -> float:
    """Die geschriebenen Bytes je Tag, gemittelt ueber die vorhandenen Tage."""
    je_tag = defaultdict(int)
    grenze = datetime.now(timezone.utc) - timedelta(days=14)

    for eintrag in eintraege:
        if eintrag.get("status") != "erfolg":
            continue
        bytes_ = eintrag.get("bytes") or 0
        if not isinstance(bytes_, (int, float)) or bytes_ <= 0:
            continue
        roh = eintrag.get("beginn") or ""
        try:
            zeit = datetime.fromisoformat(str(roh).replace("Z", "+00:00"))
        except ValueError:
            continue
        if zeit.tzinfo is None:
            zeit = zeit.replace(tzinfo=timezone.utc)
        if zeit < grenze:
            continue
        je_tag[zeit.date()] += int(bytes_)

    if len(je_tag) < 2:
        # Mit einem einzigen Tag ist keine Richtung erkennbar, und eine
        # Prognose aus einem Punkt waere geraten.
        return 0.0
    return sum(je_tag.values()) / len(je_tag)


def main() -> int:
    if len(sys.argv) < 3:
        print("unbekannt")
        return 64

    verzeichnis = sys.argv[1]
    try:
        frei_gb = float(sys.argv[2])
    except ValueError:
        print("unbekannt")
        return 0

    pro_tag = wachstum_pro_tag(lade_laeufe(verzeichnis))
    if pro_tag <= 0:
        print("unbekannt")
        return 0

    pro_tag_gb = pro_tag / (1024 ** 3)
    if pro_tag_gb < 0.001:
        print("unbekannt")
        return 0

    tage = int(frei_gb / pro_tag_gb)
    print("%d Wachstum etwa %.2f GB pro Tag, %.1f GB frei" % (tage, pro_tag_gb, frei_gb))
    return 0


if __name__ == "__main__":
    sys.exit(main())
