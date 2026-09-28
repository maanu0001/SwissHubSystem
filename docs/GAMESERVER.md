# Gameserver: vorbereitete Hosts, dynamische Match-Instanzen

Turniermatches bekommen automatisch einen Spielserver. SwissHub startet ihn
als **Container auf einem vorbereiteten Host**, konfiguriert das Match,
führt das Map-Veto, nimmt das Resultat entgegen, sichert Demos und Logs und
räumt den Container wieder weg.

Dieses Dokument beschreibt, **was einmalig auf einem Host eingerichtet
werden muss** — und was danach vollständig aus der WebApp läuft. Für den
normalen Turnierbetrieb ist kein SSH nötig.

---

## Der Aufbau

```
Turniermodul          Turniere, Teams, Matches, Bracket, Resultate
      ↓               (unverändert – Source of Truth)
Orchestrator          Wann braucht ein Match einen Server?
      ↓               Lebenslauf, Grenzwerte, Aufräumen
Host Scheduler        Welcher Host? Passt das Spiel, reicht die Kapazität,
      ↓               sind Ports frei?
Gameserver Host       Lang laufende Linux-Maschine mit Docker
      ↓
Game Agent            Ein Dienst je Host, feste Aktionen, keine Shell
      ↓
Match Instance        Ein Container je Match
```

Die Schichten kennen einander nur nach unten. Im Orchestrator und im
Scheduler steht kein `CS2`; im Agenten steht kein Match; im Turniermodul
steht kein Container. Tests halten das fest.

### Host und Match-Instanz sind zwei Dinge

|             | **Gameserver-Host**            | **Match-Instanz**                         |
| ----------- | ------------------------------ | ----------------------------------------- |
| Lebensdauer | Wochen bis Monate              | Minuten bis Stunden                       |
| Beispiel    | `SH-GAME-HOST-01`              | `swisshub-cs2-clx8f2…`                    |
| Enthält     | Linux, Docker, Agent, Abbilder | ein Spiel, ein Match, Ports, Config, Logs |
| Entsteht    | einmal, von Hand               | je Match, automatisch                     |
| Modell      | `GameServerHost`               | `GameServerInstance`                      |

---

## Was einmalig auf einem Host eingerichtet werden muss

Fünf Dinge. Danach läuft alles über die WebApp.

### 1. Linux mit Docker

Ein Server im Virtual Datacenter, eine übliche Linux-Distribution, Docker
installiert und laufend. Der Agent spricht Docker über die Kommandozeile an
und braucht dafür die Rechte des Benutzers, unter dem er läuft.

**Warum:** Match-Instanzen sind Container. Ohne Docker gibt es keine.

### 2. Der SwissHub Game Agent

Das Verzeichnis `apps/game-agent` aus diesem Repository, gebaut mit
`npm run agent:build`, auf den Host gelegt und als Dienst gestartet.

Umgebungsvariablen:

| Variable                      | Bedeutung                                                                  |
| ----------------------------- | -------------------------------------------------------------------------- |
| `SWISSHUB_URL`                | Basisadresse von SwissHub, etwa `https://system.swisshub.gg`               |
| `SWISSHUB_REGISTRATION_TOKEN` | Das einmalige Token aus dem Dashboard — nur beim ersten Start              |
| `SWISSHUB_AGENT_TOKEN_FILE`   | Wo die dauerhafte Identität liegt, Vorgabe `/etc/swisshub/agent-token`     |
| `SWISSHUB_AGENT_PORT`         | Auf welchem Port der Agent lauscht, Vorgabe `9443`                         |
| `SWISSHUB_HOST_DATA_ROOT`     | Wo Demos und Logs je Instanz liegen, Vorgabe `/var/lib/swisshub/instances` |

**Warum ein Registrierungs-Token und kein festes Passwort:** Ein gemeinsames
Token für alle Hosts wäre ein Generalschlüssel. Stattdessen legt ein Admin
den Host im Dashboard an, erzeugt dort ein Token, das **einmal** gilt und
nach einer Stunde verfällt, und der Agent tauscht es beim ersten Start gegen
eine dauerhafte, nur für diesen Host gültige Identität. In der Datenbank
steht vom Registrierungs-Token nur der SHA-256, von der Identität nur der
verschlüsselte Umschlag.

### 3. Netzwerk und Firewall

- **Eingehend erlaubt:** der Agent-Port (nur von SwissHub aus) und die
  Portbereiche für Spiel, Query und GOTV (von überall — dort verbinden sich
  die Spieler).
- **Ausgehend erlaubt:** die Registry, von der die Abbilder geladen werden.

**Warum getrennte Bereiche:** Der Port-Allocator zieht je Instanz einen
Spielport, einen Query-Port und einen GOTV-Port. Überschneiden sich die
Bereiche, frisst einer den anderen auf; die WebApp weist das beim Speichern
des Hosts ab.

### 4. `MASTER_ENCRYPTION_KEY` auf dem SwissHub-Server

Ohne ihn lässt sich die Identität eines Hosts nicht lesen und das
RCON-Passwort einer neuen Instanz nicht schreiben. Erzeugen mit
`openssl rand -base64 32`.

### 5. Ein Container-Abbild für das Spiel

Ein Docker-Abbild, das einen CS2-Server startet und dabei diese
Umgebungsvariablen versteht:

| Variable                                                       | Wer setzt sie | Bedeutung                    |
| -------------------------------------------------------------- | ------------- | ---------------------------- |
| `SWISSHUB_RCON_PASSWORD`                                       | Orchestrator  | RCON-Passwort dieser Instanz |
| `SWISSHUB_SERVER_PASSWORD`                                     | Orchestrator  | Lobbypasswort                |
| `SWISSHUB_GAME_PORT`                                           | Adapter       | Spielport **im Container**   |
| `CS2_SERVERNAME`, `CS2_MAXPLAYERS`, `CS2_TICKRATE`, `CS2_GOTV` | CS2-Adapter   | Grundeinstellungen           |

Das Abbild schreibt Demos und Logs in das Datenverzeichnis und liest die
Matchkonfiguration aus dem Konfigurationsverzeichnis; beide Pfade stehen im
Runtime-Image und werden vom Agenten als Bind-Mount gesetzt.

**Eingetragen wird es unter:** Turniere → Gameserver → Runtime-Images

---

## Danach: alles im Dashboard

| Bereich            | Was dort eingestellt wird                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosts**          | Name, Adresse, Region, Gruppe, erlaubte Spiele, Kapazität, Reserven, Portbereiche, Status                                                                                           |
| **Host-Detail**    | Registrierung, Verbindung testen, Abbilder abgleichen und laden, Drain, Wartung, Abschalten, Entfernen                                                                              |
| **Runtime-Images** | Abbild, Tag, Startargumente, Mountpfade, Ports im Container, Startzeit                                                                                                              |
| **Game Profiles**  | Map-Pool, Slots, Overtime, Pausen, Knife, Warmup, Ready-Regel, GOTV, Demos, Coach-/Caster-Plätze, Plugin, Tickrate, CPU-/RAM-/Disk-Limits, maximale Laufzeit, bevorzugte Hostgruppe |
| **Infrastruktur**  | Gesamtlage über alle Hosts, Grenzwerte, Anbieter (nur für spätere Selbstprovisionierung)                                                                                            |
| **Match Room**     | Veto, Ready, Start, Pause, Fortsetzen, Wiederherstellen, Instanz stoppen, Instanz neu erstellen, Host vorgeben                                                                      |

**Kein SSH** für diese Dinge. Und ausdrücklich **nicht** im Dashboard: keine
Shell, keine Docker-Kommandozeile, keine RCON-Konsole, kein Dateieditor,
kein Feld für beliebige Container-Argumente.

---

## Die Zusagen, auf die man sich verlassen kann

**Ein Match bekommt einen Server.** `@@unique([matchId, generation])` auf
`MatchServerAssignment`, geschrieben bevor irgendetwas anderes passiert.

**Ein Port gehört einem.** `@@unique([hostId, port])` auf
`HostPortReservation`. Reservieren heisst: eine Zeile anlegen. Zwei
gleichzeitige Matches können denselben Port nicht ziehen, ein Neustart
verliert keine Reservierung, und ein Absturz mitten im Erstellen hinterlässt
eine Zeile, die das Aufräumen findet.

**Ein Host nimmt nicht mehr an, als er trägt.** `SELECT … FOR UPDATE` auf die
Hostzeile, dann zählen, dann schreiben. Ohne diese Sperre wäre jede Grenze
eine Empfehlung: zwanzig gleichzeitige Anforderungen sähen alle dieselben
«noch drei Plätze frei».

**Ein Veto-Schritt wird einmal belegt.**
`@@unique([assignmentId, stepIndex])`.

**Der Bracket rückt nur bei einem eindeutigen Resultat weiter.** Alles andere
geht an einen Menschen, und das Rohe bleibt gespeichert.

**Ein Registrierungs-Token gilt einmal.** Bedingte Schreiboperation; wer sie
gewinnt, registriert.

**Demos und Logs sind vor dem Container weg.** Erst archivieren, dann
stoppen, dann entfernen, dann die Ports freigeben. Eine Zuordnung in
`ARCHIVE_ERROR` wird übersprungen, bis jemand hinsieht.

---

## Was der Agent kann — und was nicht

Siebzehn feste Aktionen. Es gibt kein `executeCommand`, keinen Endpunkt, der
einen Pfad entgegennimmt, keinen, der Docker-Argumente entgegennimmt, und
keine Funktion, die einen Text an eine Shell gibt (`spawn` mit
Argumentliste statt `exec` mit einer Zeile).

Jede Anfrage trägt Zeitstempel, Einmalwert und HMAC-SHA256 mit dem Token des
Hosts. Abgelaufene, zukünftige und wiedereingespielte Anfragen werden
abgewiesen; ein unbekannter Pfad ist 404, noch vor der Signaturprüfung.

**Die Instanzkennung steht im signierten Rumpf, nicht im Pfad.** Der
naheliegende Weg wäre `/instances/<id>/match/pause` gewesen — er hätte die
Pfadprüfung von einer Liste in ein Muster verwandelt, und ein Muster ist
eine Auslegungssache. Die Signatur deckt den Rumpf-Hash ab; die Kennung ist
damit genauso geschützt, wie sie als Pfadsegment wäre.

Der Container läuft mit `--cap-drop ALL`, `--security-opt no-new-privileges`
und `--restart no`. Kein `--privileged`, kein `--network host`, keine
zusätzlichen Fähigkeiten und keine Mounts ausser den beiden Verzeichnissen,
deren Pfad der Agent selbst aus seinem Wurzelverzeichnis und der geprüften
Instanzkennung bildet.

---

## Wenn etwas ausfällt

| Fall                          | Was passiert                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Container startet nicht       | Instanz auf `FAILED`, Ports zurück, Grund in der Zuordnung                                          |
| Host antwortet nicht mehr     | Nach drei verpassten Abfragen `OFFLINE`; betroffene Instanzen `FAILED`, Matches `MATCH_INTERRUPTED` |
| Container kaputt, Match nicht | «Instanz neu erstellen» — gleiches Match, gleiches Veto, neue Generation                            |
| Host soll gewartet werden     | `DRAINING` oder `MAINTENANCE`: keine neuen Matches, laufende laufen aus                             |

**Kein automatischer Umzug eines laufenden Matches.** Ein laufendes
CS2-Match lässt sich nicht verlustfrei verschieben; ein Umzug, der so tut,
als ginge es, kostet den Spielstand. Die Turnierleitung entscheidet.

---

## Ein zweiter Host

1. Host im Dashboard anlegen (Adresse, Kapazität, Portbereiche, erlaubte Spiele).
2. Registrierungs-Token erzeugen.
3. Auf der Maschine: Docker, Agent, `SWISSHUB_URL` und das Token setzen, Dienst starten.
4. Im Host-Detail «Fehlende laden» — die Abbilder kommen auf den Host.
5. Fertig. Der Scheduler nimmt ihn ab dem nächsten Match mit.

Mehr ist nicht nötig: die Game Profiles, die Runtime-Images und die
Grenzwerte gelten für alle Hosts.

---

## Später: hosttech-Auto-Scaling

Der Provider-Layer bleibt erhalten, wird für vorbereitete Hosts aber **nicht
gebraucht**. Er ist der Weg zu einer Ausbaustufe, in der SwissHub selbst
Hosts erzeugt:

```
freie Kapazität < Schwellwert
      ↓
Provider-Treiber → neue VM aus einem Template
      ↓
Agent registriert sich mit einem Token aus der Startkonfiguration
      ↓
Host wird ACTIVE, Scheduler nimmt ihn mit
```

Alles davon ist vorbereitet — ausser dem Treiber. Dafür fehlt die
Compute-API des Datacenters.

### Stand der Recherche zu hosttech (September 2026)

Das Virtual Datacenter wird von **hosttech.ch** betrieben, laut Anbieter auf
KVM-Basis — also weder ein eigenes Proxmox noch VMware Cloud Director.

Öffentlich auffindbar ist nur, dass für das vDC eine **RESTful API**
beworben wird. Die gut dokumentierte hosttech-API ist die **DNS-API**
(`api.ns1.hosttech.eu`); **sie kann keine VMs** und ist nicht gemeint. Eine
Endpunktliste für Compute, ein Terraform-Provider oder ein API-Client waren
nicht zu finden.

Ohne diese Unterlagen liesse sich nur raten, und geraten wird hier nichts.

**Was bei hosttech anzufragen ist:**

1. Die API-Referenz des Virtual Datacenter für **Compute** — Basis-URL,
   Version, Endpunktliste. Ausdrücklich die vDC-/Server-API, **nicht** die DNS-API.
2. Das Authentifizierungsverfahren — API-Token, Benutzer/Passwort oder OAuth;
   wo der Schlüssel erzeugt wird und ob er sich auf ein Projekt einschränken lässt.
3. **Ob die Plattform eine bekannte Standard-API spricht** — Apache
   CloudStack, OpenStack (Nova) oder eine hauseigene. Das ist die wichtigste
   Frage: bei CloudStack oder OpenStack gibt es bewährte Clients, und der
   Treiber wird ein Bruchteil der Arbeit.
4. Die konkreten Aufrufe für: VM aus Template erstellen, Status abfragen,
   starten, stoppen, löschen.
5. Wie eine Startkonfiguration übergeben wird — cloud-init/user-data oder
   etwas anderes. SwissHub braucht genau einen Weg, dem Agenten sein
   Registrierungs-Token mitzugeben.
6. Wie eine VM-Vorlage entsteht und unter welcher Kennung sie in der API erscheint.
7. Wie die öffentliche IP-Adresse gemeldet wird und ob sie sofort feststeht.
8. Wie Firewall-Regeln gesetzt werden — über die API oder nur im Panel.
9. Grenzwerte: wie viele VMs parallel erstellt werden dürfen, ob es ein Rate
   Limit auf der API gibt und wie es sich meldet.
10. Ob ein Testprojekt möglich ist, in dem SwissHub provisionieren darf,
    ohne die produktive Umgebung zu berühren.

---

## Ein zweites Spiel ergänzen

Eine Datei: ein `GameAdapter` mit `profilPlattform`, `benoetigtePorts`,
`laufzeitUmgebung`, Veto-Ablauf, Ergebnisdeutung und den Match-Aktionen.
Dazu ein Wert im `GameServerGame`-Enum, ein Runtime-Image und ein Game
Profile in der Oberfläche.

Orchestrator, Host Scheduler, Port-Allocator, Agent, Aufräumen, Match Room
und Resultatübernahme bleiben unberührt. Drei Strukturtests stellen sicher,
dass das so bleibt: sobald ein Spielname in den Orchestrator oder den
Scheduler wandert, fallen sie.
