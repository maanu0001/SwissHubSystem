#!/usr/bin/env bash
# SwissHub - Bestandsaufnahme des produktiven Servers.
#
#   sudo bash scripts/bestandsaufnahme.sh              # Bericht auf die Konsole
#   sudo bash scripts/bestandsaufnahme.sh bericht.txt  # zusaetzlich in eine Datei
#
# Beantwortet die Fragen, die docs/BESTANDSAUFNAHME.md offenlaesst, weil sie
# sich nur auf dem Server beantworten lassen: welche Dienste laufen, wie viele
# PostgreSQL-Cluster es gibt, wie gross die Datenmengen sind, wie viel Platz
# frei ist, und ob eine Sicherung ueberhaupt eingerichtet ist.
#
# NUR LESEND. Das Skript startet nichts, stoppt nichts, schreibt nichts
# ausserhalb der optionalen Berichtsdatei. Es darf deshalb auf einem
# produktiven Server laufen, ohne dass jemand vorher ein Wartungsfenster
# braucht.
#
# Es gibt bewusst KEINE Werte von Geheimnissen aus. Von der .env erscheinen
# nur die Namen der gesetzten Variablen und die Laenge ihres Werts - das
# genuegt, um «ist gesetzt» von «fehlt» zu unterscheiden, und verraet nichts.

set -uo pipefail

PROJEKT_DIR="${SWISSHUB_PROJECT_DIR:-/opt/swisshub}"
BERICHT="${1:-}"

if [[ -n "$BERICHT" ]]; then
  # Der Bericht enthaelt Pfade und Groessen, keine Geheimnisse - aber er
  # gehoert trotzdem nicht in fremde Haende.
  umask 077
  exec > >(tee "$BERICHT")
fi

abschnitt() {
  printf '\n========================================================\n%s\n========================================================\n' "$1"
}

frage() { printf '  %-42s %s\n' "$1" "$2"; }

# Ein Befehl, dessen Fehlen kein Abbruch ist: auf einem Server ohne Docker
# soll die uebrige Erhebung trotzdem laufen.
hat() { command -v "$1" >/dev/null 2>&1; }

printf 'SwissHub Bestandsaufnahme - %s\n' "$(date --iso-8601=seconds)"
printf 'Host: %s\n' "$(hostname -f 2>/dev/null || hostname)"

abschnitt '1. Betriebssystem und Ressourcen'
frage 'Distribution' "$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unbekannt}")"
frage 'Kernel' "$(uname -r)"
frage 'Architektur' "$(uname -m)"
frage 'CPU-Kerne' "$(nproc 2>/dev/null || echo '?')"
frage 'Arbeitsspeicher' "$(free -h 2>/dev/null | awk '/^Mem:/{print $2" total, "$7" verfuegbar"}')"
frage 'Laufzeit' "$(uptime -p 2>/dev/null || echo '?')"
frage 'Zeitzone' "$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo '?')"

abschnitt '2. Speicherplatz'
echo '  Dateisysteme:'
df -h -x tmpfs -x devtmpfs 2>/dev/null | sed 's/^/    /'
echo
echo '  Grosse Verbraucher (kann einen Moment dauern):'
for pfad in /var/lib/docker /var/lib/swisshub /var/backups /opt; do
  if [[ -d "$pfad" ]]; then
    printf '    %-28s %s\n' "$pfad" "$(du -sh "$pfad" 2>/dev/null | cut -f1)"
  fi
done

abschnitt '3. Docker'
if hat docker; then
  frage 'Docker' "$(docker --version 2>/dev/null)"
  frage 'Compose' "$(docker compose version --short 2>/dev/null || echo 'nicht vorhanden')"
  echo
  echo '  Laufende Container:'
  docker ps --format '    {{.Names}}  |  {{.Image}}  |  {{.Status}}' 2>/dev/null || echo '    (kein Zugriff auf den Docker-Socket - mit sudo erneut versuchen)'
  echo
  echo '  Alle Container (auch gestoppte):'
  docker ps -a --format '    {{.Names}}  |  {{.Image}}  |  {{.Status}}' 2>/dev/null
  echo
  echo '  Volumes mit Groesse:'
  # `docker system df -v` ist die einzige Stelle, die die Groesse eines
  # Volumes kennt, ohne dass man im Wirtsdateisystem danach sucht.
  docker system df -v 2>/dev/null | sed -n '/VOLUME NAME/,/^$/p' | sed 's/^/    /'
  echo
  echo '  Compose-Projekte auf diesem Host:'
  # Jeder Container traegt das Projekt, aus dem er kommt, als Label. Damit
  # faellt auf, wenn hier mehr als ein SwissHub-Stack laeuft - genau die
  # Frage, die docs/BESTANDSAUFNAHME.md offenlaesst.
  docker ps -a --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null \
    | grep -v '^|$' | sort -u | sed 's/^/    /'
else
  echo '  Docker ist nicht installiert.'
fi

abschnitt '4. PostgreSQL-Cluster'
echo '  Als Container:'
if hat docker; then
  # Nicht nur `postgres:*`: ein Cluster kann auch in einem Abbild mit
  # Erweiterungen stecken (postgis, timescale, pgvector).
  docker ps -a --filter 'ancestor=postgres' --format '    {{.Names}} | {{.Image}} | {{.Status}}' 2>/dev/null
  for behaelter in $(docker ps -q 2>/dev/null); do
    if docker exec "$behaelter" sh -c 'command -v psql' >/dev/null 2>&1; then
      name=$(docker inspect --format '{{.Name}}' "$behaelter" | tr -d '/')
      version=$(docker exec "$behaelter" postgres --version 2>/dev/null || echo '?')
      printf '    %-24s %s\n' "$name" "$version"
      # Datenbanken samt Groesse. `-A -t` liefert reine Zeilen ohne Rahmen.
      docker exec "$behaelter" sh -c \
        'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -A -t -c "SELECT datname||'"'"' = '"'"'||pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE NOT datistemplate ORDER BY datname"' 2>/dev/null \
        | sed 's/^/        /'
      # Die drei Einstellungen, an denen PITR haengt. Stehen sie auf `off`
      # bzw. `minimal`, gibt es heute keine WAL-Kette - und damit keinen
      # Zeitpunkt, den man ansteuern koennte.
      docker exec "$behaelter" sh -c \
        'psql -U "${POSTGRES_USER:-postgres}" -A -t -c "SELECT name||'"'"' = '"'"'||setting FROM pg_settings WHERE name IN ('"'"'wal_level'"'"','"'"'archive_mode'"'"','"'"'archive_command'"'"','"'"'data_directory'"'"')"' 2>/dev/null \
        | sed 's/^/        /'
    fi
  done
fi
echo
echo '  Auf dem System:'
if hat pg_lsclusters; then
  pg_lsclusters 2>/dev/null | sed 's/^/    /'
elif hat psql; then
  frage 'psql' "$(psql --version)"
  systemctl is-active postgresql >/dev/null 2>&1 && echo '    postgresql.service ist aktiv' || echo '    postgresql.service ist nicht aktiv'
else
  echo '    Kein System-PostgreSQL gefunden.'
fi

abschnitt '5. SwissHub-Projektverzeichnisse'
# Ein Projektverzeichnis ist, was eine Compose-Datei und ein .git enthaelt.
gefunden=0
while IFS= read -r verzeichnis; do
  [[ -n "$verzeichnis" ]] || continue
  gefunden=1
  echo
  echo "  $verzeichnis"
  if [[ -d "$verzeichnis/.git" ]]; then
    frage '    Commit' "$(git -C "$verzeichnis" rev-parse --short HEAD 2>/dev/null || echo '?')"
    frage '    Branch' "$(git -C "$verzeichnis" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    frage '    Remote' "$(git -C "$verzeichnis" remote get-url origin 2>/dev/null || echo '?')"
    # Ein unsauberer Arbeitsbaum heisst: auf dem Server steht etwas, das in
    # keinem Commit steht - und was in keinem Commit steht, holt kein
    # `git clone` zurueck.
    aenderungen=$(git -C "$verzeichnis" status --porcelain 2>/dev/null | wc -l)
    frage '    Nicht committete Aenderungen' "$aenderungen"
  fi
  if [[ -f "$verzeichnis/.env" ]]; then
    frage '    .env Rechte' "$(stat -c '%A %U:%G' "$verzeichnis/.env" 2>/dev/null)"
    echo '    Gesetzte Variablen (nur Name und Laenge des Werts):'
    # Keine Werte. `${#wert}` ist die Laenge - genug, um «gesetzt» von
    # «leer» zu unterscheiden.
    while IFS='=' read -r name wert; do
      [[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
      printf '      %-32s %s\n' "$name" "$([[ -n "$wert" ]] && echo "gesetzt (${#wert} Zeichen)" || echo 'LEER')"
    done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$verzeichnis/.env" 2>/dev/null)
  else
    echo '    Keine .env vorhanden.'
  fi
done < <(find / -maxdepth 4 -name 'docker-compose*.y*ml' -not -path '*/node_modules/*' -printf '%h\n' 2>/dev/null | sort -u)
[[ "$gefunden" -eq 1 ]] || echo '  Kein Projektverzeichnis mit Compose-Datei gefunden.'

abschnitt '6. Upload- und Medienverzeichnisse'
for pfad in /var/lib/swisshub/uploads /data/storage /app/uploads; do
  if [[ -d "$pfad" ]]; then
    frage "$pfad" "$(du -sh "$pfad" 2>/dev/null | cut -f1), $(find "$pfad" -type f 2>/dev/null | wc -l) Dateien"
  fi
done
if hat docker; then
  echo '  In Volumes (ueber die Einhaengepunkte der Container):'
  for behaelter in $(docker ps -q 2>/dev/null); do
    name=$(docker inspect --format '{{.Name}}' "$behaelter" | tr -d '/')
    docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}    '"$name"': {{.Name}} -> {{.Destination}} ({{if .RW}}rw{{else}}ro{{end}})
{{end}}{{end}}' "$behaelter" 2>/dev/null
  done
fi

abschnitt '7. Bestehende Sicherungen'
for pfad in /var/backups/swisshub /var/backups /opt/swisshub/backups /var/lib/swisshub-backup; do
  if [[ -d "$pfad" ]]; then
    echo "  $pfad ($(du -sh "$pfad" 2>/dev/null | cut -f1)):"
    # Die letzten fuenf, neueste zuerst. Wichtiger als die Liste ist das
    # Datum des jeweils neuesten Eintrags: eine Sicherung von vor drei
    # Wochen ist keine Sicherung.
    find "$pfad" -maxdepth 2 -type f -printf '    %TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null | sort -r | head -5
  fi
done
echo
echo '  Zeitgesteuerte Auftraege:'
crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' | sed 's/^/    root: /' || echo '    (kein root-Crontab)'
for datei in /etc/cron.d/*; do
  [[ -f "$datei" ]] && grep -Ev '^#|^$' "$datei" 2>/dev/null | sed "s|^|    $datei: |"
done
if hat systemctl; then
  echo '  Timer:'
  systemctl list-timers --all --no-pager 2>/dev/null | grep -Ei 'backup|sicherung|pgbackrest|restic|swisshub|certbot' | sed 's/^/    /' || echo '    (keine passenden Timer)'
fi
echo
echo '  Backup-Werkzeuge:'
for werkzeug in pgbackrest restic kopia borg rclone pg_dump age gpg; do
  printf '    %-14s %s\n' "$werkzeug" "$(hat "$werkzeug" && ("$werkzeug" --version 2>&1 | head -1) || echo 'nicht vorhanden')"
done

abschnitt '8. Reverse Proxy, TLS und DNS'
if hat nginx; then
  frage 'nginx' "$(nginx -v 2>&1)"
  echo '  Aktive Server-Namen:'
  grep -rhE '^\s*server_name' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | tr -s ' ' | sed 's/^ //' | sort -u | sed 's/^/    /'
fi
hat apache2 && frage 'apache2' "$(apache2 -v 2>&1 | head -1)"
if [[ -d /etc/letsencrypt/live ]]; then
  echo '  Zertifikate:'
  for zert in /etc/letsencrypt/live/*/cert.pem; do
    [[ -f "$zert" ]] || continue
    # `-enddate` allein waere ein Datum, das man selbst nachrechnen muss.
    # `-checkend` sagt direkt, ob es in 30 Tagen noch gilt.
    ablauf=$(openssl x509 -enddate -noout -in "$zert" 2>/dev/null | cut -d= -f2)
    if openssl x509 -checkend 2592000 -noout -in "$zert" >/dev/null 2>&1; then
      warnung=''
    else
      warnung='  <-- laeuft in weniger als 30 Tagen ab'
    fi
    printf '    %-34s %s%s\n' "$(basename "$(dirname "$zert")")" "$ablauf" "$warnung"
  done
fi
echo '  Oeffentliche Adressen dieses Hosts:'
# Ueber den Proxy erreichbar oder nicht - beides ist eine Auskunft.
frage '    IPv4 (extern)' "$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo 'nicht ermittelbar')"
ip -4 addr show scope global 2>/dev/null | awk '/inet /{print "    lokal: "$2}'

abschnitt '9. Gesundheit der Dienste'
for url in http://127.0.0.1:3000/api/health; do
  antwort=$(curl -fsS --max-time 10 "$url" 2>/dev/null)
  frage "$url" "${antwort:-keine Antwort}"
done
if hat docker; then
  echo '  Gesundheitszustand der Container:'
  for behaelter in $(docker ps -q 2>/dev/null); do
    docker inspect --format '    {{.Name}}: {{.State.Status}}{{if .State.Health}} / {{.State.Health.Status}}{{end}} (Neustarts: {{.RestartCount}})' "$behaelter" 2>/dev/null
  done
fi

abschnitt '10. Zusammenfassung fuer die Planung'
cat <<'ENDE'
  Uebertrage diese Werte nach docs/BESTANDSAUFNAHME.md, Abschnitt «Auf dem
  Server zu pruefen»:

    [ ] Laufen alle SwissHub-Dienste auf diesem einen Host?  (Abschnitt 3, 5)
    [ ] Wie viele PostgreSQL-Cluster gibt es wirklich?        (Abschnitt 4)
    [ ] Wie gross ist die groesste Datenbank?                 (Abschnitt 4)
    [ ] Wie gross sind die Upload-Verzeichnisse zusammen?     (Abschnitt 6)
    [ ] Wie viel Platz ist frei - reicht er fuer ein lokales
        Backup-Repository von etwa dem Doppelten der Datenmenge? (Abschnitt 2)
    [ ] Ist heute ueberhaupt eine Sicherung eingerichtet?      (Abschnitt 7)
    [ ] Wie alt ist die neueste vorhandene Sicherung?          (Abschnitt 7)
    [ ] Steht wal_level auf 'replica' oder hoeher?             (Abschnitt 4)
    [ ] Gibt es nicht committete Aenderungen auf dem Server?   (Abschnitt 5)
ENDE

printf '\nBestandsaufnahme beendet: %s\n' "$(date --iso-8601=seconds)"
[[ -n "$BERICHT" ]] && printf 'Bericht geschrieben: %s\n' "$BERICHT"
exit 0
