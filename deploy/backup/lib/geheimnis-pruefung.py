#!/usr/bin/env python3
"""Prueft, ob der Hauptschluessel die gespeicherten Geheimnisse oeffnet.

Liest auf der Standardeingabe eine Zeile je Geheimnis, Felder mit Tabulator
getrennt:

    scope <TAB> guildId <TAB> provider <TAB> key <TAB> ciphertext

Der Hauptschluessel kommt aus der Umgebungsvariablen SWISSHUB_MASTER_KEY -
nicht als Argument: Argumente stehen in der Prozessliste und waeren damit fuer
jeden auf dem System sichtbar.

Gibt eine Zeile aus:

    OK <gelesen> <gescheitert> <fremde_kennung> <kennung>

oder bei fehlender Voraussetzung:

    FEHLER <grund>

WARUM DAS HIER NACHGERECHNET WIRD

Dieselbe Rechnung steht in packages/secrets/src/crypto.ts. Sie hier ein
zweites Mal zu schreiben ist eine bewusste Doppelung, und sie hat einen Grund:
der Restore-Test muss ohne Node, ohne Prisma und ohne die Anwendung
funktionieren. Er laeuft gegen eine isolierte Datenbank, und die Anwendung
dort zu starten ist genau das, was er nicht tun darf.

Die Kopie ist gegen Auseinanderlaufen abgesichert:
tests/unit/backup-geheimnis-pruefung.test.ts erzeugt einen Umschlag mit der
echten Implementierung aus @swisshub/secrets und laesst ihn von diesem Skript
lesen. Weichen die beiden voneinander ab, faellt der Test.
"""

import base64
import binascii
import hashlib
import os
import sys


def schluessel_lesen(roh: str) -> bytes:
    """Wie readMasterKey() in packages/secrets/src/crypto.ts.

    Erlaubt sind 32 rohe Bytes als hex oder base64 - genau das, was
    `openssl rand -hex 32` bzw. `-base64 32` ausgibt. Eine Passphrase wird
    bewusst nicht abgeleitet: sie waere bequemer und deutlich schwaecher.
    """
    roh = (roh or "").strip()
    kandidaten = []
    if len(roh) == 64:
        try:
            kandidaten.append(binascii.unhexlify(roh))
        except (binascii.Error, ValueError):
            pass
    try:
        kandidaten.append(base64.b64decode(roh + "=" * (-len(roh) % 4)))
    except Exception:
        pass
    for kandidat in kandidaten:
        if len(kandidat) == 32:
            return kandidat
    return b""


def kennung_von(schluessel: bytes) -> str:
    """Die ersten acht Zeichen eines SHA-256 - wie keyId() in crypto.ts."""
    return hashlib.sha256(schluessel).hexdigest()[:8]


def b64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def anhang_von(bereich: str, guild: str, anbieter: str, feld: str) -> bytes:
    """Der Authentifizierungsanhang - wie aad() in crypto.ts.

    Getrennt wird mit einem Nullbyte und nicht mit einem Leerzeichen: ein
    Anbieter «a» mit Feld «b c» und ein Anbieter «a b» mit Feld «c» ergaeben
    sonst denselben Anhang, und zwischen diesen beiden Zeilen waere ein Tausch
    des Geheimtexts moeglich.
    """
    return "\u0000".join([bereich, guild, anbieter, feld]).encode("utf-8")


def main() -> int:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        print("FEHLER python3-cryptography-fehlt")
        return 2

    schluessel = schluessel_lesen(os.environ.get("SWISSHUB_MASTER_KEY", ""))
    if len(schluessel) != 32:
        print("FEHLER schluessel-ergibt-keine-32-bytes")
        return 2

    kennung = kennung_von(schluessel)
    aesgcm = AESGCM(schluessel)

    gelesen = 0
    gescheitert = 0
    fremd = 0

    for zeile in sys.stdin:
        zeile = zeile.rstrip("\n")
        if not zeile:
            continue
        teile = zeile.split("\t")
        if len(teile) != 5:
            continue
        bereich, guild, anbieter, feld, umschlag = teile

        stuecke = umschlag.split(".")
        if len(stuecke) != 5:
            gescheitert += 1
            continue
        _version, umschlag_kennung, iv, tag, geheimtext = stuecke

        # Erst die Kennung. Ein Umschlag mit fremder Kennung ist kein
        # beschaedigter Umschlag, sondern einer aus einer anderen
        # Schluesselgeneration - das ist ein anderer Befund und muss getrennt
        # gezaehlt werden.
        if umschlag_kennung != kennung:
            fremd += 1
            continue

        try:
            # AES-GCM in Python erwartet Geheimtext und Tag aneinander.
            aesgcm.decrypt(
                b64url(iv),
                b64url(geheimtext) + b64url(tag),
                anhang_von(bereich, guild, anbieter, feld),
            )
            gelesen += 1
        except Exception:
            gescheitert += 1

    print("OK %d %d %d %s" % (gelesen, gescheitert, fremd, kennung))
    return 0


if __name__ == "__main__":
    sys.exit(main())
