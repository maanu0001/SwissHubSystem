"""Wiedergabe je Bot und Voice-Kanal.

Der Unterschied zum Legacy-Bot ist nicht die Tonwiedergabe - die ist
uebernommen - sondern woher die Warteschlange kommt. Frueher lag sie in einer
asyncio.Queue im Speicher; jetzt steht sie in der Datenbank, wo Webplayer und
Slash-Befehle dieselbe sehen. Der Player liest sie, statt sie zu besitzen.

## Drei Regeln, die hier haengen

**1. Ein Ereignis gehoert zu genau einer Wiedergabe.** discord.py meldet das
Ende eines Titels aus einem eigenen Thread, und diese Meldung kann verspaetet
eintreffen - nachdem laengst der naechste Titel laeuft. Jede Wiedergabe traegt
deshalb eine Nummer, und ein Ereignis wirkt nur auf die, zu der es gehoert.
Ohne diese Pruefung beendete das Ende von Titel A den gerade gestarteten
Titel B, und im Player verschwaende ein Lied, das eben noch da war.

**2. Ein voruebergehender Fehler ist kein dauerhafter.** Eine abgelaufene
Zeitgrenze, ein Netzaussetzer, eine kurze Sperre der Gegenseite - all das geht
vorueber. Wer daraufhin einen Titel als «nicht abspielbar» markiert, loescht
ihn faktisch: er taucht nie wieder auf, und niemand erfaehrt, warum. Dauerhaft
markiert wird nur, was dauerhaft ist: ein geloeschtes, gesperrtes oder
privates Video.

**3. Die Schleife endet nur, wenn die Sitzung endet.** Eine kurz abgerissene
Sprachverbindung ist ein Zustand, kein Abbruch. Frueher beendete sie die
Wiedergabeschleife fuer immer - danach half nur noch ein neuer Befehl.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import discord

from . import provider
from .store import Store

log = logging.getLogger("swisshub.music.player")


class SessionBeendet(Exception):
    """Die Sitzung gibt es nicht mehr - die Schleife darf enden.

    Bewusst eine eigene Ausnahme und nicht `asyncio.CancelledError`: die
    bedeutet «diese Aufgabe wurde abgebrochen» und wird von asyncio selbst
    verwendet. Sie als Steuerzeichen zu missbrauchen liess jeden anderen
    Grund - etwa eine kurz fehlende Sprachverbindung - wie einen Abbruch
    aussehen und beendete die Wiedergabe endgueltig.
    """


class Ende(str, Enum):
    """Warum eine Wiedergabe geendet hat."""

    FERTIG = "finished"
    UEBERSPRUNGEN = "skipped"
    SPRUNG = "seek"
    GESTOPPT = "stopped"


@dataclass
class Wiedergabe:
    """Ein einzelner Abspielvorgang - die Einheit, auf die Ereignisse zeigen."""

    nummer: int
    item_id: str
    fertig: asyncio.Event = field(default_factory=asyncio.Event)
    grund: Ende = Ende.FERTIG
    # Was discord.py aus dem Audio-Thread gemeldet hat. Gesetzt heisst: der
    # Titel ist nicht zu Ende gelaufen, er ist abgebrochen.
    fehler: Optional[BaseException] = None


# Wie oft eine Aufloesung bei einem voruebergehenden Fehler wiederholt wird.
AUFLOESE_VERSUCHE = 3
# Wartezeiten dazwischen, in Sekunden.
AUFLOESE_PAUSEN = (1.0, 3.0)
# Wie lange ein Titel nach einem erfolglosen Versuch uebersprungen wird.
ABKUEHLUNG_SEKUNDEN = 60.0
# Bis hierhin gilt ein abgebrochener Titel als «gar nicht gelaufen».
FRUEHER_ABBRUCH_SEKUNDEN = 10
# Wie oft ein Titel scheitern darf, ehe er als defekt gilt.
#
# Die Abkuehlung allein genuegt nicht: ein Titel, der zuverlaessig scheitert,
# kaeme sonst alle sechzig Sekunden wieder an die Reihe und scheiterte wieder.
# Nach so vielen Anlaeufen ist er nicht mehr «gerade nicht erreichbar»,
# sondern defekt - mit dem Grund daneben, damit es erklaerbar bleibt.
HOECHSTENS_FEHLVERSUCHE = 3
# Wie lange auf eine wiederkehrende Sprachverbindung gewartet wird.
VERBINDUNG_WARTEN_SEKUNDEN = 10.0


class SessionPlayer:
    def __init__(self, client: discord.Client, store: Store, session_id: str) -> None:
        self.client = client
        self.store = store
        self.session_id = session_id
        self.voice: Optional[discord.VoiceClient] = None
        self.volume = 0.5
        self._aufgabe: Optional[asyncio.Task] = None
        self._quelle: Optional[discord.PCMVolumeTransformer] = None
        self._begonnen_um = 0.0
        # Die laufende Wiedergabe. Ereignisse pruefen sich gegen dieses Objekt.
        self._laufend: Optional[Wiedergabe] = None
        self._nummer = 0
        # Gesetzt, solange ein Sprung ansteht. Der Titel bleibt dabei
        # derselbe - deshalb ein eigenes Feld und nicht der Endgrund.
        self._sprungziel: Optional[int] = None
        # Titel, die gerade nicht gehen - mit dem Zeitpunkt, ab dem sie
        # wieder versucht werden. Im Speicher und nicht in der Datenbank: es
        # ist eine Beobachtung dieses Laufs, keine Eigenschaft des Titels.
        self._abkuehlung: dict[str, float] = {}
        # Wie oft ein Titel in diesem Lauf schon gescheitert ist.
        self._fehlversuche: dict[str, int] = {}

    # -- Verbindung -------------------------------------------------------

    async def verbinde(self, kanal: discord.VoiceChannel) -> None:
        if self.voice and self.voice.is_connected():
            if self.voice.channel and self.voice.channel.id != kanal.id:
                await self.voice.move_to(kanal)
            return
        # self_deaf wie im Legacy-Bot: der Bot muss nichts hoeren.
        self.voice = await kanal.connect(self_deaf=True)
        log.info(
            "music.voice.ready",
            extra={"session": self.session_id, "channel": str(kanal.id)},
        )

    async def _warte_auf_verbindung(self) -> bool:
        """Bis die Sprachverbindung wieder steht - begrenzt.

        discord.py baut eine abgerissene Verbindung von selbst wieder auf;
        dazwischen liegt ein kurzes Fenster, in dem `is_connected()` falsch
        ist. Frueher beendete genau dieses Fenster die Wiedergabe endgueltig.
        Jetzt wird gewartet - und wenn sie nicht wiederkommt, kehrt der
        Durchgang zurueck und der naechste versucht es erneut.
        """
        if self.voice is not None and self.voice.is_connected():
            return True

        log.warning("music.voice.disconnected", extra={"session": self.session_id})
        ende = time.monotonic() + VERBINDUNG_WARTEN_SEKUNDEN
        while time.monotonic() < ende:
            await asyncio.sleep(0.5)
            if self.voice is not None and self.voice.is_connected():
                log.info("music.voice.ready", extra={"session": self.session_id})
                return True
        return False

    # -- Schleife ---------------------------------------------------------

    def starte(self) -> None:
        if self._aufgabe is None or self._aufgabe.done():
            self._aufgabe = asyncio.create_task(self._schleife())

    async def _schleife(self) -> None:
        while True:
            try:
                await self._naechster_titel()
            except SessionBeendet:
                log.info("music.session.ended", extra={"session": self.session_id})
                return
            except asyncio.CancelledError:
                # Echter Abbruch - der Bot faehrt herunter oder verlaesst den
                # Kanal. Weiterreichen, damit asyncio es als solchen sieht.
                raise
            except Exception:
                # Ein Fehler an einem Titel darf die Schleife nicht beenden -
                # sonst steht die Session still und niemand weiss warum.
                log.exception("music.loop.error", extra={"session": self.session_id})
                await asyncio.sleep(1)

    async def _naechster_titel(self) -> None:
        session = await self.store.session(self.session_id)
        if session is None or session["endedAt"] is not None:
            raise SessionBeendet

        loop_mode = session["loopMode"]
        aktuell_id = session["currentItemId"]
        abgekuehlt = self._abgekuehlte()

        # Auch die Titelwiederholung laesst sich ausbremsen: ist genau dieser
        # Titel gerade nicht erreichbar oder inzwischen als unspielbar
        # markiert, wird weitergegangen statt in der Wiederholung
        # festzustecken.
        eintrag = None
        if loop_mode == "TRACK" and aktuell_id and str(aktuell_id) not in abgekuehlt:
            eintrag = await self.store.pool.fetchrow(
                'SELECT "id","title","webpageUrl","durationSeconds" FROM "MusicQueueItem"'
                ' WHERE "id" = $1 AND "unavailable" = false',
                aktuell_id,
            )
        if eintrag is None:
            eintrag = await self.store.naechster_titel(
                self.session_id, ueberspringen=abgekuehlt
            )

        if eintrag is None:
            await self.store.setze_aktuellen_titel(self.session_id, None)
            await asyncio.sleep(2)
            return

        item_id = str(eintrag["id"])
        await self.store.setze_aktuellen_titel(self.session_id, item_id)

        adresse = await self._loese_auf(eintrag)
        if adresse is None:
            # Kurz durchatmen: der naechste Durchgang nimmt einen anderen
            # Titel, und ohne diese Pause waere der Weg dorthin eine
            # Leerlaufschleife.
            await asyncio.sleep(0.5)
            return

        # Erst wenn die Adresse steht, wird gespielt - und erst dann muss die
        # Sprachverbindung stehen.
        if not await self._warte_auf_verbindung():
            log.warning(
                "music.play.aborted",
                extra={"session": self.session_id, "item": item_id, "reason": "voice_gone"},
            )
            return

        self._sprungziel = None
        versatz = 0
        uebersprungen = False

        # Ein Sprung startet denselben Titel an einer anderen Stelle neu.
        # discord.py kann eine laufende Quelle nicht umsetzen, also wird sie
        # gestoppt und eine neue mit `-ss` gebaut. Ohne diese innere Schleife
        # liefe der Ablauf nach dem Stoppen zum naechsten Titel weiter - und
        # ein Sprung waere ein Ueberspringen.
        while True:
            wiedergabe = self._beginne(item_id, adresse, versatz)
            if wiedergabe is None:
                return

            await wiedergabe.fertig.wait()
            self._laufend = None

            if wiedergabe.grund is Ende.SPRUNG and self._sprungziel is not None:
                versatz = self._sprungziel
                self._sprungziel = None
                continue

            uebersprungen = wiedergabe.grund in (Ende.UEBERSPRUNGEN, Ende.GESTOPPT)
            break

        gespielt = int(time.monotonic() - self._begonnen_um)

        # Ein frueher Abbruch ist kein Ende.
        #
        # Meldet discord.py gleich zu Beginn einen Fehler, ist der Titel
        # nicht gelaufen - er ist stehengeblieben. Ihn trotzdem in den
        # Verlauf zu schreiben und aus der Warteschlange zu nehmen hiesse:
        # er verschwindet kommentarlos, und im Player war er gerade noch da.
        # Stattdessen bleibt er stehen und wird spaeter erneut versucht.
        #
        # Nur frueh. Reisst die Verbindung nach vier Minuten ab, ist der
        # Titel im Wesentlichen gelaufen; ihn dann von vorne zu beginnen
        # waere die schlechtere Antwort. Und nur, wenn niemand eingegriffen
        # hat: ein Ueberspringen ist kein Fehlschlag, auch wenn die Quelle
        # dabei noch einen Fehler meldet.
        frueher_abbruch = (
            wiedergabe.fehler is not None
            and wiedergabe.grund is Ende.FERTIG
            and gespielt < FRUEHER_ABBRUCH_SEKUNDEN
        )
        if frueher_abbruch:
            await self._vermerke_aussetzer(item_id, provider.fehlertext(wiedergabe.fehler))
            await asyncio.sleep(0.5)
            return

        log.info(
            "music.track.finished",
            extra={
                "session": self.session_id,
                "item": item_id,
                "playback": wiedergabe.nummer,
                "played": gespielt,
                "reason": wiedergabe.grund.value,
                "error": provider.fehlertext(wiedergabe.fehler) if wiedergabe.fehler else None,
            },
        )
        self._fehlversuche.pop(item_id, None)
        session = await self.store.session(self.session_id)
        if session is not None:
            await self.store.schreibe_verlauf(
                self.session_id,
                str(session["guildId"]),
                str(session["voiceChannelId"]),
                eintrag,
                gespielt,
                uebersprungen,
            )

        # Bei Titelwiederholung bleibt der Eintrag stehen. Bei
        # Warteschlangenwiederholung wandert er ans Ende, statt geloescht zu
        # werden - so gibt es weder Trackverlust noch wachsende Duplikate.
        if loop_mode == "TRACK":
            return
        if loop_mode == "QUEUE":
            await self.store.pool.execute(
                """
                UPDATE "MusicQueueItem"
                   SET "position" = COALESCE(
                         (SELECT MAX("position") FROM "MusicQueueItem" WHERE "sessionId" = $2), 0
                       ) + 10
                 WHERE "id" = $1
                """,
                item_id,
                self.session_id,
            )
        else:
            await self.store.entferne_titel(item_id)

    def _beginne(self, item_id: str, adresse: str, versatz: int) -> Optional[Wiedergabe]:
        """Eine Wiedergabe aufsetzen und starten.

        Die Stream-Adresse wird uebergeben und nicht hier geholt: sie steht
        bereits, bevor der Titel als laufend gilt. Gibt `None` zurueck, wenn
        nicht gespielt werden konnte - dann kehrt der Durchgang zurueck, und
        der naechste versucht es erneut.
        """
        if self.voice is None or not self.voice.is_connected():
            return None

        self._nummer += 1
        wiedergabe = Wiedergabe(nummer=self._nummer, item_id=item_id)
        self._laufend = wiedergabe

        # Zurueckdatiert um den Versatz: `gespielt` ist damit die Stelle, bis
        # zu der der Titel lief, und nicht die Zeit seit dem letzten Sprung.
        self._begonnen_um = time.monotonic() - versatz

        quelle = discord.PCMVolumeTransformer(
            discord.FFmpegPCMAudio(adresse, **provider.ffmpeg_opts(versatz)),
            volume=self.volume,
        )
        self._quelle = quelle

        try:
            self.voice.play(quelle, after=lambda fehler: self._melde_ende(wiedergabe, fehler))
        except discord.ClientException:
            # Die vorherige Quelle laeuft noch aus. Kein Grund zur Panik -
            # der naechste Durchgang setzt neu auf.
            log.warning(
                "music.play.busy",
                extra={"session": self.session_id, "item": item_id},
            )
            self._laufend = None
            return None

        log.info(
            "music.track.started",
            extra={
                "session": self.session_id,
                "item": item_id,
                "playback": wiedergabe.nummer,
                "offset": versatz,
            },
        )
        return wiedergabe

    def _melde_ende(self, wiedergabe: Wiedergabe, fehler: Optional[Exception]) -> None:
        """Das Ende einer Wiedergabe - aus dem Audio-Thread.

        **Die Pruefung auf `self._laufend` ist der Kern dieser Datei.** Ohne
        sie beendete ein verspaetetes Ereignis des vorherigen Titels den
        gerade gestarteten: der Player zeigte ihn kurz und raeumte ihn wieder
        weg. Ein Ereignis darf nur die Wiedergabe veraendern, zu der es
        gehoert.
        """

        def _im_loop() -> None:
            if self._laufend is not wiedergabe:
                log.info(
                    "music.player.stale_event",
                    extra={
                        "session": self.session_id,
                        "item": wiedergabe.item_id,
                        "playback": wiedergabe.nummer,
                    },
                )
                return
            wiedergabe.fehler = fehler
            wiedergabe.fertig.set()

        try:
            self.client.loop.call_soon_threadsafe(_im_loop)
        except RuntimeError:  # pragma: no cover - Schleife bereits zu
            pass

    # -- Aufloesung -------------------------------------------------------

    def _abgekuehlte(self) -> list[str]:
        """Titel, die gerade uebersprungen werden."""
        jetzt = time.monotonic()
        abgelaufen = [item for item, bis in self._abkuehlung.items() if bis <= jetzt]
        for item in abgelaufen:
            del self._abkuehlung[item]
        return list(self._abkuehlung)

    async def _vermerke_aussetzer(self, item_id: str, grund: str) -> None:
        """Ein Titel hat nicht funktioniert - was jetzt mit ihm geschieht.

        Zuerst nichts Endgueltiges: er kuehlt ab und kommt spaeter wieder an
        die Reihe. Erst wenn er das mehrfach hintereinander tut, wird er als
        defekt markiert - mit dem Grund, damit im Dashboard steht, warum.
        """
        anzahl = self._fehlversuche.get(item_id, 0) + 1
        self._fehlversuche[item_id] = anzahl

        if anzahl >= HOECHSTENS_FEHLVERSUCHE:
            log.warning(
                "music.track.given_up",
                extra={
                    "session": self.session_id,
                    "item": item_id,
                    "attempts": anzahl,
                    "error": grund,
                },
            )
            await self.store.markiere_unspielbar(item_id, f"Nach {anzahl} Versuchen: {grund}")
            self._abkuehlung.pop(item_id, None)
            self._fehlversuche.pop(item_id, None)
            return

        log.warning(
            "music.track.failed",
            extra={
                "session": self.session_id,
                "item": item_id,
                "attempts": anzahl,
                "error": grund,
            },
        )
        self._abkuehlung[item_id] = time.monotonic() + ABKUEHLUNG_SEKUNDEN
        await self.store.vermerke_fehlversuch(item_id, grund)

    async def _loese_auf(self, eintrag) -> Optional[str]:
        """Eine frische Stream-Adresse - mit Wiederholung bei Aussetzern.

        Hier entschied sich frueher, ob ein Titel verschwindet: **jeder**
        Fehler markierte ihn dauerhaft als nicht abspielbar, und damit war er
        aus der Warteschlange raus. Eine abgelaufene Zeitgrenze genuegte.

        Jetzt wird unterschieden. Was voruebergeht, wird wiederholt; bleibt es
        dabei, kuehlt der Titel ab und kommt spaeter wieder an die Reihe. Nur
        ein dauerhaft defekter Titel - geloescht, gesperrt, privat - wird
        markiert, und dann steht der Grund daneben.
        """
        item_id = str(eintrag["id"])
        seite = str(eintrag["webpageUrl"])

        for versuch in range(1, AUFLOESE_VERSUCHE + 1):
            log.info(
                "music.resolve.started",
                extra={"session": self.session_id, "item": item_id, "attempt": versuch},
            )
            try:
                adresse = await provider.stream_url(seite)
            except Exception as fehler:
                dauerhaft = provider.ist_dauerhaft(fehler)
                # Der Wortlaut, nicht nur der Klassenname: ohne ihn stand im
                # Protokoll «DownloadError» und sonst nichts - und niemand
                # konnte sagen, woran es lag.
                grund = provider.fehlertext(fehler)
                log.warning(
                    "music.resolve.failed",
                    extra={
                        "session": self.session_id,
                        "item": item_id,
                        "attempt": versuch,
                        "permanent": dauerhaft,
                        "error": grund,
                    },
                )
                if dauerhaft:
                    await self.store.markiere_unspielbar(item_id, grund)
                    self._abkuehlung.pop(item_id, None)
                    self._fehlversuche.pop(item_id, None)
                    return None
                if versuch < AUFLOESE_VERSUCHE:
                    await asyncio.sleep(AUFLOESE_PAUSEN[min(versuch - 1, len(AUFLOESE_PAUSEN) - 1)])
                    continue
                # Aufgegeben - aber nicht fuer immer.
                await self._vermerke_aussetzer(item_id, grund)
                return None

            log.info(
                "music.resolve.completed",
                extra={"session": self.session_id, "item": item_id, "attempt": versuch},
            )
            self._abkuehlung.pop(item_id, None)
            return adresse

        return None

    # -- Steuerung --------------------------------------------------------

    def pausiere(self) -> None:
        if self.voice and self.voice.is_playing():
            self.voice.pause()

    def fortsetzen(self) -> None:
        if self.voice and self.voice.is_paused():
            self.voice.resume()

    def ueberspringe(self) -> None:
        # Ein noch nicht ausgefuehrter Sprung wird hinfaellig - sonst setzte
        # die Schleife den Titel neu auf, statt ihn zu verlassen.
        self._sprungziel = None
        if self._laufend is not None:
            self._laufend.grund = Ende.UEBERSPRUNGEN
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()

    def springe(self, sekunden: int) -> None:
        """An eine Stelle des laufenden Titels springen.

        Gestoppt wird die Quelle, nicht der Titel: der Endgrund sagt der
        Wiedergabeschleife, dass sie denselben Eintrag noch einmal aufsetzen
        soll - mit `-ss` an der gewuenschten Stelle.
        """
        if not self.voice or not (self.voice.is_playing() or self.voice.is_paused()):
            raise RuntimeError("Es läuft gerade kein Titel.")
        self._sprungziel = max(0, int(sekunden))
        if self._laufend is not None:
            self._laufend.grund = Ende.SPRUNG
        self.voice.stop()

    def setze_lautstaerke(self, prozent: int) -> None:
        self.volume = max(0.0, min(prozent, 150)) / 100.0
        if self._quelle is not None:
            self._quelle.volume = self.volume

    def stoppe(self) -> None:
        """Wiedergabe anhalten - der Kanal wird dabei nicht verlassen."""
        self._sprungziel = None
        if self._laufend is not None:
            self._laufend.grund = Ende.GESTOPPT
        if self.voice and (self.voice.is_playing() or self.voice.is_paused()):
            self.voice.stop()

    async def verlasse(self) -> None:
        if self._aufgabe is not None:
            self._aufgabe.cancel()
        self.stoppe()
        if self.voice and self.voice.is_connected():
            await self.voice.disconnect()
        self.voice = None
        self._laufend = None

    def laeuft(self) -> bool:
        return bool(self.voice and self.voice.is_connected() and self.voice.is_playing())

    def zuhoerer(self) -> int:
        """Echte Zuhoerer - Bots zaehlen nicht, wie im Legacy-Bot.

        Gezaehlt wird ueber die Voice-Zustaende des Kanals, nicht ueber
        `channel.members`: letzteres braucht das privilegierte Members-Intent.
        Ist das im Developer Portal nicht aktiviert, ist die Mitgliederliste
        leer - der Bot haelte sich faelschlich fuer allein und verliesse den
        Kanal nach zwei Minuten, obwohl Leute zuhoeren.

        Laesst sich zu einer ID kein Mitglied aufloesen, zaehlt sie als echter
        Zuhoerer. Im Zweifel bleibt der Bot lieber verbunden, als jemandem
        mitten im Lied die Musik abzustellen.
        """
        if not self.voice or not self.voice.channel:
            return 0

        eigene_id = self.client.user.id if self.client.user else None

        anzahl = 0
        for benutzer_id in self.voice.channel.voice_states:
            if benutzer_id == eigene_id:
                continue
            mitglied = self.voice.channel.guild.get_member(benutzer_id)
            if mitglied is not None and mitglied.bot:
                continue
            anzahl += 1
        return anzahl
