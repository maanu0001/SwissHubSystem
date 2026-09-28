# Gameserver-Orchestrierung

Turniermatches bekommen automatisch einen Spielserver: SwissHub stellt ihn
bereit, konfiguriert das Match, führt das Map-Veto, nimmt das Resultat
entgegen, sichert Demos und Logs und räumt den Server wieder weg.

Dieses Dokument beschreibt, **was einmalig ausserhalb von SwissHub
eingerichtet werden muss** und welcher Wert danach wo einzutragen ist. Alles
andere läuft über die WebApp; für den Turnierbetrieb ist kein SSH-Zugriff
nötig.

---

## Der Aufbau in vier Schichten

```
Turniermodul          Turniere, Teams, Matches, Bracket, Resultate
      ↓               (unverändert - Source of Truth)
Orchestrator          Wann braucht ein Match einen Server?
      ↓               Bereitstellen, Lebenslauf, Aufräumen, Grenzwerte
Infrastructure        Ein Treiber je Datacenter
      ↓               createServer / getServer / deleteServer
Game Adapter          Was auf der Maschine passiert
                      V1: nur Counter-Strike 2
```

Die Schichten kennen einander nur nach unten. Im Orchestrator steht kein
`CS2`, im Treiber steht kein Match, und im Turniermodul steht kein Server -
drei Tests halten das fest.

---

## Was SwissHub **nicht** selbst einrichten kann

Fünf Dinge entstehen ausserhalb. Für jedes steht unten, **was** zu tun ist,
**wo**, **warum** und welcher Wert danach in SwissHub eingetragen wird.

### 1. Zugang zum Datacenter

**Was:** Ein API-Zugang mit dem Recht, virtuelle Maschinen zu erstellen,
abzufragen und zu löschen.

**Wo:** In der Verwaltungsoberfläche des Datacenters.

**Warum:** SwissHub erzeugt Maschinen im Namen eures Kontos. Ein Zugang mit
weniger Rechten kann keine Server anlegen, einer mit mehr ist unnötiges
Risiko - insbesondere braucht SwissHub keinen Zugriff auf Abrechnung,
Benutzerverwaltung oder bestehende Produktivmaschinen.

**Trägt man ein unter:** System → Integrationen → Virtual Datacenter

| Feld        | Inhalt                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| API-Adresse | Basisadresse der API, ohne Pfad                                                    |
| Kennung     | Benutzername oder Zugriffsschlüssel-ID                                             |
| Geheimnis   | Passwort, Token oder Zugriffsschlüssel — verschlüsselt gespeichert                 |
| Projekt     | Projekt, Organisation oder virtuelles Datacenter, falls der Anbieter mehrere kennt |

Das Geheimnis wird mit `MASTER_ENCRYPTION_KEY` verschlüsselt, nie angezeigt
und nie protokolliert.

### 2. Ein Treiber für euer Datacenter

**Was:** Eine Datei in `packages/modules/src/gameserver/`, die
`InfrastrukturAnbieter` erfüllt und sich mit `registriereAnbieter` einträgt.

**Warum:** Jedes Datacenter hat eine eigene API. Die Abstraktion verlangt
sechs Methoden - `pruefe`, `createServer`, `getServer`, `startServer`,
`stopServer`, `deleteServer`; mehr braucht der Orchestrator nicht, und
weniger reicht nicht.

#### Stand der Recherche zu hosttech (September 2026)

Das Virtual Datacenter wird von **hosttech.ch** betrieben, laut Anbieter auf
KVM-Basis - also weder ein eigenes Proxmox noch VMware Cloud Director.

Öffentlich auffindbar ist:

- hosttech bewirbt für das vDC eine **RESTful API**, über die alle Funktionen
  des Cloud Control Panels erreichbar sein sollen, sowie zusätzliche
  API-Methoden für Skripte.
- Die **DNS-API** (`api.ns1.hosttech.eu`) ist öffentlich dokumentiert und hat
  mehrere Open-Source-Clients (libdns, lego, cert-manager). **Sie kann keine
  VMs.** Wer nach «hosttech API» sucht, findet zuerst diese - sie ist nicht
  gemeint.

**Nicht auffindbar** ist die eigentliche Referenz der vDC-Compute-API:
weder eine öffentliche Endpunktliste noch ein Terraform-Provider noch ein
API-Client für Server. Ohne sie lässt sich kein Treiber schreiben, der nicht
geraten wäre - und geraten wird hier nichts.

#### Was bei hosttech anzufragen ist

1. **Die API-Referenz des Virtual Datacenter für Compute** - Basis-URL,
   Version, Endpunktliste. Ausdrücklich die vDC-/Server-API, **nicht** die
   DNS-API.
2. **Das Authentifizierungsverfahren** - API-Token, Benutzer/Passwort oder
   OAuth; wo der Schlüssel erzeugt wird und ob er sich auf ein Projekt
   einschränken lässt.
3. **Ob die Plattform eine bekannte Standard-API spricht** - Apache
   CloudStack, OpenStack (Nova), oder eine hauseigene. Das ist die wichtigste
   Frage: bei CloudStack oder OpenStack gibt es bewährte Clients, und der
   Treiber wird ein Bruchteil der Arbeit.
4. **Die konkreten Aufrufe** für: VM aus Template erstellen, Status abfragen,
   starten, stoppen, löschen.
5. **Wie eine Startkonfiguration übergeben wird** - cloud-init/user-data
   oder etwas anderes. SwissHub braucht genau einen Weg, dem Agenten sein
   Token mitzugeben.
6. **Wie eine VM-Vorlage entsteht** und unter welcher Kennung sie in der API
   erscheint (das wird der Wert im Feld «Kennung der Vorlage beim Anbieter»).
7. **Wie die öffentliche IP-Adresse gemeldet wird** und ob sie sofort oder
   erst nach dem Start feststeht.
8. **Wie Firewall-Regeln gesetzt werden** - über die API oder nur im Panel.
9. **Grenzwerte**: wie viele VMs parallel erstellt werden dürfen, ob es ein
   Rate Limit auf der API gibt und wie es sich meldet.
10. **Ob ein Testprojekt möglich ist**, in dem SwissHub provisionieren darf,
    ohne die produktive Umgebung zu berühren.

**Stand heute:** Es gibt genau einen Treiber, `simulation`. Er erzeugt
**keine** echten Maschinen und sagt das auch: in der Infrastrukturübersicht
steht neben ihm «Simulation». Er ist für Tests und zum Einrichten da.

Sobald die API-Dokumentation eures Datacenters vorliegt, kommt der echte
Treiber als eine Datei dazu. Der Rest des Moduls bleibt unberührt - das ist
der Zweck der Abstraktion.

**Trägt man ein unter:** Turniere → Gameserver → Infrastruktur (der Treiber
erscheint dort in der Auswahl, sobald er registriert ist)

### 3. Das VM-Abbild

**Was:** Ein Maschinenabbild, auf dem bereits installiert sind:

- der **CS2 Dedicated Server**
- ein **CS2-Match-Plugin** (Konfiguration per JSON, Ready-System, Knife
  Round, Pausen, Backup-Runden, Ergebnis-Webhook)
- der **SwissHub Game Agent** aus `apps/game-agent`, als systemd-Dienst
  `swisshub-agent`, der `/etc/swisshub-agent/agent.env` liest
- ein systemd-Dienst für den Spielserver, standardmässig `cs2-server`

**Warum:** Das Startskript von SwissHub installiert **nichts** und lädt
nichts nach. Eine Maschine, die beim Start aus dem Netz nachlädt, hängt an
einem fremden Server, und der ist auch mal weg - mitten im Turnierabend.
Alles, was gebraucht wird, liegt im Abbild; das Startskript schreibt nur die
Zugangsdaten hinein und startet den Agenten.

**Trägt man ein unter:** Turniere → Gameserver → Templates, Feld «Kennung
der Vorlage beim Anbieter»

### 4. Netzwerk und Firewall

**Was:** Die Ports, die von aussen erreichbar sein müssen:

| Port          | Wofür               | Für wen                       |
| ------------- | ------------------- | ----------------------------- |
| 27015/udp+tcp | CS2-Spielserver     | alle Spieler                  |
| 27020/udp     | GOTV                | Zuschauer und Caster          |
| 9443/tcp      | SwissHub Game Agent | **nur** die SwissHub-Maschine |

**Warum der Agent-Port eingeschränkt gehört:** Er ist durch Signaturen
geschützt - jede Anfrage trägt Zeitstempel, Einmalwert und HMAC mit dem
maschineneigenen Token. Trotzdem gilt: was nicht erreichbar ist, muss nicht
verteidigt werden.

**Trägt man ein unter:** nichts - das ist eine Einstellung im Datacenter.
Die Ports selbst stehen im Template.

### 5. `MASTER_ENCRYPTION_KEY`

**Was:** Der Hauptschlüssel der Anwendung, mit dem die Zugangsdaten des
Datacenters, die RCON-Passwörter und die Agent-Tokens verschlüsselt werden.

**Warum:** Er existiert bereits für die übrigen Integrationen. Ohne ihn
startet die Anwendung in der Produktion nicht - hier wird er nur
mitbenutzt.

---

## Was danach in der WebApp passiert

1. **Infrastruktur** — Anbieter anlegen, Treiber wählen, Verbindung prüfen.
2. **Templates** — Maschinenzuschnitt: Abbild, CPU, RAM, Disk, Ports,
   Höchstlaufzeit, Schonfrist.
3. **Game Profiles** — Map-Pool, Slots, Overtime, Knife Round, Pausen, GOTV,
   Demos, Ready-Regel, Passwortstrategie.
4. **Moduleinstellungen** — Gameserver einschalten, Grenzwerte setzen.
5. **Turnier** — ein Game Profile wählen. Fertig.

Ab dann entsteht für jedes Match zur eingestellten Zeit ein Server.

---

## Die Zusagen, auf die man sich verlassen kann

**Ein Match bekommt einen Server.** `MatchServerAssignment` trägt
`@@unique([matchId, generation])` und wird vor dem Anbieter geschrieben.
Zwei Worker, zwei Bot-Instanzen, ein Retry nach einem Neustart - keiner
kommt an der Datenbank vorbei.

**Ein Veto-Schritt wird einmal belegt.** `@@unique([assignmentId, stepIndex])`.
Zwei gleichzeitige Klicks können nicht beide Schritt 3 sein. Jeder Schritt
liegt in der Datenbank; ein Neustart mitten im Veto verliert nichts.

**Der Bracket rückt nur bei einem eindeutigen Resultat weiter.** Ist es das
nicht - abgebrochenes Match, fehlende Map, Unentschieden, wo keines sein
darf -, geht es an einen Menschen. Das Rohe bleibt gespeichert.

**Dateien vor Löschung.** Eine Maschine, deren Archivierung fehlschlug, wird
nicht automatisch entfernt. Lieber eine Maschine zu viel als eine Demo zu
wenig.

**Keine freie Shell, keine freie Konsole.** Der Agent kennt zehn feste
Aktionen; keine nimmt einen Befehl entgegen. In der WebApp gibt es kein
RCON-Eingabefeld. Die RCON-Passwörter sind je Maschine zufällig, liegen
verschlüsselt und verschwinden mit der Maschine.

---

## Die Erweiterung ist freiwillig

Ohne Konfiguration passiert **nichts** - und zwar wirklich nichts:

- Der Durchgang im Bot prüft einmal `konfigurationsStand()` und ist fertig.
  Keine Abfrage an ein Datacenter, keine Warnung, kein Protokolleintrag.
  Diese Funktion wirft nie; fällt die Datenbank aus, meldet sie
  «unbekannt» statt einer Ausnahme.
- Die Matchansicht lädt den Match Room in einem `try`. Ein Match ohne
  Serverzuweisung sieht aus wie immer - und eines, bei dem beim Laden etwas
  schiefgeht, ebenfalls. Eine Seite, die es seit Monaten gibt, darf an einer
  neuen Erweiterung nicht scheitern.
- Die Gameserver-Übersicht sagt in einem Satz, was fehlt, und wo man es
  einträgt. Kein rotes Banner: ein Turnier ohne Gameserver ist ein normales
  Turnier.
- Ein eingetragener Anbieter, für den es keinen Treiber gibt, ist eine
  Lücke in der Liste - kein Absturz.
- Fehlt `MASTER_ENCRYPTION_KEY`, scheitert eine Bereitstellung mit genau
  diesem Satz in der Zuordnung, statt mit einer Ausnahme.

`tests/integration/gameserver-optional.test.ts` prüft das gegen eine
Datenbank, in der nichts eingerichtet ist - und ohne Hauptschlüssel.

## Ein zweites Spiel ergänzen

Drei Schritte, alle additiv:

1. `GameServerGame` in `schema.prisma` um den Wert erweitern (additive
   Migration).
2. Eine Datei unter `packages/modules/src/gameserver/<spiel>/adapter.ts`,
   die `GameAdapter` erfüllt und sich mit `registriereAdapter` einträgt.
   Darin: Ports, Map-Anzahl je Modus, Veto-Ablauf, Prüfung der
   Spielerkennung, in welchem Profilfeld sie steht, Konfigurationsformat,
   Start/Stop, Health, Pause/Unpause/Restore, Ergebnisdeutung, Dateien.
3. Den Import in `packages/modules/src/gameserver/index.ts` ergänzen, damit
   die Registrierung läuft.

Orchestrator, Treiber, WebApp, Veto, Grenzwerte, Aufräumen und Resultat
bleiben unberührt. Ein Test prüft, dass im Orchestrator kein Spielname
steht - er ist die Zusage, dass dieser Weg weiterhin genügt.
