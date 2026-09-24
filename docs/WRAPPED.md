# SwissHub Wrapped

Zwei Rückblicke in einem Modul. Sie beantworten verschiedene Fragen und
teilen sich alles darunter.

|           | Persönlicher Rückblick                                                                      | Periodische Ausgabe                               |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Frage     | Wie war dein Jahr?                                                                          | Wie war unser Monat?                              |
| Empfänger | jedes Mitglied einzeln                                                                      | Social Media                                      |
| Tabellen  | `WrappedCampaign`, `WrappedScene`, `WrappedSnapshot`, `WrappedGenerationRun`, `WrappedView` | `WrappedEdition`, `WrappedSlide`, `WrappedMoment` |
| Einheit   | Szene                                                                                       | Folie                                             |
| Ergebnis  | eine erzählte Geschichte im Browser                                                         | PNG in 1080×1920 und 1080×1350                    |

Geteilt: die Datenlage-Prüfung, die Zeitrechnung der Statistik, der Bot-Job,
die Berechtigungen, das Protokoll und der Zeichner.

## Zeiträume

Ein SwissHub-Monat beginnt um Mitternacht in **Europe/Zurich**. Der Oktober
2026 hat deshalb 745 Stunden und der März 743. Die Grenzen kommen aus
`zuercherMitternacht` – derselben Funktion, mit der die Statistik ihre
Tagesgrenzen setzt. Hartcodierte Versätze gibt es nirgends.

`periodeVon('MONTHLY', '2026-09')` → `2026-08-31T22:00Z` bis `2026-09-30T22:00Z`.

## Keine erfundene Zahl

Jede Story entscheidet selbst, ob sie etwas zu sagen hat. Hat sie nichts,
gibt sie einen **Grund** zurück statt einer Null. Die Gründe landen in
`WrappedEdition.diagnostics` und sind im Editor einsehbar.

| Grund                   | Bedeutung                                      |
| ----------------------- | ---------------------------------------------- |
| `nicht_erhoben`         | Die Quelle misst in diesem Zeitraum nicht.     |
| `nur_teilweise_erhoben` | Die Messung begann mitten im Zeitraum.         |
| `nichts_passiert`       | Gemessen wurde, es gab nichts.                 |
| `zu_wenig_vergleich`    | Für eine Rekordaussage fehlen Vergleichsdaten. |

Die Abdeckungsprüfung gilt **nur** für Sprachzeit und Nachrichten – die
beiden Quellen mit einer Marke dafür, seit wann gemessen wird. Turniere,
Termine, Clips und Auswahlrunden werden nicht gemessen; sie prüfen selbst,
ob sie etwas gefunden haben.

## Stories

Registry in `wrapped/stories.ts`. Eine neue Story ist ein Eintrag in der
Liste – kein Eingriff in Ablauf, Auswahl, Editor oder Zeichner.

| Schlüssel                                   | Quelle                                  | Vorlage                       |
| ------------------------------------------- | --------------------------------------- | ----------------------------- |
| `intro` / `outro`                           | –                                       | `INTRO` / `OUTRO`             |
| `community`                                 | `AnalyticsUserDaily`, `AnalyticsDaily`  | `TWO_STAT`                    |
| `voice_total`                               | `AnalyticsDaily`                        | `HERO_NUMBER`                 |
| `voice_record`                              | `AnalyticsDaily` + Vergleichszeitraum   | `HERO_NUMBER`                 |
| `messages`                                  | `AnalyticsDaily`                        | `HERO_NUMBER`                 |
| `tournament_winner` / `tournament_overview` | `Tournament`, `TournamentParticipant`   | `WINNER` / `TWO_STAT`         |
| `event_overview`                            | `CalendarEvent`, `CalendarRegistration` | `TWO_STAT`                    |
| `clip_winner`                               | `ClipCompetition`                       | `WINNER`                      |
| `game_pick`                                 | `SpielwahlRound.gewinner`               | `WINNER`                      |
| `community_moment`                          | `WrappedMoment`                         | `IMAGE_MOMENT`                |
| `year_numbers` / `month_overview`           | nur Jahresausgabe                       | `TWO_STAT` / `MONTH_OVERVIEW` |

Die Reihenfolge entsteht aus festen Punktwerten je Story – nicht zufällig.
Derselbe Zeitraum ergibt zweimal dieselbe Folge. Intro und Outro haben keinen
Punktwert, sondern einen Platz.

### Was es bewusst nicht gibt

- **Game of the Month** – existiert auf dem SwissHub nicht. `game_pick` zählt,
  was in den Auswahlrunden gewonnen hat, und heisst auch so.
- **SwissHub fragt** – kein Umfragesystem im Projekt.
- **Streamer Highlights** – kein Streamer Hub im Projekt.
- **Level-Ups / Prestige** – es gibt kein Ereignisprotokoll für Levelwechsel,
  nur das XP-Journal. Eine Rekonstruktion wäre teuer und nur so weit
  belastbar, wie `XpTransaction` zurückreicht.

## Zustände

```
DRAFT ──einfrieren──▶ FINALIZED ──veröffentlichen──▶ PUBLISHED
  ▲                        │                             │
  └────────── entsperren ──┴─────────────────────────────┘
```

Nur ein Entwurf lässt sich neu erheben oder bearbeiten. Entsperren ist eine
eigene Berechtigung mit eigenem Protokolleintrag – es ändert rückwirkend,
was bereits draussen sein könnte.

## Daten und Redaktion

`WrappedSlide.snapshotData` ist **erhoben** und über kein Textfeld erreichbar.
`WrappedSlide.editorialData` ist **geschrieben** und frei bearbeitbar. Ein
Tippfehler im Begleitsatz kann deshalb keine Statistik verfälschen.

Beim Neuerheben bleiben Texte und das Ein-/Ausschalten erhalten, sofern es
die Story danach noch gibt. `texteBehalten: false` ist der ausdrückliche
Gegenbefehl.

## Export

Eine Komponente – `zeichneAusgabeFolie` – speist Vorschau und Export. Im
Browser skaliert, auf dem Server durch `ImageResponse` gerastert. Vorschau
und Export können nicht auseinanderlaufen.

- `GET /api/wrapped/ausgabe/<id>/folie/<slideId>?format=story|feed` → PNG
- `GET /api/wrapped/ausgabe/<id>/export?format=story|feed` → ZIP

Das Archiv entsteht ohne Bibliothek (`wrapped/zip.ts`, STORE-Verfahren,
`node:zlib.crc32`). PNG ist bereits komprimiert; ein zweiter Durchgang spart
Promille. Der Zeitstempel ist fest, damit dieselben Folien dasselbe Archiv
ergeben.

## Scheduler

Bot-Job `wrapped-ausgaben`, stündlich. Kein Kalender, kein Zeitgeber: der
Durchgang fragt jedes Mal, ob der zuletzt abgeschlossene Monat schon
existiert. Damit überlebt er Neustarts und holt nach, wenn der Bot über den
Monatswechsel aus war.

Eine Stunde Karenz nach Zeitraumende – die Tageswerte entstehen nicht in
derselben Sekunde, in der ein Tag endet.

Gegen zwei gleichzeitige Arbeiter schützt die Eindeutigkeit von
`(guildId, type, periodKey)` auf Datenbankebene.

## Historische Zeiträume

Über «Ausgabe erzeugen» im Studio. Erfunden wird dabei nichts – die Stories
arbeiten auf denselben Daten und lassen weg, wozu es nichts gibt. Ein Monat
vor Beginn der Sprachzeitmessung bekommt keine Sprachzeit-Folie.

## Berechtigungen

| Schlüssel                  | Wofür                        |
| -------------------------- | ---------------------------- |
| `wrapped.studio.view`      | Ausgaben ansehen             |
| `wrapped.studio.edit`      | Texte und Folien bearbeiten  |
| `wrapped.generate`         | erheben und neu erheben      |
| `wrapped.edition.finalize` | einfrieren                   |
| `wrapped.edition.unlock`   | wieder aufmachen             |
| `wrapped.publish`          | als veröffentlicht markieren |
| `wrapped.export`           | Bilder herunterladen         |
| `wrapped.moments.manage`   | Community Moments pflegen    |

Die ersten drei sind die bestehenden Schlüssel des Studios – es ist dieselbe
Arbeit. Eigene Schlüssel bekommt nur, was eine eigene Entscheidung ist.

## Datenschutz

Auf einer Folie stehen: Zahlen, Turnier- und Spielnamen, der Name eines
Siegers und der Name, unter dem jemand einen gewinnenden Clip eingereicht hat
– derselbe Name, den die Hall of Fame ohnehin zeigt.

Nicht auf einer Folie: Discord-Kennungen, E-Mail-Adressen, Rollen,
Berechtigungen, Moderationshistorie, Tickets, Jails, Verifikationsdaten,
Notizen. Diese Tabellen werden von diesem Modul nicht angefasst.
