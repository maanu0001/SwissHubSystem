#!/usr/bin/env bash
# SwissHub Backup - gemeinsame Grundlagen aller Werkzeuge.
#
# Wird von jedem Skript in ../bin eingebunden. Enthaelt Konfiguration,
# Protokollierung, Sperren, Zustandsdateien und Alarmierung.
#
# Was hier NICHT steht: eine eigene Backup-Logik. Gesichert wird mit
# pgBackRest und Restic; dieser Code orchestriert, prueft und meldet.
# Eine selbstgebaute Backup-Engine waere die eine Komponente, die man
# unmoeglich so gruendlich pruefen kann wie ein Werkzeug, das Tausende
# Installationen taeglich benutzen.

# `set -e` steht hier absichtlich NICHT: die Bibliothek wird eingebunden, und
# das aufrufende Skript entscheidet selbst. Jede Funktion hier gibt ihren
# Erfolg ueber den Rueckgabewert zurueck.
set -uo pipefail

# --------------------------------------------------------------------------
# Konfiguration
# --------------------------------------------------------------------------

SWISSHUB_CONFIG_FILE="${SWISSHUB_CONFIG_FILE:-/etc/swisshub-backup/swisshub-backup.env}"

# Werte, die in kein Protokoll und in keine Zustandsdatei gelangen duerfen.
# Die Liste ist der Grund, weshalb `verdecke` ueberhaupt funktioniert: sie
# muss vollstaendig sein, und deshalb steht sie an genau einer Stelle.
GEHEIME_VARIABLEN=(
  SWISSHUB_PGBACKREST_CIPHER_PASS
  SWISSHUB_RESTIC_PASSWORD
  SWISSHUB_S3_WRITE_SECRET
  SWISSHUB_S3_WRITE_KEY_ID
  SWISSHUB_S3_RESTORE_SECRET
  SWISSHUB_S3_RESTORE_KEY_ID
  SWISSHUB_ALERT_SMTP_PASSWORD
  SWISSHUB_ALERT_WEBHOOK_URL
  SWISSHUB_ALERT_HEARTBEAT_URL
  SWISSHUB_ALERT_DISCORD_WEBHOOK
  MASTER_ENCRYPTION_KEY
  AUTH_SECRET
  POSTGRES_PASSWORD
  PGPASSWORD
)

lade_konfiguration() {
  if [[ ! -r "$SWISSHUB_CONFIG_FILE" ]]; then
    printf 'FEHLER: %s ist nicht lesbar.\n' "$SWISSHUB_CONFIG_FILE" >&2
    printf 'Vorlage: deploy/backup/swisshub-backup.env.example\n' >&2
    return 1
  fi

  # `set -a` exportiert alles, was danach zugewiesen wird - pgBackRest und
  # Restic lesen einen Teil davon aus der Umgebung.
  set -a
  # shellcheck disable=SC1090
  source "$SWISSHUB_CONFIG_FILE"
  set +a

  # Vorgaben fuer alles, was in der Datei fehlen darf.
  : "${SWISSHUB_PROJECT_DIR:=/opt/swisshub}"
  : "${SWISSHUB_BACKUP_ROOT:=/var/lib/swisshub-backup}"
  : "${SWISSHUB_PGBACKREST_REPO:=$SWISSHUB_BACKUP_ROOT/pgbackrest}"
  : "${SWISSHUB_RESTIC_REPO:=$SWISSHUB_BACKUP_ROOT/restic}"
  : "${SWISSHUB_PG_MODE:=host}"
  : "${SWISSHUB_PG_DATA:=/var/lib/postgresql/data}"
  : "${SWISSHUB_PG_USER:=postgres}"
  : "${SWISSHUB_PG_PORT:=5432}"
  : "${SWISSHUB_PG_DATABASE:=swisshub}"
  : "${SWISSHUB_PG_CONTAINER:=}"
  : "${SWISSHUB_UPLOAD_DIR:=}"
  : "${SWISSHUB_EXTRA_PATHS:=}"
  : "${SWISSHUB_CONFIG_PATHS:=}"
  : "${SWISSHUB_MIN_FREE_GB:=10}"
  : "${SWISSHUB_S3_ENDPOINT:=}"
  : "${SWISSHUB_S3_BUCKET:=}"
  : "${SWISSHUB_S3_REGION:=}"
  : "${SWISSHUB_S3_WRITE_KEY_ID:=}"
  : "${SWISSHUB_S3_WRITE_SECRET:=}"
  : "${SWISSHUB_PGBACKREST_CIPHER_PASS:=}"
  : "${SWISSHUB_RESTIC_PASSWORD:=}"
  : "${SWISSHUB_RECOVERY_AGE_RECIPIENTS:=}"
  : "${SWISSHUB_RETENTION_FULL:=4}"
  : "${SWISSHUB_RETENTION_DIFF:=14}"
  : "${SWISSHUB_RETENTION_HOURLY:=48}"
  : "${SWISSHUB_RETENTION_DAILY:=30}"
  : "${SWISSHUB_RETENTION_WEEKLY:=12}"
  : "${SWISSHUB_RETENTION_MONTHLY:=12}"
  : "${SWISSHUB_OBJECT_LOCK_DAYS:=30}"
  : "${SWISSHUB_PGBACKREST_PROCESSES:=1}"
  : "${SWISSHUB_UPLOAD_LIMIT_KIB:=0}"
  : "${SWISSHUB_ALERT_MIN_SEVERITY:=warnung}"
  : "${SWISSHUB_ALERT_SMTP_HOST:=}"
  : "${SWISSHUB_ALERT_SMTP_PORT:=587}"
  : "${SWISSHUB_ALERT_SMTP_USER:=}"
  : "${SWISSHUB_ALERT_SMTP_PASSWORD:=}"
  : "${SWISSHUB_ALERT_SMTP_FROM:=}"
  : "${SWISSHUB_ALERT_SMTP_TO:=}"
  : "${SWISSHUB_ALERT_WEBHOOK_URL:=}"
  : "${SWISSHUB_ALERT_HEARTBEAT_URL:=}"
  : "${SWISSHUB_ALERT_DISCORD_WEBHOOK:=}"
  : "${SWISSHUB_RESTORE_TEST_PORT:=55432}"
  : "${SWISSHUB_RESTORE_TEST_DIR:=$SWISSHUB_BACKUP_ROOT/restore-test}"
  : "${SWISSHUB_RESTORE_TEST_MAX_AGE_DAYS:=8}"

  ZUSTAND_DIR="$SWISSHUB_BACKUP_ROOT/state"
  SPOOL_DIR="$SWISSHUB_BACKUP_ROOT/spool"
  PROTOKOLL_DIR="$SWISSHUB_BACKUP_ROOT/log"
  SPERREN_DIR="$SWISSHUB_BACKUP_ROOT/lock"
  PGBACKREST_CONF="/etc/swisshub-backup/pgbackrest.conf"
  PGBACKREST_STANZA="swisshub"
  return 0
}

# --------------------------------------------------------------------------
# Protokollierung
# --------------------------------------------------------------------------

# Jeder Wert aus GEHEIME_VARIABLEN wird ersetzt, bevor eine Zeile das Haus
# verlaesst.
#
# Nicht «wir schreiben ja keine Secrets»: pgBackRest und Restic geben im
# Fehlerfall ihre Aufrufe mit aus, und darin steht dann eine Zugangskennung.
# Das ist der Fall, gegen den diese Funktion gebaut ist - nicht gegen den
# eigenen `echo`.
verdecke() {
  local text
  text=$(cat)
  local name wert
  for name in "${GEHEIME_VARIABLEN[@]}"; do
    wert="${!name:-}"
    # Kurze Werte nicht ersetzen: ein dreistelliger Port als Suchmuster
    # zerlegte jede Zeile, in der eine Zahl vorkommt.
    if [[ -n "$wert" && ${#wert} -ge 8 ]]; then
      # Ersetzung ohne externe Werkzeuge - `sed` mit einem Wert, der
      # Schraegstriche enthaelt, braeuchte erst eine Maskierung.
      text="${text//"$wert"/«$name»}"
    fi
  done
  printf '%s\n' "$text"
}

LOG_KONTEXT="${LOG_KONTEXT:-backup}"

protokoll() {
  local stufe="$1"
  shift
  local zeile
  zeile="$(date --iso-8601=seconds) [$stufe] [$LOG_KONTEXT] $*"
  printf '%s\n' "$zeile" | verdecke >&2
  if [[ -n "${PROTOKOLL_DATEI:-}" ]]; then
    printf '%s\n' "$zeile" | verdecke >> "$PROTOKOLL_DATEI"
  fi
}

info() { protokoll INFO "$@"; }
warnung() { protokoll WARN "$@"; }
fehler() { protokoll FEHLER "$@"; }

# Ein Befehl, dessen Ausgabe ins Protokoll gehoert - verdeckt.
#
# `2>&1` und dann durch `verdecke`: die interessanten Meldungen von pgBackRest
# stehen auf der Fehlerausgabe, und genau dort stehen auch die Aufrufe mit
# Zugangsdaten.
laufe() {
  local beschreibung="$1"
  shift
  info "$beschreibung"
  local ausgabe status
  ausgabe=$("$@" 2>&1)
  status=$?
  if [[ -n "$ausgabe" ]]; then
    printf '%s\n' "$ausgabe" | verdecke | while IFS= read -r zeile; do
      protokoll AUSGABE "$zeile"
    done
  fi
  return $status
}

protokoll_eroeffnen() {
  local name="$1"
  mkdir -p "$PROTOKOLL_DIR"
  chmod 750 "$PROTOKOLL_DIR" 2>/dev/null || true
  PROTOKOLL_DATEI="$PROTOKOLL_DIR/${name}-$(date +%Y%m%d).log"
  ( umask 027; touch "$PROTOKOLL_DATEI" )
  # Erfolgs- und Fehlerprotokolle getrennt aufbewahren, wie gefordert: die
  # Fehlerdatei bleibt laenger, weil sie die ist, in der jemand nachliest.
  find "$PROTOKOLL_DIR" -name '*.log' -mtime +30 -delete 2>/dev/null || true
  find "$PROTOKOLL_DIR" -name 'fehler-*.log' -mtime +365 -delete 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Sperren
# --------------------------------------------------------------------------

# Zwei Sicherungen gleichzeitig sind kein doppelter Schutz, sondern zwei halbe.
# pgBackRest sperrt selbst; diese Sperre umfasst den ganzen Lauf, also auch
# die Uebertragung und die Pruefung.
#
# `flock` mit Zeitgrenze statt unbegrenztem Warten: ein haengender Vorlauf
# soll den naechsten Lauf nicht auf den Tag darauf verschieben, sondern
# auffallen.
sperre_oder_raus() {
  local name="$1"
  local wartezeit="${2:-5}"
  mkdir -p "$SPERREN_DIR"
  local datei="$SPERREN_DIR/${name}.lock"
  exec {SPERR_FD}>"$datei"
  if ! flock --wait "$wartezeit" "$SPERR_FD"; then
    warnung "Ein anderer Lauf «$name» ist noch aktiv - dieser Durchgang wird uebersprungen."
    return 1
  fi
  return 0
}

# --------------------------------------------------------------------------
# Zustandsdateien
# --------------------------------------------------------------------------
#
# Der Zustand liegt als JSON auf der Platte und NICHT in der Datenbank.
#
# Der Grund ist der Ernstfall: wenn die Datenbank kaputt ist, ist das der
# Moment, in dem jemand wissen muss, welche Sicherungen es gibt. Eine
# Backup-Uebersicht, die dann nicht antwortet, ist genau dann nutzlos, wenn sie
# gebraucht wird.
#
# Die WebApp liest diese Dateien nur - schreibend kommt sie nicht heran.

zustand_schreiben() {
  local name="$1"
  local inhalt="$2"
  mkdir -p "$ZUSTAND_DIR"
  # Atomar: erst daneben schreiben, dann umbenennen. Ein Leser sieht damit
  # entweder den alten oder den neuen Stand, nie einen halben.
  local temp="$ZUSTAND_DIR/.${name}.$$"
  printf '%s\n' "$inhalt" | verdecke > "$temp"
  chmod 640 "$temp"
  mv -f "$temp" "$ZUSTAND_DIR/${name}.json"
}

zustand_lesen() {
  local name="$1"
  cat "$ZUSTAND_DIR/${name}.json" 2>/dev/null || printf '{}'
}

# Eine Zeile in die Verlaufsdatei. JSON Lines, weil Anhaengen dann kein
# Umschreiben der ganzen Datei ist - und weil eine abgebrochene Zeile am Ende
# nur diese eine Zeile kostet.
verlauf_anhaengen() {
  local name="$1"
  local inhalt="$2"
  mkdir -p "$ZUSTAND_DIR"
  local datei="$ZUSTAND_DIR/${name}.jsonl"
  ( umask 027; printf '%s\n' "$inhalt" | verdecke >> "$datei" )
  # Auf die letzten 2000 Zeilen begrenzen - die Uebersicht zeigt ohnehin nur
  # die jungsten, und eine unbegrenzt wachsende Datei ist ein spaeterer Fehler.
  if [[ $(wc -l < "$datei") -gt 2000 ]]; then
    tail -n 1000 "$datei" > "${datei}.neu" && mv -f "${datei}.neu" "$datei"
  fi
}

# JSON-Zeichenkette aus beliebigem Text. Ohne diese Funktion reisst ein
# Anfuehrungszeichen in einer Fehlermeldung die ganze Zustandsdatei auf.
json_text() {
  local text="$1"
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$text" 2>/dev/null \
    || printf '"%s"' "${text//\"/\\\"}"
}

# --------------------------------------------------------------------------
# Alarmierung
# --------------------------------------------------------------------------
#
# Vier Wege, und der wichtigste ist der, der NICHT von diesem Server ausgeht:
# der Totmannschalter. Jede Meldung, die der Server selbst verschicken muss,
# faellt mit ihm aus - genau dann, wenn sie gebraucht wird.

severity_rang() {
  case "$1" in
    info) printf '1' ;;
    warnung) printf '2' ;;
    kritisch) printf '3' ;;
    *) printf '2' ;;
  esac
}

# Dieselbe Meldung nicht stuendlich neu.
#
# Fingerabdruck aus Schweregrad und Kennung; die Sperrfrist waechst mit dem
# Schweregrad nicht, sondern faellt: eine kritische Meldung darf nach einer
# Stunde erneut kommen, eine Warnung erst nach sechs. Wer bei «kritisch»
# lange schweigt, verliert den Anlass.
alarm_unterdrueckt() {
  local kennung="$1"
  local stufe="$2"
  local frist
  case "$stufe" in
    kritisch) frist=3600 ;;
    warnung) frist=21600 ;;
    *) frist=86400 ;;
  esac
  local marke="$ZUSTAND_DIR/alarm-$(printf '%s' "$kennung" | tr -c 'a-zA-Z0-9_-' '_').stamp"
  if [[ -f "$marke" ]]; then
    local alter=$(( $(date +%s) - $(stat -c %Y "$marke" 2>/dev/null || echo 0) ))
    if [[ "$alter" -lt "$frist" ]]; then
      return 0
    fi
  fi
  mkdir -p "$ZUSTAND_DIR"
  touch "$marke"
  return 1
}

# Die Gegenmeldung: was wieder in Ordnung ist, soll das sagen.
#
# Ohne sie bleibt eine Warnung im Gedaechtnis stehen, und beim naechsten Mal
# glaubt sie niemand mehr. Sie wird nur verschickt, wenn zuvor wirklich
# alarmiert wurde - eine Entwarnung ohne Warnung ist selbst Laerm.
alarm_entwarnung() {
  local kennung="$1"
  local text="$2"
  local marke="$ZUSTAND_DIR/alarm-$(printf '%s' "$kennung" | tr -c 'a-zA-Z0-9_-' '_').stamp"
  if [[ -f "$marke" ]]; then
    rm -f "$marke"
    alarm info "$kennung-behoben" "Wieder in Ordnung: $text" 'ja'
  fi
}

# alarm <stufe> <kennung> <text> [entwarnung=ja]
alarm() {
  local stufe="$1"
  local kennung="$2"
  local text="$3"
  local ist_entwarnung="${4:-nein}"

  if [[ $(severity_rang "$stufe") -lt $(severity_rang "$SWISSHUB_ALERT_MIN_SEVERITY") && "$ist_entwarnung" != 'ja' ]]; then
    return 0
  fi
  if [[ "$ist_entwarnung" != 'ja' ]] && alarm_unterdrueckt "$kennung" "$stufe"; then
    info "Alarm «$kennung» unterdrueckt (kuerzlich schon gemeldet)."
    return 0
  fi

  local host betreff
  host=$(hostname -f 2>/dev/null || hostname)
  betreff="[SwissHub Backup/${stufe}] $kennung auf $host"

  protokoll ALARM "$stufe $kennung: $text"
  # Der Alarm gehoert zusaetzlich in die Fehlerdatei, die laenger bleibt.
  if [[ -n "${PROTOKOLL_DIR:-}" ]]; then
    mkdir -p "$PROTOKOLL_DIR"
    ( umask 027; printf '%s [%s] %s: %s\n' "$(date --iso-8601=seconds)" "$stufe" "$kennung" "$text" \
        | verdecke >> "$PROTOKOLL_DIR/fehler-$(date +%Y%m).log" )
  fi

  alarm_email "$betreff" "$text"
  alarm_webhook "$stufe" "$kennung" "$text"
  alarm_discord "$stufe" "$betreff" "$text"

  zustand_schreiben 'letzter-alarm' "$(printf '{"zeit":%s,"stufe":%s,"kennung":%s,"text":%s}' \
    "$(json_text "$(date --iso-8601=seconds)")" "$(json_text "$stufe")" \
    "$(json_text "$kennung")" "$(json_text "$text")")"
}

alarm_email() {
  [[ -n "$SWISSHUB_ALERT_SMTP_HOST" && -n "$SWISSHUB_ALERT_SMTP_TO" ]] || return 0
  local betreff="$1" text="$2"
  # Python statt `mail`: ein MTA auf dem Server waere ein weiterer Dienst, der
  # ausfallen kann, und er faellt mit dem Server aus. Direkt zum externen
  # Anbieter ist der kuerzere Weg.
  SWISSHUB_MAIL_SUBJECT="$betreff" SWISSHUB_MAIL_BODY="$text" python3 - <<'PY' 2>/dev/null || warnung 'E-Mail-Alarm konnte nicht gesendet werden.'
import os, smtplib, ssl, socket
from email.message import EmailMessage

nachricht = EmailMessage()
nachricht['Subject'] = os.environ['SWISSHUB_MAIL_SUBJECT']
nachricht['From'] = os.environ.get('SWISSHUB_ALERT_SMTP_FROM') or os.environ['SWISSHUB_ALERT_SMTP_USER']
nachricht['To'] = os.environ['SWISSHUB_ALERT_SMTP_TO']
nachricht.set_content(os.environ['SWISSHUB_MAIL_BODY'])

host = os.environ['SWISSHUB_ALERT_SMTP_HOST']
port = int(os.environ.get('SWISSHUB_ALERT_SMTP_PORT') or 587)
benutzer = os.environ.get('SWISSHUB_ALERT_SMTP_USER') or ''
passwort = os.environ.get('SWISSHUB_ALERT_SMTP_PASSWORD') or ''

# Kurze Zeitgrenze: ein haengender SMTP-Anbieter darf den Backup-Lauf nicht
# aufhalten. Die Meldung ist wichtig, der Lauf ist wichtiger.
socket.setdefaulttimeout(20)
if port == 465:
    verbindung = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context())
else:
    verbindung = smtplib.SMTP(host, port)
    verbindung.starttls(context=ssl.create_default_context())
with verbindung:
    if benutzer:
        verbindung.login(benutzer, passwort)
    verbindung.send_message(nachricht)
PY
}

alarm_webhook() {
  [[ -n "$SWISSHUB_ALERT_WEBHOOK_URL" ]] || return 0
  local stufe="$1" kennung="$2" text="$3"
  local rumpf
  rumpf=$(printf '{"dienst":"swisshub-backup","host":%s,"stufe":%s,"kennung":%s,"text":%s,"zeit":%s}' \
    "$(json_text "$(hostname -f 2>/dev/null || hostname)")" "$(json_text "$stufe")" \
    "$(json_text "$kennung")" "$(json_text "$text")" "$(json_text "$(date --iso-8601=seconds)")")
  curl -fsS --max-time 20 -X POST -H 'Content-Type: application/json' \
    -d "$rumpf" "$SWISSHUB_ALERT_WEBHOOK_URL" >/dev/null 2>&1 \
    || warnung 'Webhook-Alarm konnte nicht gesendet werden.'
}

alarm_discord() {
  [[ -n "$SWISSHUB_ALERT_DISCORD_WEBHOOK" ]] || return 0
  local stufe="$1" betreff="$2" text="$3"
  local farbe
  case "$stufe" in
    kritisch) farbe=15548997 ;;
    warnung) farbe=16705372 ;;
    *) farbe=5763719 ;;
  esac
  local rumpf
  rumpf=$(printf '{"embeds":[{"title":%s,"description":%s,"color":%s}]}' \
    "$(json_text "$betreff")" "$(json_text "$text")" "$farbe")
  curl -fsS --max-time 20 -X POST -H 'Content-Type: application/json' \
    -d "$rumpf" "$SWISSHUB_ALERT_DISCORD_WEBHOOK" >/dev/null 2>&1 \
    || warnung 'Discord-Alarm konnte nicht gesendet werden.'
}

# Der Totmannschalter.
#
# `/<status>` am Ende: healthchecks.io und die meisten anderen Dienste
# unterscheiden damit «fertig» von «gescheitert», und ein gemeldeter
# Fehlschlag alarmiert sofort statt erst nach Ablauf der Frist.
herzschlag() {
  [[ -n "$SWISSHUB_ALERT_HEARTBEAT_URL" ]] || return 0
  local status="${1:-0}"
  local url="$SWISSHUB_ALERT_HEARTBEAT_URL"
  if [[ "$status" != '0' ]]; then
    url="${url%/}/fail"
  fi
  curl -fsS --max-time 20 --retry 3 -o /dev/null "$url" 2>/dev/null \
    || warnung 'Totmannschalter konnte nicht gepingt werden.'
}

# --------------------------------------------------------------------------
# Pruefungen vor dem Schreiben
# --------------------------------------------------------------------------

freier_platz_gb() {
  local pfad="$1"
  # `--output=avail` in KiB, dann durch 1048576. `df` auf ein Verzeichnis,
  # das es noch nicht gibt, scheitert - deshalb aufs naechste vorhandene
  # Elternverzeichnis zurueckfallen.
  while [[ ! -d "$pfad" && "$pfad" != '/' ]]; do pfad=$(dirname "$pfad"); done
  local kib
  kib=$(df --output=avail -k "$pfad" 2>/dev/null | tail -1 | tr -d ' ')
  printf '%s' $(( ${kib:-0} / 1048576 ))
}

# Ein voller Datentraeger nimmt PostgreSQL mit. Deshalb wird VOR dem Schreiben
# geprueft und nicht danach gemeldet - und deshalb ist das Ergebnis ein
# Abbruch und keine Warnung.
platz_pruefen() {
  local pfad="${1:-$SWISSHUB_BACKUP_ROOT}"
  local frei
  frei=$(freier_platz_gb "$pfad")
  if [[ "$frei" -lt "$SWISSHUB_MIN_FREE_GB" ]]; then
    alarm kritisch 'speicherplatz' \
      "Nur noch ${frei} GB frei auf $pfad, gefordert sind ${SWISSHUB_MIN_FREE_GB} GB. Der Lauf wird abgebrochen, bevor er schreibt - ein volles Laufwerk nimmt PostgreSQL und den Bot mit."
    return 1
  fi
  # Frueh warnen: das Doppelte der Untergrenze ist der Punkt, an dem noch Zeit
  # zum Handeln ist.
  if [[ "$frei" -lt $(( SWISSHUB_MIN_FREE_GB * 2 )) ]]; then
    alarm warnung 'speicherplatz-knapp' \
      "Noch ${frei} GB frei auf $pfad. Unter ${SWISSHUB_MIN_FREE_GB} GB bricht die Sicherung ab."
  else
    alarm_entwarnung 'speicherplatz-knapp' "wieder ${frei} GB frei auf $pfad"
    alarm_entwarnung 'speicherplatz' "wieder ${frei} GB frei auf $pfad"
  fi
  info "Freier Platz auf $pfad: ${frei} GB."
  return 0
}

werkzeug_pruefen() {
  local fehlend=()
  local werkzeug
  for werkzeug in "$@"; do
    command -v "$werkzeug" >/dev/null 2>&1 || fehlend+=("$werkzeug")
  done
  if [[ ${#fehlend[@]} -gt 0 ]]; then
    fehler "Es fehlen: ${fehlend[*]}"
    return 1
  fi
  return 0
}

# --------------------------------------------------------------------------
# PostgreSQL
# --------------------------------------------------------------------------

# Ein psql-Aufruf, gleich ob PostgreSQL im Container oder auf dem System
# laeuft. `-A -t` liefert reine Werte ohne Rahmen und Kopfzeile.
pg_abfrage() {
  local sql="$1"
  local datenbank="${2:-$SWISSHUB_PG_DATABASE}"
  if [[ "$SWISSHUB_PG_MODE" == 'docker' ]]; then
    docker exec -i "$SWISSHUB_PG_CONTAINER" \
      psql -U "$SWISSHUB_PG_USER" -d "$datenbank" -A -t -q -c "$sql" 2>/dev/null
  else
    psql -U "$SWISSHUB_PG_USER" -p "$SWISSHUB_PG_PORT" -h 127.0.0.1 -d "$datenbank" -A -t -q -c "$sql" 2>/dev/null
  fi
}

# Wo die PostgreSQL-Serverprogramme liegen.
#
# `initdb`, `pg_ctl` und `postgres` stehen bei Debian und Ubuntu NICHT im
# Suchpfad: dort liegen nur die Cluster-Wrapper (`pg_ctlcluster`), und die
# taugen fuer einen wiederhergestellten Cluster ausserhalb der
# Cluster-Verwaltung nicht. Der Pfad wird deshalb ermittelt und nicht
# vorausgesetzt - ohne das scheitert der Restore-Test mit «pg_ctl: command not
# found», und das saehe aus wie ein Fehler der Sicherung.
pg_bin_verzeichnis() {
  if [[ -n "${SWISSHUB_PG_BIN:-}" ]]; then
    printf '%s' "$SWISSHUB_PG_BIN"
    return 0
  fi
  local kandidat
  # Die hoechste vorhandene Fassung zuerst: ein Cluster aus PostgreSQL 16
  # laesst sich nicht mit den Programmen von 15 starten.
  for kandidat in $(ls -d /usr/lib/postgresql/*/bin /usr/pgsql-*/bin 2>/dev/null | sort -rV); do
    [[ -x "$kandidat/pg_ctl" ]] && { printf '%s' "$kandidat"; return 0; }
  done
  # Falls doch im Suchpfad (Alpine, selbst gebaut).
  kandidat=$(command -v pg_ctl 2>/dev/null) && [[ -n "$kandidat" ]] && { printf '%s' "$(dirname "$kandidat")"; return 0; }
  return 1
}

# Ein PostgreSQL-Serverprogramm als der richtige Benutzer.
#
# `postgres` laeuft nicht als root und weigert sich ausdruecklich. Laeuft
# dieses Skript als root, wird deshalb gewechselt; laeuft es schon als
# unprivilegierter Dienstbenutzer, bleibt es dabei.
pg_werkzeug() {
  local bin
  bin=$(pg_bin_verzeichnis) || { fehler 'Die PostgreSQL-Serverprogramme (pg_ctl, initdb) wurden nicht gefunden. Auf Debian/Ubuntu: apt install postgresql-16.'; return 1; }
  local programm="$1"; shift
  if [[ "$(id -u)" -eq 0 ]]; then
    local benutzer="${SWISSHUB_PG_SYSTEM_USER:-postgres}"
    local befehl
    befehl=$(printf '%q ' "$bin/$programm" "$@")
    su "$benutzer" -s /bin/bash -c "$befehl"
  else
    "$bin/$programm" "$@"
  fi
}

# pgBackRest dort ausfuehren, wo es an das Datenverzeichnis kommt.
#
# Bei `docker` heisst das: im Datenbankcontainer. Ein physisches Backup
# kopiert Dateien des Clusters - vom Host aus gaebe es sie nur, wenn man in
# das Volume hineingriffe, und das ist genau die Art Abkuerzung, die bei einem
# Versionswechsel des Abbilds still bricht.
pgbackrest_lauf() {
  if [[ "$SWISSHUB_PG_MODE" == 'docker' ]]; then
    docker exec -i "$SWISSHUB_PG_CONTAINER" pgbackrest "$@"
  else
    pgbackrest "$@"
  fi
}

# --------------------------------------------------------------------------
# Restic
# --------------------------------------------------------------------------

restic_umgebung() {
  export RESTIC_PASSWORD="$SWISSHUB_RESTIC_PASSWORD"
  # Nicht in eine Datei: das Passwort aus der Umgebung eines Prozesses ist
  # fuer root lesbar, aus einer Datei aber fuer jeden mit Leserecht - und die
  # Datei bleibt liegen.
  export RESTIC_CACHE_DIR="$SWISSHUB_BACKUP_ROOT/cache/restic"
  mkdir -p "$RESTIC_CACHE_DIR"
}

restic_lokal() {
  restic_umgebung
  restic --repo "$SWISSHUB_RESTIC_REPO" "$@"
}

restic_extern() {
  restic_umgebung
  [[ -n "$SWISSHUB_S3_BUCKET" ]] || return 2
  export AWS_ACCESS_KEY_ID="$SWISSHUB_S3_WRITE_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$SWISSHUB_S3_WRITE_SECRET"
  [[ -n "$SWISSHUB_S3_REGION" ]] && export AWS_DEFAULT_REGION="$SWISSHUB_S3_REGION"
  local ziel="s3:${SWISSHUB_S3_ENDPOINT%/}/${SWISSHUB_S3_BUCKET}/restic"
  local grenze=()
  [[ "$SWISSHUB_UPLOAD_LIMIT_KIB" -gt 0 ]] && grenze=(--limit-upload "$SWISSHUB_UPLOAD_LIMIT_KIB")
  restic --repo "$ziel" "${grenze[@]}" "$@"
}

hat_externes_ziel() {
  [[ -n "$SWISSHUB_S3_ENDPOINT" && -n "$SWISSHUB_S3_BUCKET" && -n "$SWISSHUB_S3_WRITE_KEY_ID" ]]
}
