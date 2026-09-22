"""Suche und Aufloesung.

Uebernommen aus dem Legacy-Bot, weil es dort nachweislich funktioniert:
ytmusicapi liefert die schnelle Suche, yt-dlp folgt den YouTube-Aenderungen.
Die Optionen sind bewusst identisch zum Original - `noplaylist`, kurze
Timeouts, wenige Wiederholungen.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from ytmusicapi import YTMusic

YTDLP_OPTS = {
    "format": "bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "default_search": "ytsearch",
    "source_address": "0.0.0.0",
    "socket_timeout": 10,
    "noplaylist": True,
    "extractor_retries": 2,
}

FFMPEG_OPTS = {
    "before_options": "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
    "options": "-vn",
}


def ffmpeg_opts(versatz: int = 0) -> dict:
    """FFmpeg-Optionen, wahlweise mit Startversatz.

    `-ss` steht vor der Eingabe, nicht danach: dort spult FFmpeg im Strom
    vor, statt alles davor zu dekodieren und wegzuwerfen. Bei einem Sprung
    in die Mitte eines langen Titels ist das der Unterschied zwischen
    sofort und mehreren Sekunden Stille.

    Der Wert wird als ganze Zahl eingesetzt und ist nach oben begrenzt. Er
    kommt zwar aus der eigenen Anwendung und nicht von aussen, aber er landet
    in einer Kommandozeile - eine Zahl bleibt eine Zahl, und mehr als ein Tag
    ergibt bei keinem Titel Sinn.
    """
    sekunden = max(0, min(int(versatz), 24 * 3600))
    if sekunden == 0:
        return dict(FFMPEG_OPTS)
    return {
        "before_options": f"-ss {sekunden} {FFMPEG_OPTS['before_options']}",
        "options": FFMPEG_OPTS["options"],
    }

# Nur diese Hosts. Dieselbe Liste wie in der WebApp - der Schutz gegen
# SSRF darf nicht davon abhaengen, welche Seite gerade prueft.
ERLAUBTE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

_ytmusic = YTMusic()


def _extrahiere(url: str) -> Any:
    """yt-dlp aufrufen - mit einer eigenen Instanz je Aufruf.

    Frueher stand hier eine einzige, modulweit geteilte `YoutubeDL`. Benutzt
    wurde sie aus `run_in_executor`, also aus wechselnden Threads und bei
    mehreren Bots auch gleichzeitig. yt-dlp sichert seinen inneren Zustand -
    Cookies, Caches, Fortschrittshaken - dabei nicht ab; zwei parallele
    Aufloesungen konnten sich gegenseitig stoeren, und das Ergebnis war ein
    Fehler ohne erkennbaren Grund.

    Eine frische Instanz je Aufruf kostet wenige Millisekunden und nimmt
    diese ganze Klasse von Fehlern heraus. Geteilt wird nichts mehr.
    """
    with yt_dlp.YoutubeDL(YTDLP_OPTS) as ytdl:
        return ytdl.extract_info(url, download=False)


def ist_erlaubte_url(url: str) -> bool:
    try:
        zerlegt = urlparse(url)
    except ValueError:
        return False
    if zerlegt.scheme != "https":
        return False
    return (zerlegt.hostname or "").lower() in ERLAUBTE_HOSTS


def _dauer(text: str | None) -> int:
    """'3:45' -> 225. Wie im Legacy-Bot."""
    if not text:
        return 0
    try:
        teile = [int(t) for t in text.split(":")]
    except ValueError:
        return 0
    if len(teile) == 3:
        return teile[0] * 3600 + teile[1] * 60 + teile[2]
    if len(teile) == 2:
        return teile[0] * 60 + teile[1]
    return teile[0] if teile else 0


async def suche(query: str, limit: int) -> list[dict[str, Any]]:
    """YouTube-Music-Suche. Laeuft im Threadpool - ytmusicapi ist synchron."""
    schleife = asyncio.get_running_loop()
    treffer = await asyncio.wait_for(
        schleife.run_in_executor(
            None, lambda: _ytmusic.search(query, filter="songs", limit=limit)
        ),
        timeout=8,
    )

    ergebnis: list[dict[str, Any]] = []
    for eintrag in treffer or []:
        video_id = eintrag.get("videoId")
        if not video_id:
            continue
        kuenstler = ", ".join(
            a.get("name", "") for a in eintrag.get("artists", []) if a.get("name")
        )
        bilder = eintrag.get("thumbnails") or []
        ergebnis.append(
            {
                "providerTrackId": video_id,
                "title": eintrag.get("title", "Unbekannt"),
                "artist": kuenstler or None,
                "webpageUrl": f"https://www.youtube.com/watch?v={video_id}",
                "durationSeconds": _dauer(eintrag.get("duration")),
                "thumbnailUrl": bilder[-1].get("url") if bilder else None,
            }
        )
    return ergebnis


async def aufloesen(url: str) -> list[dict[str, Any]]:
    """Eine konkrete Adresse zu genau einem Titel aufloesen."""
    if not ist_erlaubte_url(url):
        raise ValueError("Nicht unterstuetzte Adresse.")

    schleife = asyncio.get_running_loop()
    info = await asyncio.wait_for(
        schleife.run_in_executor(None, lambda: _extrahiere(url)),
        timeout=12,
    )
    if isinstance(info, dict) and info.get("entries"):
        info = info["entries"][0]
    if not isinstance(info, dict):
        return []

    seite = info.get("webpage_url") or url
    bilder = info.get("thumbnails") or []
    return [
        {
            "providerTrackId": info.get("id") or seite,
            "title": info.get("title", "Unbekannt"),
            "artist": info.get("uploader") or info.get("artist"),
            "webpageUrl": seite,
            "durationSeconds": int(info.get("duration") or 0),
            "thumbnailUrl": bilder[-1].get("url") if bilder else None,
        }
    ]


async def stream_url(webpage_url: str) -> str:
    """Eine frische Stream-Adresse holen.

    Das ist der Grund, warum die Warteschlange die Seiten-URL speichert und
    nicht die Stream-URL: YouTube-Signaturen laufen ab. Der Legacy-Bot holte
    sie unmittelbar vor dem Abspielen neu - dieses Verhalten bleibt, sonst
    bricht ein lange wartender Titel beim Start ab.
    """
    if not ist_erlaubte_url(webpage_url):
        raise ValueError("Nicht unterstuetzte Adresse.")

    schleife = asyncio.get_running_loop()
    info = await asyncio.wait_for(
        schleife.run_in_executor(None, lambda: _extrahiere(webpage_url)),
        timeout=15,
    )
    if isinstance(info, dict) and info.get("entries"):
        info = info["entries"][0]
    adresse = (info or {}).get("url")
    if not adresse:
        raise RuntimeError("Keine abspielbare Adresse erhalten.")
    return str(adresse)


# --------------------------------------------------------------------------
# Fehlerbewertung
# --------------------------------------------------------------------------
#
# Ein Titel wird nur dann dauerhaft aus der Warteschlange genommen, wenn er
# dauerhaft kaputt ist. Diese Liste beschreibt genau das: geloescht, privat,
# gesperrt, altersbeschraenkt, nur fuer Mitglieder, gar kein Video. Alles
# andere - Zeitgrenzen, Netzaussetzer, HTTP 429, ein Serverfehler der
# Gegenseite - geht vorueber und wird wiederholt.
#
# Die Reihenfolge der Bewertung ist wichtig: im Zweifel VORUEBERGEHEND. Ein
# faelschlich als voruebergehend eingestufter Titel kostet ein paar Versuche;
# ein faelschlich als dauerhaft eingestufter verschwindet fuer immer.
DAUERHAFT_MARKER = (
    "video unavailable",
    "this video is not available",
    "no longer available",
    "private video",
    "this video is private",
    "removed by the uploader",
    "removed by the user",
    "has been removed",
    "account associated with this video has been terminated",
    "who has blocked it",
    "blocked it on copyright grounds",
    "not available in your country",
    "not made this video available",
    "members-only",
    "join this channel",
    "sign in to confirm your age",
    "age-restricted",
    "inappropriate for some users",
    "unsupported url",
    "is not a valid url",
    "does not exist",
    "incomplete youtube id",
    "unable to extract video id",
)

# Wird in der Meldung gefunden, gilt der Fehler als voruebergehend - auch
# wenn zufaellig ein Marker von oben darin vorkommt.
VORUEBERGEHEND_MARKER = (
    "timed out",
    "timeout",
    "temporarily",
    "try again later",
    "http error 429",
    "http error 500",
    "http error 502",
    "http error 503",
    "http error 504",
    "connection reset",
    "connection refused",
    "connection aborted",
    "network is unreachable",
    "name or service not known",
    "failed to resolve",
    "remote end closed",
    "the read operation",
    "ssl",
)

_URL_MUSTER = re.compile(r"https?://\S+")
_ANSI_MUSTER = re.compile(r"\x1b\[[0-9;]*m")

MELDUNG_LAENGE = 300


def fehlertext(fehler: BaseException) -> str:
    """Eine protokollierbare Fassung einer Fehlermeldung.

    Der Klassenname allein - frueher stand nur er im Protokoll - sagt nichts:
    `DownloadError` kann alles heissen. Die Meldung sagt es.

    Was nicht hinein darf, sind Adressen: eine aufgeloeste Stream-URL traegt
    Signatur und Sitzungsmerkmale, und die haben in keinem Protokoll etwas
    verloren. Sie werden deshalb ersetzt, nicht gekuerzt - kuerzen liesse den
    Anfang stehen.
    """
    text = str(fehler).strip()
    if not text:
        text = type(fehler).__name__
    text = _ANSI_MUSTER.sub("", text)
    text = _URL_MUSTER.sub("<adresse>", text)
    text = " ".join(text.split())
    if len(text) > MELDUNG_LAENGE:
        text = text[: MELDUNG_LAENGE - 1] + "…"
    return f"{type(fehler).__name__}: {text}"


def ist_dauerhaft(fehler: BaseException) -> bool:
    """Ist dieser Titel dauerhaft kaputt - oder nur gerade jetzt?

    Von der Antwort haengt ab, ob ein Titel aus der Warteschlange
    verschwindet. Deshalb ist die Voreinstellung «voruebergehend»: nur was
    hier eindeutig wiedererkannt wird, gilt als dauerhaft.
    """
    # Eine nicht erlaubte Adresse aendert sich nicht mehr.
    if isinstance(fehler, ValueError) and not isinstance(fehler, UnicodeError):
        return True
    if isinstance(fehler, (asyncio.TimeoutError, TimeoutError, OSError)):
        return False

    meldung = str(fehler).lower()
    if any(marker in meldung for marker in VORUEBERGEHEND_MARKER):
        return False
    return any(marker in meldung for marker in DAUERHAFT_MARKER)
