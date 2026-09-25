#!/usr/bin/env python3
"""Die Digests der laufenden Container.

Liest auf der Standardeingabe Zeilen der Form

    <name>|<abbild>|<container-id>

wie `docker ps --format '{{.Names}}|{{.Image}}|{{.ID}}'` sie ausgibt, und gibt
ein JSON-Objekt {name: {abbild, digest}} aus.

WARUM DER DIGEST UND NICHT DER NAME

`swisshub-web:latest` sagt nach einem halben Jahr nichts mehr: `latest` ist
dann ein anderes Abbild. Bei einer Wiederherstellung will man aber genau das
Abbild, das gelaufen ist - sonst kombiniert man wiederhergestellte Daten mit
einer anderen Anwendungsfassung, und dieser Unterschied ist der schwerste zu
findende.
"""

import json
import subprocess
import sys


def digest_von(kennung: str) -> str:
    try:
        return subprocess.run(
            ["docker", "inspect", "--format", "{{.Image}}", kennung],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
    except Exception:
        return ""


def main() -> int:
    ergebnis = {}
    for zeile in sys.stdin:
        teile = zeile.strip().split("|")
        if len(teile) != 3:
            continue
        name, abbild, kennung = teile
        ergebnis[name] = {"abbild": abbild, "digest": digest_von(kennung)}
    print(json.dumps(ergebnis, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
