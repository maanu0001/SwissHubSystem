#!/usr/bin/env bash
# SwissHub - taegliche Sicherung: Datenbank **und** hochgeladene Dateien.
#
#   cp deploy/backup.sh /usr/local/bin/swisshub-backup
#   chmod +x /usr/local/bin/swisshub-backup
#   crontab -e   ->   30 3 * * * /usr/local/bin/swisshub-backup
#
# Erwartet entweder eine laufende Docker-Compose-Umgebung (Standard) oder
# gesetztes DATABASE_URL fuer eine System-PostgreSQL-Installation.
#
# ## Warum die Dateien mitmuessen
#
# Ein Dump allein war nie eine vollstaendige Sicherung, auch wenn die Anleitung
# das lange behauptet hat: das Logo, die Levelkarten-Hintergruende, die
# Profilbanner, die Anhaenge der Einsprueche und die Momente von Wrapped liegen
# als Dateien im Upload-Verzeichnis, nicht in der Datenbank.
#
# Mit den hochgeladenen Clips ist der Unterschied nicht mehr kosmetisch. Nach
# einer Wiederherstellung aus einem reinen Dump stuende jeder hochgeladene Clip
# in der Datenbank, und die Ausliefer-Route antwortete fuer jeden einzelnen mit
# 404 - eine Hall of Fame voller schwarzer Flaechen, ohne einen Fehler im Log.
#
# ## Warum ein Spiegel und keine dated Archive
#
# Weil diese Dateien sich nie aendern. Der Name entsteht serverseitig aus
# Zufall, und eine neue Datei bekommt einen neuen Namen - eine bestehende wird
# nie ueberschrieben. Ein taegliches `tar` waere damit jeden Tag dieselben
# Gigabyte, nur mit einem anderen Datum davor.
#
# Ein Spiegel plus der Dump desselben Tages stellt alles wieder her. Was der
# Spiegel nicht leistet: eine Datei zurueckholen, die seit dem letzten Lauf
# geloescht wurde. Das trifft genau die abgelehnten Clips - und die soll nach
# einer Wiederherstellung niemand mehr sehen.

set -euo pipefail

BACKUP_DIR="${SWISSHUB_BACKUP_DIR:-/var/backups/swisshub}"
PROJECT_DIR="${SWISSHUB_PROJECT_DIR:-/opt/swisshub}"
KEEP_DAYS="${SWISSHUB_BACKUP_KEEP_DAYS:-14}"
UPLOAD_DIR="${SWISSHUB_UPLOAD_DIR:-/var/lib/swisshub/uploads}"
UPLOAD_MIRROR="${SWISSHUB_UPLOAD_MIRROR:-${BACKUP_DIR}/uploads}"
STAMP="$(date +%Y-%m-%d_%H-%M)"
TARGET="${BACKUP_DIR}/swisshub_${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Variante A: PostgreSQL laeuft direkt auf dem System.
  pg_dump --no-owner --clean --if-exists "${DATABASE_URL}" | gzip -9 > "${TARGET}"
else
  # Variante B: PostgreSQL laeuft im Docker-Compose-Stack.
  cd "${PROJECT_DIR}"
  docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_dump --no-owner --clean --if-exists -U "${POSTGRES_USER:-swisshub}" "${POSTGRES_DB:-swisshub}" \
    | gzip -9 > "${TARGET}"
fi

chmod 600 "${TARGET}"

# Alte Sicherungen aufraeumen.
find "${BACKUP_DIR}" -name 'swisshub_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "Backup geschrieben: ${TARGET} ($(du -h "${TARGET}" | cut -f1))"

# --- Hochgeladene Dateien -----------------------------------------------------
#
# Uebersprungen, wenn es das Verzeichnis nicht gibt: eine Installation, die nie
# etwas hochgeladen hat, soll keinen Fehler melden.
if [[ ! -d "${UPLOAD_DIR}" ]]; then
  echo "Kein Upload-Verzeichnis unter ${UPLOAD_DIR} - nichts zu spiegeln."
  exit 0
fi

mkdir -p "${UPLOAD_MIRROR}"
chmod 700 "${UPLOAD_MIRROR}"

if command -v rsync >/dev/null 2>&1; then
  # `--delete`, damit der Spiegel nicht endlos waechst: geloescht wird hier nur,
  # was die Anwendung selbst geloescht hat (abgelehnte Clips, ersetzte Logos).
  rsync -a --delete "${UPLOAD_DIR}/" "${UPLOAD_MIRROR}/"
else
  # Ohne rsync: kopieren, was fehlt, und danach entfernen, was die Quelle nicht
  # mehr hat. `cp -a -u` laesst Dateien in Ruhe, die schon da sind - bei
  # unveraenderlichen Namen ist das der ganze Bestand ausser den neuen.
  cp -a -u "${UPLOAD_DIR}/." "${UPLOAD_MIRROR}/"
  (
    cd "${UPLOAD_MIRROR}"
    for datei in *; do
      [[ -e "${datei}" ]] || continue
      [[ -e "${UPLOAD_DIR}/${datei}" ]] || rm -f -- "${datei}"
    done
  )
fi

echo "Uploads gespiegelt: ${UPLOAD_MIRROR} ($(du -sh "${UPLOAD_MIRROR}" | cut -f1))"
