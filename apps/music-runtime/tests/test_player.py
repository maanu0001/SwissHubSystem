"""Der Wiedergabe-Lebenszyklus - die Faelle, an denen er zerbrochen ist.

Das gemeldete Verhalten war: «Ein Lied wird ausgewaehlt und kurz im Player
angezeigt, verschwindet dann unmittelbar wieder, und die Wiedergabe endet
bzw. startet gar nicht richtig.» Dahinter lagen drei getrennte Ursachen, und
jede hat hier ihren Test:

1. Jeder Aufloesefehler - auch eine abgelaufene Zeitgrenze - markierte den
   Titel dauerhaft als unspielbar. Damit war er aus der Warteschlange raus:
   kurz angezeigt, dann weg.
2. Das verspaetete Ende-Ereignis einer Wiedergabe beendete die naechste. Der
   Player zeigte einen Titel und raeumte ihn sofort wieder ab.
3. Eine kurz abgerissene Sprachverbindung beendete die Wiedergabeschleife
   endgueltig - danach passierte gar nichts mehr.

Die Tests kommen ohne Discord und ohne Netz aus: gespielt wird gegen einen
nachgebauten VoiceClient, dessen Ende-Meldung der Test selbst ausloest -
genau so, wie discord.py sie aus seinem Audio-Thread schickt.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Callable, Optional

import discord
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from swisshub_music import player as player_modul  # noqa: E402
from swisshub_music import provider  # noqa: E402
from swisshub_music.player import Ende, SessionBeendet, SessionPlayer  # noqa: E402

SITZUNG = "session-1"


# -- Nachbauten -----------------------------------------------------------


class FakePool:
    """Nur die beiden Abfragen, die der Player direkt am Pool absetzt."""

    def __init__(self, store: "FakeStore") -> None:
        self.store = store

    async def fetchrow(self, sql: str, *args: Any):
        # Titelwiederholung: genau dieser Eintrag, sofern spielbar.
        for eintrag in self.store.warteschlange:
            if eintrag["id"] == args[0] and not eintrag["unavailable"]:
                return eintrag
        return None

    async def execute(self, sql: str, *args: Any) -> None:
        # Warteschlangenwiederholung: Eintrag ans Ende.
        if 'SET "position"' in sql:
            for eintrag in self.store.warteschlange:
                if eintrag["id"] == args[0]:
                    eintrag["position"] = max(
                        e["position"] for e in self.store.warteschlange
                    ) + 10
            self.store.warteschlange.sort(key=lambda e: e["position"])


class FakeStore:
    def __init__(self, titel: list[str], loop_mode: str = "OFF") -> None:
        self.warteschlange: list[dict[str, Any]] = [
            {
                "id": name,
                "title": name,
                "webpageUrl": f"https://www.youtube.com/watch?v={name}",
                "durationSeconds": 10,
                "position": (i + 1) * 10,
                "unavailable": False,
            }
            for i, name in enumerate(titel)
        ]
        self.pool = FakePool(self)
        self.aktuell: Optional[str] = None
        self.beendet = False
        self.loop_mode = loop_mode
        self.unspielbar: list[tuple[str, str]] = []
        self.fehlversuche: list[tuple[str, str]] = []
        self.verlauf: list[tuple[str, bool]] = []
        self.gesetzt: list[Optional[str]] = []

    async def session(self, session_id: str):
        if self.beendet:
            return {"endedAt": "jetzt"}
        return {
            "endedAt": None,
            "loopMode": self.loop_mode,
            "currentItemId": self.aktuell,
            "guildId": "1",
            "voiceChannelId": "2",
        }

    async def naechster_titel(self, session_id: str, ueberspringen=None):
        aus = set(ueberspringen or [])
        for eintrag in sorted(self.warteschlange, key=lambda e: e["position"]):
            if eintrag["unavailable"] or eintrag["id"] in aus:
                continue
            return eintrag
        return None

    async def setze_aktuellen_titel(self, session_id: str, item_id) -> None:
        self.aktuell = item_id
        self.gesetzt.append(item_id)

    async def entferne_titel(self, item_id: str) -> None:
        self.warteschlange = [e for e in self.warteschlange if e["id"] != item_id]

    async def markiere_unspielbar(self, item_id: str, grund: str) -> None:
        self.unspielbar.append((item_id, grund))
        for eintrag in self.warteschlange:
            if eintrag["id"] == item_id:
                eintrag["unavailable"] = True

    async def vermerke_fehlversuch(self, item_id: str, grund: str) -> None:
        self.fehlversuche.append((item_id, grund))

    async def schreibe_verlauf(self, *args: Any) -> None:
        self.verlauf.append((args[3]["id"], args[5]))


class FakeQuelle:
    """Statt FFmpeg - der Test startet keinen Prozess."""

    def __init__(self, adresse: str, **opts: Any) -> None:
        self.adresse = adresse
        self.opts = opts
        self.volume = 1.0


class FakeVoice:
    def __init__(self) -> None:
        self.channel = None
        self.verbunden = True
        self._spielt = False
        self._after: Optional[Callable[[Optional[Exception]], None]] = None
        self.gestartet: list[FakeQuelle] = []

    def is_connected(self) -> bool:
        return self.verbunden

    def is_playing(self) -> bool:
        return self._spielt

    def is_paused(self) -> bool:
        return False

    def play(self, quelle: Any, after=None) -> None:
        if self._spielt:
            raise discord.ClientException("Already playing audio.")
        self._spielt = True
        self._after = after
        self.gestartet.append(quelle)

    def stop(self) -> None:
        if not self._spielt:
            return
        self.beende()

    def beende(self, fehler: Optional[Exception] = None) -> None:
        """Was discord.py aus dem Audio-Thread meldet."""
        self._spielt = False
        rueckruf, self._after = self._after, None
        if rueckruf is not None:
            rueckruf(fehler)

    async def disconnect(self, *, force: bool = False) -> None:
        self.verbunden = False
        self._spielt = False
        self._after = None

    def laufender_rueckruf(self):
        return self._after


class FakeClient:
    def __init__(self) -> None:
        self.loop = asyncio.get_event_loop()
        self.user = None


# -- Hilfen ---------------------------------------------------------------


async def warte_bis(bedingung: Callable[[], bool], grenze: float = 2.0) -> None:
    ende = asyncio.get_running_loop().time() + grenze
    while asyncio.get_running_loop().time() < ende:
        if bedingung():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Bedingung wurde nicht erreicht.")


@pytest.fixture
def schnell(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keine echten Wartezeiten - sonst dauert jeder Test Sekunden."""
    monkeypatch.setattr(player_modul, "AUFLOESE_PAUSEN", (0.0, 0.0))
    monkeypatch.setattr(player_modul, "VERBINDUNG_WARTEN_SEKUNDEN", 0.3)
    monkeypatch.setattr(discord, "FFmpegPCMAudio", FakeQuelle)
    monkeypatch.setattr(
        discord, "PCMVolumeTransformer", lambda quelle, volume=1.0: quelle
    )


def baue(store: FakeStore) -> tuple[SessionPlayer, FakeVoice]:
    stimme = FakeVoice()
    spieler = SessionPlayer(FakeClient(), store, SITZUNG)  # type: ignore[arg-type]
    spieler.voice = stimme  # type: ignore[assignment]
    return spieler, stimme


# -- 1. Der verschwindende Titel ------------------------------------------


@pytest.mark.asyncio
async def test_zeitgrenze_nimmt_den_titel_nicht_aus_der_warteschlange(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Der gemeldete Fehler, in seiner reinsten Form.

    Frueher genuegte eine einzige abgelaufene Zeitgrenze, um den Titel
    dauerhaft als unspielbar zu markieren - er war damit fuer immer weg.
    """
    store = FakeStore(["A"])
    spieler, _ = baue(store)

    async def stream_url(url: str) -> str:
        raise asyncio.TimeoutError()

    monkeypatch.setattr(provider, "stream_url", stream_url)

    adresse = await spieler._loese_auf(store.warteschlange[0])

    assert adresse is None
    assert store.unspielbar == [], "Eine Zeitgrenze ist kein dauerhafter Defekt."
    assert store.warteschlange[0]["unavailable"] is False
    assert len(store.fehlversuche) == 1
    assert "A" in spieler._abkuehlung, "Der Titel soll abkuehlen, nicht sterben."


@pytest.mark.asyncio
async def test_voruebergehender_fehler_wird_wiederholt(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Zwei Aussetzer, dann klappt es - ohne dass jemand etwas merkt."""
    store = FakeStore(["A"])
    spieler, _ = baue(store)
    versuche = {"n": 0}

    async def stream_url(url: str) -> str:
        versuche["n"] += 1
        if versuche["n"] < 3:
            raise asyncio.TimeoutError()
        return "https://stream.example/a"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    adresse = await spieler._loese_auf(store.warteschlange[0])

    assert adresse == "https://stream.example/a"
    assert versuche["n"] == 3
    assert store.unspielbar == []
    assert store.fehlversuche == []
    assert "A" not in spieler._abkuehlung


@pytest.mark.asyncio
async def test_dauerhaft_defekter_titel_wird_markiert(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Ein geloeschtes Video kommt nicht wieder - einmal versuchen genuegt."""
    store = FakeStore(["A"])
    spieler, _ = baue(store)
    versuche = {"n": 0}

    async def stream_url(url: str) -> str:
        versuche["n"] += 1
        raise RuntimeError("ERROR: Video unavailable. This video has been removed.")

    monkeypatch.setattr(provider, "stream_url", stream_url)

    adresse = await spieler._loese_auf(store.warteschlange[0])

    assert adresse is None
    assert versuche["n"] == 1, "Bei einem dauerhaften Defekt wird nicht wiederholt."
    assert len(store.unspielbar) == 1
    assert store.unspielbar[0][0] == "A"
    assert "removed" in store.unspielbar[0][1].lower()


@pytest.mark.asyncio
async def test_abgekuehlter_titel_blockiert_die_warteschlange_nicht(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Geht A gerade nicht, laeuft B - und A bleibt fuer spaeter stehen."""
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        if url.endswith("A"):
            raise asyncio.TimeoutError()
        return "https://stream.example/b"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: len(stimme.gestartet) == 1)

    assert store.aktuell == "B"
    assert any(e["id"] == "A" for e in store.warteschlange), "A bleibt in der Liste."
    assert store.warteschlange[0]["unavailable"] is False

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_abkuehlung_laeuft_ab(schnell: None) -> None:
    """Nach der Abkuehlzeit ist der Titel wieder dabei."""
    store = FakeStore(["A"])
    spieler, _ = baue(store)

    spieler._abkuehlung["A"] = asyncio.get_running_loop().time() - 1
    # `_abgekuehlte` misst mit time.monotonic; ein Zeitpunkt in der
    # Vergangenheit ist in beiden Uhren vergangen.
    assert spieler._abgekuehlte() == []
    assert "A" not in spieler._abkuehlung


# -- 2. Das verspaetete Ende-Ereignis -------------------------------------


@pytest.mark.asyncio
async def test_verspaetetes_ende_beendet_den_naechsten_titel_nicht(
    monkeypatch: pytest.MonkeyPatch, schnell: None, caplog: pytest.LogCaptureFixture
) -> None:
    """Der Wettlauf, der einen laufenden Titel abraeumte.

    discord.py meldet das Ende aus einem eigenen Thread. Trifft diese Meldung
    verspaetet ein - oder ein zweites Mal - gehoert sie zur vorherigen
    Wiedergabe und darf die laufende nicht anruehren. Ohne die Pruefung auf
    die Wiedergabenummer endete hier B, sobald A sich nachtraeglich meldete:
    ein Titel, der eben noch im Player stand, war sofort wieder weg.
    """
    store = FakeStore(["A", "B", "C"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A" and len(stimme.gestartet) == 1)

    # Den Rueckruf von A festhalten - discord.py haelt ihn genauso.
    rueckruf_a = stimme.laufender_rueckruf()
    assert rueckruf_a is not None

    # A endet regulaer, B startet.
    stimme.beende()
    await warte_bis(lambda: store.aktuell == "B" and len(stimme.gestartet) == 2)
    rueckruf_b = stimme.laufender_rueckruf()

    # Jetzt meldet sich A ein zweites Mal - verspaetet, aus dem Audio-Thread.
    with caplog.at_level("INFO", logger="swisshub.music.player"):
        rueckruf_a(None)
        await asyncio.sleep(0.15)

    assert store.aktuell == "B", "B laeuft weiter."
    assert len(stimme.gestartet) == 2, "C wurde nicht faelschlich gestartet."
    assert stimme.laufender_rueckruf() is rueckruf_b
    assert any("stale_event" in eintrag.message for eintrag in caplog.records)

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_jedes_ende_ruecke_genau_einen_titel_weiter(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Die ganze Warteschlange - ein Ende, ein Titel weiter, kein Sprung."""
    store = FakeStore(["A", "B", "C"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    for erwartet, anzahl in (("A", 1), ("B", 2), ("C", 3)):
        await warte_bis(
            lambda e=erwartet, n=anzahl: store.aktuell == e
            and len(stimme.gestartet) == n
        )
        stimme.beende()

    await warte_bis(lambda: store.aktuell is None)
    assert [item for item, _ in store.verlauf] == ["A", "B", "C"]
    assert store.warteschlange == []

    await spieler.verlasse()


# -- Abbruch waehrend der Wiedergabe --------------------------------------


@pytest.mark.asyncio
async def test_frueher_abbruch_entfernt_den_titel_nicht(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Bricht FFmpeg sofort ab, ist der Titel nicht gelaufen.

    Frueher war ein Fehler aus dem Audio-Thread ununterscheidbar von einem
    regulaeren Ende: der Titel wanderte in den Verlauf und aus der
    Warteschlange. Genau so verschwand ein Lied, das eben noch da war.
    """
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A")
    stimme.beende(OSError("ffmpeg ist weggebrochen"))

    await warte_bis(lambda: store.aktuell == "B")

    assert any(e["id"] == "A" for e in store.warteschlange), "A bleibt in der Liste."
    assert store.verlauf == [], "Ein Abbruch ist kein Verlaufseintrag."
    assert store.unspielbar == []
    assert len(store.fehlversuche) == 1
    assert "A" in spieler._abkuehlung

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_spaeter_abbruch_zaehlt_als_gelaufen(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Reisst es erst nach Minuten ab, waere ein Neustart die schlechtere
    Antwort - der Titel ist im Wesentlichen gelaufen."""
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A")
    # So, als liefe der Titel bereits seit fuenf Minuten.
    spieler._begonnen_um -= 300
    stimme.beende(OSError("Verbindung verloren"))

    await warte_bis(lambda: store.aktuell == "B")

    assert store.verlauf == [("A", False)]
    assert not any(e["id"] == "A" for e in store.warteschlange)

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_ueberspringen_schlaegt_einen_fehler(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Wer weiterdrueckt, hat entschieden - auch wenn die Quelle dabei
    murrt. Sonst kaeme der uebersprungene Titel gleich wieder."""
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A")
    spieler.ueberspringe()
    stimme.beende(OSError("Quelle abgebrochen"))

    await warte_bis(lambda: store.aktuell == "B")

    assert store.verlauf == [("A", True)]
    assert store.fehlversuche == []
    assert not any(e["id"] == "A" for e in store.warteschlange)

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_dauerhaftes_scheitern_endet_irgendwann(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Die Abkuehlung allein waere eine Endlosschleife.

    Ein Titel, der zuverlaessig scheitert, kaeme sonst alle sechzig Sekunden
    wieder an die Reihe. Nach begrenzt vielen Anlaeufen gilt er als defekt -
    mit dem Grund daneben, damit erklaerbar bleibt, warum er verschwand.
    """
    store = FakeStore(["A"])
    spieler, _ = baue(store)

    for _ in range(player_modul.HOECHSTENS_FEHLVERSUCHE - 1):
        await spieler._vermerke_aussetzer("A", "TimeoutError: Zeitgrenze")
        assert store.unspielbar == []
        # Fuer den naechsten Anlauf ist die Abkuehlung vorbei.
        spieler._abkuehlung.clear()

    await spieler._vermerke_aussetzer("A", "TimeoutError: Zeitgrenze")

    assert len(store.unspielbar) == 1
    assert "Zeitgrenze" in store.unspielbar[0][1]
    assert "A" not in spieler._abkuehlung, "Ein defekter Titel kuehlt nicht mehr ab."


@pytest.mark.asyncio
async def test_ein_gelungener_durchlauf_loescht_die_fehlerzaehlung(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Sonst summierten sich Aussetzer ueber Stunden zu einem Todesurteil."""
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler._fehlversuche["A"] = player_modul.HOECHSTENS_FEHLVERSUCHE - 1

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A")
    stimme.beende()
    await warte_bis(lambda: store.aktuell == "B")

    assert "A" not in spieler._fehlversuche
    assert store.unspielbar == []

    await spieler.verlasse()


# -- 3. Die abgerissene Sprachverbindung ----------------------------------


@pytest.mark.asyncio
async def test_kurzer_verbindungsverlust_beendet_die_schleife_nicht(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Frueher war die Session danach tot - jetzt wird gewartet."""
    store = FakeStore(["A"])
    spieler, stimme = baue(store)
    stimme.verbunden = False

    async def stream_url(url: str) -> str:
        return "https://stream.example/a"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await asyncio.sleep(0.1)
    assert stimme.gestartet == []
    assert spieler._aufgabe is not None and not spieler._aufgabe.done()

    # Die Verbindung kommt zurueck - discord.py baut sie selbst wieder auf.
    stimme.verbunden = True
    await warte_bis(lambda: len(stimme.gestartet) == 1)
    assert store.aktuell == "A"

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_beendete_sitzung_beendet_die_schleife(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Nur das Ende der Sitzung beendet die Schleife - sonst nichts."""
    store = FakeStore(["A"])
    spieler, _ = baue(store)
    store.beendet = True

    spieler.starte()
    await warte_bis(lambda: spieler._aufgabe is not None and spieler._aufgabe.done())
    assert spieler._aufgabe is not None
    assert spieler._aufgabe.exception() is None


@pytest.mark.asyncio
async def test_belegter_ausgang_wirft_den_titel_nicht_weg(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Laeuft noch eine Quelle aus, wird nicht gespielt - aber auch nichts
    geloescht. Der naechste Durchgang setzt neu auf."""
    store = FakeStore(["A"])
    spieler, stimme = baue(store)
    stimme.play(FakeQuelle("alt"))  # belegt

    ergebnis = spieler._beginne("A", "https://stream.example/a", 0)

    assert ergebnis is None
    assert spieler._laufend is None
    assert store.warteschlange[0]["id"] == "A"


# -- Steuerung ------------------------------------------------------------


@pytest.mark.asyncio
async def test_ueberspringen_zaehlt_als_uebersprungen(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/x"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "A")
    spieler.ueberspringe()
    await warte_bis(lambda: store.aktuell == "B")

    assert store.verlauf[0] == ("A", True)
    await spieler.verlasse()


@pytest.mark.asyncio
async def test_sprung_startet_denselben_titel_neu(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Ein Sprung ist kein Ueberspringen - der Titel bleibt derselbe."""
    store = FakeStore(["A", "B"])
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/a"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: len(stimme.gestartet) == 1)
    spieler.springe(42)
    await warte_bis(lambda: len(stimme.gestartet) == 2)

    assert store.aktuell == "A"
    assert "-ss 42" in stimme.gestartet[1].opts["before_options"]
    assert store.verlauf == [], "Ein Sprung schreibt keinen Verlaufseintrag."

    await spieler.verlasse()


@pytest.mark.asyncio
async def test_titelwiederholung_ueberspringt_einen_defekten_titel(
    monkeypatch: pytest.MonkeyPatch, schnell: None
) -> None:
    """Sonst haengt die Wiederholung an einem Titel fest, der nie mehr geht."""
    store = FakeStore(["A", "B"], loop_mode="TRACK")
    store.aktuell = "A"
    store.warteschlange[0]["unavailable"] = True
    spieler, stimme = baue(store)

    async def stream_url(url: str) -> str:
        return "https://stream.example/b"

    monkeypatch.setattr(provider, "stream_url", stream_url)

    spieler.starte()
    await warte_bis(lambda: store.aktuell == "B")

    await spieler.verlasse()


# -- Fehlerbewertung und Protokoll ----------------------------------------


@pytest.mark.parametrize(
    "meldung",
    [
        "ERROR: Video unavailable",
        "Private video. Sign in if you've been granted access to this video",
        "This video has been removed by the uploader",
        "Join this channel to get access to members-only content",
        "Sign in to confirm your age",
        "ERROR: Unsupported URL: https://example.invalid/x",
    ],
)
def test_dauerhafte_fehler_werden_erkannt(meldung: str) -> None:
    assert provider.ist_dauerhaft(RuntimeError(meldung)) is True


@pytest.mark.parametrize(
    "fehler",
    [
        asyncio.TimeoutError(),
        OSError("Connection reset by peer"),
        RuntimeError("HTTP Error 429: Too Many Requests"),
        RuntimeError("HTTP Error 503: Service Unavailable"),
        RuntimeError("The read operation timed out"),
        RuntimeError("Keine abspielbare Adresse erhalten."),
        RuntimeError("Irgendwas voellig Unbekanntes"),
    ],
)
def test_im_zweifel_voruebergehend(fehler: BaseException) -> None:
    """Die wichtigere Richtung: ein falsch eingestufter Aussetzer kostet
    Versuche, ein falsch eingestufter Defekt kostet den Titel."""
    assert provider.ist_dauerhaft(fehler) is False


def test_fehlertext_nennt_den_grund_und_keine_adresse() -> None:
    """Im Protokoll stand frueher nur der Klassenname - damit war nichts
    anzufangen. Die Stream-Adresse darf dafuer nicht hinein: sie traegt
    Signatur und Sitzungsmerkmale."""
    fehler = RuntimeError(
        "unable to download https://rr3---sn-x.googlevideo.com/videoplayback"
        "?expire=1&signature=GEHEIM"
    )
    text = provider.fehlertext(fehler)

    assert "RuntimeError" in text
    assert "unable to download" in text
    assert "GEHEIM" not in text
    assert "googlevideo" not in text
    assert "<adresse>" in text


def test_fehlertext_ist_begrenzt() -> None:
    text = provider.fehlertext(RuntimeError("x" * 5000))
    assert len(text) <= provider.MELDUNG_LAENGE + len("RuntimeError: ")


def test_session_beendet_ist_kein_cancelled_error() -> None:
    """Der Grund, warum es diese Ausnahme gibt: `CancelledError` als
    Steuerzeichen liess jeden anderen Abbruchgrund wie ein Sitzungsende
    aussehen."""
    assert not issubclass(SessionBeendet, asyncio.CancelledError)
    assert Ende.SPRUNG is not Ende.UEBERSPRUNGEN
