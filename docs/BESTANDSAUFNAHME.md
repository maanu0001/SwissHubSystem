# Bestandsaufnahme: was es zu sichern gibt

Diese Datei ist die Grundlage aller übrigen Backup-Dokumente. Sie hält fest,
**was tatsächlich existiert** - nicht, was existieren sollte.

Jede Zeile hat eine Herkunft. Was aus dem Quelltext oder einer
Konfigurationsdatei belegt ist, steht ohne Vorbehalt. Was nur auf dem
produktiven Server nachprüfbar ist, steht unter **Auf dem Server zu prüfen**
und ist bewusst nicht als Tatsache formuliert: eine erfundene Bestandsaufnahme
wäre schlimmer als keine, weil ein Wiederherstellungsplan darauf aufbaut.

Stand der Erhebung: 2026-09-25, aus dem Repository-Stand `31f1874`.

---

## 1. Was von hier aus einsehbar war

| Quelle                                    | Zugriff                    |
| ----------------------------------------- | -------------------------- |
| `maanu0001/SwissHub_Bot-WebApp`           | vollständig (Arbeitskopie) |
| `maanu0001/SwissHubSystem`                | lesend (geklont)           |
| `maanu0001/SwissHubGG`                    | lesend (geklont)           |
| `maanu0001/SwissHubSponsoring`            | lesend (geklont)           |
| Produktiver Server (`system.swisshub.gg`) | **kein Zugriff**           |
| Backup-Speicher, S3, DNS-Konto            | **kein Zugriff**           |

Der produktive Server war aus dieser Umgebung nicht erreichbar. Alles, was
seinen Ist-Zustand betrifft - freier Speicherplatz, vorhandene Cronjobs,
tatsächliche PostgreSQL-Nebenversion, ob die Sicherung aus `deploy/backup.sh`
überhaupt eingerichtet ist -, ist deshalb **unbekannt** und nicht geraten.
`scripts/bestandsaufnahme.sh` in diesem Repository erhebt genau diese Werte auf
dem Server und gibt sie als Bericht aus.

---

## 2. Die vier Repositories

`maanu0001/SwissHubSystem` ist **kein eigener Dienst**. Sein Baum ist auf dem
Commit `31f1874` zeichengleich mit `SwissHub_Bot-WebApp`; verglichen wurden
Commit-Kennung und die vollständige Dateiliste. Es ist ein zweiter Remote
desselben Projekts.

Das ist für die Wiederherstellung kein Nebenaspekt: es gibt damit bereits eine
zweite Kopie des Quelltexts. Sie liegt allerdings im **selben GitHub-Konto** -
gegen einen Ausfall von GitHub oder den Verlust dieses Kontos hilft sie nicht.

Bleiben drei Dienste:

| Dienst              | Repository            | Domain                   | Produktiver Commit |
| ------------------- | --------------------- | ------------------------ | ------------------ |
| System-WebApp + Bot | `SwissHub_Bot-WebApp` | `system.swisshub.gg`     | `31f1874`          |
| Öffentliche Website | `SwissHubGG`          | `swisshub.gg`, `www`     | `b67a00a`          |
| Sponsoring-WebApp   | `SwissHubSponsoring`  | `sponsoring.swisshub.gg` | `1314be8`          |

Die genannten Commits sind die Spitzen der Standardbranches zum Zeitpunkt der
Erhebung, **nicht** notwendigerweise der Stand, der produktiv läuft. Welcher
Commit wirklich läuft, steht nur auf dem Server (`git rev-parse HEAD` in
`/opt/swisshub` bzw. dem jeweiligen Projektverzeichnis) - genau deshalb nimmt
die Sicherung diesen Wert bei jedem Lauf mit auf.

---

## 3. Dienst 1: System-WebApp und Discord-Bot

Belegt durch `docker-compose.prod.yml`, `Dockerfile`, `.env.example`,
`deploy/nginx/system.swisshub.gg.conf`, `deploy/systemd/*`.

### Container

| Dienst          | Abbild                          | Aufgabe                                      |
| --------------- | ------------------------------- | -------------------------------------------- |
| `postgres`      | `postgres:16-alpine`            | Datenbank                                    |
| `migrate`       | `swisshub-migrate:latest`       | `prisma migrate deploy`, läuft einmal        |
| `web`           | `swisshub-web:latest`           | Next.js, nur auf `127.0.0.1:3000`            |
| `bot`           | `swisshub-bot:latest`           | discord.js, keine offenen Ports              |
| `music-runtime` | `swisshub-music-runtime:latest` | Python, FFmpeg/Opus/yt-dlp, kein Port aussen |

### Persistente Datenträger

| Volume              | Einhängepunkt               | Inhalt             | Im DB-Dump enthalten? |
| ------------------- | --------------------------- | ------------------ | --------------------- |
| `swisshub-postgres` | `/var/lib/postgresql/data`  | PostgreSQL-Cluster | ist der Dump          |
| `swisshub-uploads`  | `/var/lib/swisshub/uploads` | siehe unten        | **nein**              |

`swisshub-uploads` ist bei `web` beschreibbar und bei `bot` **nur lesend**
eingehängt. Das ist für die Sicherung wichtig: es gibt genau einen Schreiber.

### Was im Upload-Verzeichnis liegt

Ermittelt aus `packages/modules/src/branding/storage.ts` und den Stellen, die
`UPLOAD_DIR` weiterverwenden:

| Unterverzeichnis | Quelle                   | Inhalt                         |
| ---------------- | ------------------------ | ------------------------------ |
| (Wurzel)         | `branding/storage.ts`    | Logo, Levelkarten-Hintergründe |
| `appeals/`       | `appeals/attachments.ts` | Anhänge zu Entbannungsanträgen |
| `transcripts/`   | `tickets/transcript.ts`  | Ticket-Verläufe als HTML       |
| `analytics/`     | `analytics/media.ts`     | Medien der Auswertungen        |

Alle vier tragen Verweise in der Datenbank. Datei und Verweis müssen deshalb
**zum selben Zeitpunkt** wiederherstellbar sein - eine Datenbank von 14:00 mit
Dateien von 03:30 ergibt totverweisende Anhänge.

### Datenbank

PostgreSQL 16 (`postgres:16-alpine`), Zeitzone `Europe/Zurich`. Ein Cluster,
eine Datenbank (`swisshub`), Schema `public`. Prisma-Schema: 7707 Zeilen,
78 angewandte Migrationen. `prisma migrate deploy` läuft im eigenen Container
vor `web`, `bot` und `music-runtime` (`service_completed_successfully`).

Die Migrationshistorie liegt als Tabelle `_prisma_migrations` **in derselben
Datenbank**. Sie ist damit Teil jeder Sicherung - und sie muss es sein: ohne
sie hält Prisma jede Migration für ausstehend.

### Geheimnisse

Zwei Schichten, und der Unterschied entscheidet über die Wiederherstellbarkeit.

**Schicht 1 - in der Serverumgebung (`/opt/swisshub/.env`, `chmod 600`):**

| Variable                     | Wozu                          | Nach Verlust      |
| ---------------------------- | ----------------------------- | ----------------- |
| `MASTER_ENCRYPTION_KEY`      | ver-/entschlüsselt Schicht 2  | **unersetzlich**  |
| `AUTH_SECRET`                | Sessions, CSRF                | neu erzeugbar     |
| `POSTGRES_PASSWORD`          | Datenbankzugang               | neu setzbar       |
| `SWISSHUB_OWNER_DISCORD_ID`  | Notzugang                     | neu setzbar       |
| `PAYMENT_API_KEY`, `…SECRET` | Zahlungsanbieter              | beim Anbieter neu |
| `MUSIC_RUNTIME_KEY`          | WebApp ↔ Musik-Laufzeit       | neu erzeugbar     |
| `ANTHROPIC_API_KEY` u.a.     | Rückfall, sofern noch gesetzt | beim Anbieter neu |

**Schicht 2 - AES-256-GCM-verschlüsselt in der Tabelle `IntegrationSecret`:**
Discord Bot Token, Discord OAuth Client Secret, AI-Schlüssel, Tokens der
Musik-Bots. Umschlagformat `v1.<schlüsselKennung>.<iv>.<tag>.<geheimtext>`,
der Authentifizierungsanhang bindet Bereich, Guild, Anbieter und Feld
(`packages/secrets/src/crypto.ts`).

**Daraus folgt die wichtigste einzelne Tatsache dieser Bestandsaufnahme:**

> Eine Datenbanksicherung ohne den `MASTER_ENCRYPTION_KEY` ist wertlos für
> alles in Schicht 2. Der Schlüssel steht ausschliesslich in der `.env` auf
> dem produktiven Server. Geht der Server verloren, sind Bot-Token, OAuth und
> AI-Schlüssel aus dem Backup **nicht rekonstruierbar** - nur neu zu beschaffen,
> teilweise mit Ausfall des Bots und aller Anmeldungen.

Der Schlüssel muss deshalb **getrennt von den mit ihm verschlüsselten Daten**
und getrennt von der `.env` gesichert werden. Das ist keine Verfeinerung,
sondern die Voraussetzung dafür, dass eine Wiederherstellung überhaupt
vollständig sein kann.

### Hintergrundjobs

`apps/bot/src/jobs.ts` führt eine Job-Schleife: Herzschlag alle 20 Sekunden
(schreibt in die Datenbank **und** nach `/tmp/swisshub-bot-alive`, worauf der
Docker-Healthcheck prüft), Jail-Sweep alle 30 Sekunden, Discord-Abgleich alle
15 Minuten, dazu Jobs für Kalender, Level, Tickets, Turniere, Verifikation,
Wrapped, Clips, Premium, Analytics, Voice.

Alle Jobs sind laut Quelltext idempotent und überlappungsfrei; der Zustand
liegt in der Datenbank. Für die Wiederherstellung heisst das: es gibt **keinen
Zustand nur im Arbeitsspeicher**, der verloren gehen könnte. Für einen
Restore-Test heisst es das Gegenteil von harmlos - dieselben Jobs würden in
einer Testumgebung echte Discord-Nachrichten schicken und echte Rollen
vergeben, wenn sie mit echten Tokens starten.

### Netzwerk und Zertifikate

nginx auf dem Host terminiert TLS (`/etc/letsencrypt/live/system.swisshub.gg/`),
Certbot erneuert per Timer, `client_max_body_size 72m`. Der Deploy-Workflow
fasst nginx ausdrücklich **nicht** an - die Datei liegt nur im Repository und
muss von Hand auf den Server. Sie ist damit Teil der Konfigurationssicherung.

DNS: `system.swisshub.gg` (A/AAAA). Das DNS-Konto ist nicht Teil dieses
Repositories und für eine Wiederherstellung auf neuer Hardware zwingend
erforderlich - ohne Zugriff darauf zeigt die Domain weiter auf den verlorenen
Server.

### Deployment

`.github/workflows/deploy.yml`, ausgelöst durch Push auf `production`. Job
`validate` (Lint, Typecheck, Tests gegen echtes PostgreSQL 16, Build), danach
`deploy` per SSH: `git reset --hard origin/production`, `docker compose build`,
`up -d`, Abbildvergleich je Dienst, Migrationsprüfung, Gesundheitswartezeit bis
300 s, externer Aufruf von `https://system.swisshub.gg`.

Secrets des Workflows: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`,
`DEPLOY_PORT`.

**Was die Pipeline heute nicht tut:** sie prüft vor einer Migration nicht, ob
ein gültiger Wiederherstellungspunkt existiert. Eine fehlerhafte Migration auf
`production` ist damit ein Schreibvorgang ohne Netz.

---

## 4. Dienst 2: Öffentliche Website (`SwissHubGG`)

Belegt durch `docker-compose.yml`, `scripts/backup.sh`, `scripts/restore.sh`,
`deploy/nginx/*.conf`.

- **Eigener PostgreSQL 16** (`db`), eigenes Volume `db-data`, `LANG=de_CH.UTF-8`
- **Eigenes Medienvolume** `media-data` auf `/data/storage` (`STORAGE_DIR`)
- Anwendung auf `127.0.0.1:3000`, nginx aussen, eigenes Prisma-Schema
- Migrationen über ein Profil-Dienst `migrate` (`docker compose run --rm migrate`)

Vorhandene Sicherung: `scripts/backup.sh` erzeugt je Lauf ein Verzeichnis mit
`datenbank.dump` (`pg_dump --format=custom`), `medien.tar.gz` und
`pruefsummen.sha256`, prüft anschliessend mit `pg_restore --list` und
`sha256sum --check`, hält 14 Läufe. `scripts/restore.sh` verlangt die Eingabe
`WIEDERHERSTELLEN` und sichert vorher den aktuellen Stand.

Das ist deutlich mehr als bei Dienst 1 - und hat dieselben zwei Lücken: **keine
Point-in-Time-Recovery** (nur Dumps zu festen Zeitpunkten) und **kein
Offsite-Ziel**; das Skript sagt das im letzten Satz selbst.

Im Repository liegt ein Verzeichnis `storage.vor-wiederherstellung-20260909-0708/`
mit einer einzelnen Datei `media/2026/09/test.txt`. Es ist der versehentlich
committete Rest einer tatsächlich durchgeführten Wiederherstellung am
2026-09-09. Belegt damit zweierlei: der Restore-Weg wurde schon einmal
gegangen, und Sicherungsdaten sind schon einmal in ein Git-Repository geraten.

**Zuständigkeit:** eigenes Repository, kein Push-Zugriff aus dieser Sitzung.
Es wird hier nichts verändert. Was dieser Dienst braucht, steht als Anleitung
in `docs/DISASTER-RECOVERY.md`, Abschnitt «Weitere SwissHub-Dienste».

---

## 5. Dienst 3: Sponsoring-WebApp (`SwissHubSponsoring`)

Belegt durch `docker-compose.prod.yml`, `docker/backup.sh`, `docker/restore.sh`.

- **Eigener PostgreSQL 16** (`db`), Volume `db_data`, `--locale=C`
- **Eigenes Upload-Volume** `uploads` auf `/app/uploads`
- Anwendung auf `127.0.0.1:${APP_PORT:-3000}`, `shm_size: 512mb` für Chromium
  (PDF-Export)
- Eigene Anmeldung mit `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`, `AUTH_SECRET`

**Konflikt, der vor jeder Arbeit am Server zu prüfen ist:** dieser Stack setzt
feste Containernamen `swisshub-db` und `swisshub-app`. Feste Namen sind
hostweit eindeutig. Läuft dieser Stack auf demselben Host wie ein anderer mit
gleichen Namen, startet der zweite nicht. Für die Wiederherstellung heisst das:
die Reihenfolge und die Namensvergabe sind kein Detail.

**Zuständigkeit:** wie Dienst 2 - lesender Zugriff, keine Änderung.

### Alle drei auf einem Host?

Drei Dienste, drei getrennte PostgreSQL-16-Cluster, drei Datenvolumes, drei
Upload-/Medienvolumes, drei Subdomains derselben Zone. Das **legt nahe**, dass
sie auf einem Host liegen - belegt ist es nicht, und es wird hier nicht
behauptet. `scripts/bestandsaufnahme.sh` beantwortet die Frage auf dem Server
in einem Durchgang.

Die Antwort ist folgenreich: liegen alle drei auf einem Host, dann ist dieser
Host die gemeinsame Ausfalldomäne aller SwissHub-Dienste, und eine Sicherung,
die nur ihn kennt, schützt gegen seinen Verlust nicht.

---

## 6. Was heute gesichert wird - und was nicht

### Dienst 1 (diese WebApp)

`deploy/backup.sh` existiert. Was es tut: ein `pg_dump | gzip` nach
`/var/backups/swisshub/`, `chmod 600`, löscht nach 14 Tagen. Einzurichten per
Cron, laut `docs/DEPLOYMENT.md` täglich um 03:30.

Was es **nicht** tut, und jeder Punkt ist ein eigener Datenverlust:

| Lücke                                       | Folge                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| Keine Uploads                               | Logo, Ticket-Verläufe, Antragsanhänge, Analytics-Medien weg  |
| Kein `MASTER_ENCRYPTION_KEY`                | Schicht-2-Geheimnisse dauerhaft unlesbar                     |
| Keine `.env`                                | Konfiguration von Hand zu rekonstruieren                     |
| Kein Offsite                                | Serververlust = Backupverlust                                |
| Keine Unveränderbarkeit                     | Ransomware und `rm -rf` löschen die Sicherungen mit          |
| Keine Verschlüsselung der Sicherung         | Personendaten liegen im Klartext auf demselben Laufwerk      |
| Kein PITR                                   | Datenverlust bis zu 24 h; 14:32 nicht ansteuerbar            |
| Keine Prüfung des Ergebnisses               | Ein leeres `.sql.gz` gilt als Erfolg                         |
| Keine Meldung bei Fehlschlag                | Ein gescheiterter Cronjob fällt niemandem auf                |
| Retention nach Alter, nicht nach Gültigkeit | Nach 14 stillen Fehlschlägen ist gar keine Sicherung mehr da |

### Zwei Sätze in der Dokumentation, die falsch sind

`docs/DEPLOYMENT.md`:

> «Es liegt kein Zustand ausschliesslich im Arbeitsspeicher - ein
> PostgreSQL-Dump genügt als vollständige Sicherung.»

`docs/SECURITY.md`, Checkliste:

> «Datenbank-Backups eingerichtet (`pg_dump` genügt - kein Zustand nur im
> Arbeitsspeicher)»

Die Voraussetzung ist richtig: es gibt keinen Zustand nur im Arbeitsspeicher.
Der Schluss ist falsch. Ein Dump enthält weder die Uploads noch den
`MASTER_ENCRYPTION_KEY` noch die `.env`. Beide Sätze sind gefährlich, weil sie
zum Aufhören auffordern. Sie werden mit dieser Arbeit berichtigt.

### Dienste 2 und 3

Beide haben eigene Backup- und Restore-Skripte mit Prüfsummen und
Integritätsprüfung - also mehr als Dienst 1. Beiden fehlen PITR,
Offsite-Kopie, Unveränderbarkeit und jede Form von Alarmierung.

---

## 7. Wiederherstellungsreihenfolge

Ohne Reihenfolge ist eine Wiederherstellung ein Ratespiel. Die Abhängigkeiten
stehen im Quelltext, nicht in einer Meinung:

```
 1. Host, Docker, Netzwerk, Firewall
 2. DNS auf die neue Adresse                      ← ohne DNS kein OAuth, kein TLS
 3. Recovery-Schlüssel bereitstellen              ← ohne ihn ist Schritt 7 wertlos
 4. Quelltext auf dem produktiven Commit
 5. .env wiederherstellen (inkl. MASTER_ENCRYPTION_KEY)
 6. PostgreSQL-Cluster wiederherstellen (Basis + WAL bis Zielzeitpunkt)
 7. Uploads wiederherstellen (derselbe Zeitpunkt wie 6)
 8. Migrationsstand prüfen - NICHT migrieren
 9. nginx + TLS
10. WebApp starten, Health prüfen, validieren
11. Erst danach: Bot und Musik-Laufzeit           ← Discord-Wirkung nach aussen
12. Hintergrundjobs freigeben
```

Die Reihenfolge von 10 und 11 ist die wichtigste Entscheidung darin. Der Bot
wirkt nach aussen: er vergibt Rollen, schreibt in Kanäle, arbeitet Jail-Fristen
ab. Startet er auf unvalidierten Daten oder gleichzeitig mit einer noch
laufenden Altinstanz, richtet die Wiederherstellung auf Discord Schaden an,
den kein Backup zurücknimmt.

---

## 8. Was für ein vollständiges Konzept noch fehlt

Diese Punkte sind **nicht** aus dem Repository zu beantworten. Sie sind
Entscheidungen oder Zugänge und stehen in
`docs/DISASTER-RECOVERY.md`, Abschnitt «Was der Betreiber bereitstellen muss»:

1. Externer S3-kompatibler Speicher mit Object Lock - Anbieter, Bucket, Region
2. Zwei getrennte Zugangsdatenpaare dafür (schreibend / wiederherstellend)
3. Ein unabhängiger Alarmierungsweg, der ohne den eigenen Server funktioniert
4. Ein physisch getrennter Aufbewahrungsort für den Recovery-Schlüssel
5. Entscheidung über eine zweite Infrastruktur (Standby) - Kosten gegen RTO
6. Ob Dienst 2 und 3 in dasselbe Verfahren aufgenommen werden sollen
