#!/usr/bin/env bash
# SwissHub Backup - Installation.
#
#   sudo bash deploy/backup/install.sh
#
# Legt Benutzer, Gruppen, Verzeichnisse und systemd-Units an und kopiert die
# Werkzeuge nach /usr/local/lib/swisshub-backup.
#
# Schaltet NICHTS ein. Am Ende steht, was noch zu tun ist - und der wichtigste
# Punkt davon ist einer, den kein Skript erledigen kann: den privaten
# Wiederherstellungsschluessel an einem Ort aufbewahren, der nicht dieser
# Server ist.

set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { printf 'Bitte mit sudo ausfuehren.\n' >&2; exit 1; }

QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIEL='/usr/local/lib/swisshub-backup'
KONF='/etc/swisshub-backup'
DATEN='/var/lib/swisshub-backup'
DIENST_BENUTZER='swisshub-backup'
PG_BENUTZER="${SWISSHUB_PG_SYSTEM_USER:-postgres}"

schritt() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
hinweis() { printf '  \033[33m!\033[0m %s\n' "$*"; }

schritt '1. Werkzeuge pruefen'
fehlend=()
for werkzeug in pgbackrest restic age python3 curl; do
  command -v "$werkzeug" >/dev/null 2>&1 || fehlend+=("$werkzeug")
done
python3 -c 'import cryptography' 2>/dev/null || fehlend+=('python3-cryptography')
if [[ ${#fehlend[@]} -gt 0 ]]; then
  printf '  Es fehlen: %s\n\n' "${fehlend[*]}"
  printf '  Nachinstallieren:\n'
  printf '      apt update && apt install -y pgbackrest restic age python3-cryptography curl\n\n'
  printf '  `age` ist in Ubuntu ab 23.04 und Debian ab 12 dabei. Sonst:\n'
  printf '      https://github.com/FiloSottile/age/releases\n'
  exit 1
fi
ok 'Alle Werkzeuge vorhanden.'

schritt '2. Dienstbenutzer und Gruppen'
# Ein eigener Benutzer ohne Anmeldung und ohne Heimatverzeichnis. Er soll
# genau eines koennen: sichern.
if ! id -u "$DIENST_BENUTZER" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir "$DATEN" --shell /usr/sbin/nologin "$DIENST_BENUTZER"
  ok "Benutzer $DIENST_BENUTZER angelegt."
else
  ok "Benutzer $DIENST_BENUTZER existiert."
fi

# Die Gruppenmitgliedschaften, ohne die nichts laeuft.
#
# `postgres`: nur diese Gruppe kommt an das Datenverzeichnis, und ein
# physisches Backup kopiert genau diese Dateien.
# `docker`: bei SWISSHUB_PG_MODE=docker braucht der Lauf den Socket.
#
# Beides ist weitreichend, und es ist ehrlich, das zu sagen: wer in der
# docker-Gruppe ist, kann auf diesem Host root werden. Deshalb hat dieser
# Benutzer keine Anmeldung, keine Shell und kein Heimatverzeichnis - und
# deshalb gibt es den Controller, damit die WebApp nicht in diese Gruppe muss.
for gruppe in "$PG_BENUTZER" docker; do
  if getent group "$gruppe" >/dev/null 2>&1; then
    usermod -aG "$gruppe" "$DIENST_BENUTZER"
    ok "$DIENST_BENUTZER ist in der Gruppe $gruppe."
  else
    hinweis "Die Gruppe $gruppe existiert nicht - uebersprungen."
  fi
done

# Umgekehrt: der PostgreSQL-Benutzer muss in das Backup-Verzeichnis schreiben,
# weil pgBackRest unter ihm laeuft.
if id -u "$PG_BENUTZER" >/dev/null 2>&1; then
  usermod -aG "$DIENST_BENUTZER" "$PG_BENUTZER"
  ok "$PG_BENUTZER ist in der Gruppe $DIENST_BENUTZER."
fi

# Und die WebApp: sie muss in den Eingang schreiben. Welcher Benutzer das ist,
# haengt am Betrieb - bei Docker ist es der Benutzer im Container.
WEBAPP_BENUTZER="${SWISSHUB_WEBAPP_USER:-swisshub}"
if id -u "$WEBAPP_BENUTZER" >/dev/null 2>&1; then
  usermod -aG "$DIENST_BENUTZER" "$WEBAPP_BENUTZER"
  ok "$WEBAPP_BENUTZER ist in der Gruppe $DIENST_BENUTZER (fuer den Eingang)."
else
  hinweis "Der WebApp-Benutzer «$WEBAPP_BENUTZER» existiert auf dem Host nicht."
  hinweis 'Bei Docker ist das normal - siehe Schritt 7 unten.'
fi

schritt '3. Werkzeuge kopieren'
install -d -m 0755 "$ZIEL"
install -d -m 0755 "$ZIEL/bin" "$ZIEL/lib" "$ZIEL/vorlagen"
install -m 0755 "$QUELLE"/bin/* "$ZIEL/bin/"
install -m 0644 "$QUELLE"/lib/gemeinsam.sh "$ZIEL/lib/"
install -m 0755 "$QUELLE"/lib/*.py "$ZIEL/lib/"
install -m 0644 "$QUELLE"/vorlagen/* "$ZIEL/vorlagen/"
ok "Nach $ZIEL kopiert."

# Damit `swisshub-backup` von ueberall aufrufbar ist.
for werkzeug in swisshub-backup swisshub-backup-verify swisshub-restore-test \
                swisshub-recovery swisshub-secrets-seal swisshub-backup-monitor \
                swisshub-backup-selbsttest; do
  ln -sf "$ZIEL/bin/$werkzeug" "/usr/local/sbin/$werkzeug"
done
ok 'Nach /usr/local/sbin verlinkt.'

schritt '4. Konfiguration'
install -d -m 0750 -o root -g "$DIENST_BENUTZER" "$KONF"
if [[ -f "$KONF/swisshub-backup.env" ]]; then
  ok 'Die Konfiguration existiert bereits - sie wird NICHT ueberschrieben.'
else
  install -m 0640 -o root -g "$DIENST_BENUTZER" \
    "$QUELLE/swisshub-backup.env.example" "$KONF/swisshub-backup.env"
  ok "Vorlage nach $KONF/swisshub-backup.env kopiert."
  hinweis 'Sie MUSS ausgefuellt werden - siehe Schritt 8.'
fi
# Damit pgBackRest, das als PostgreSQL-Benutzer laeuft, hineinsehen kann.
if id -u "$PG_BENUTZER" >/dev/null 2>&1; then
  setfacl -m "u:$PG_BENUTZER:rx" "$KONF" 2>/dev/null \
    || chmod 0755 "$KONF"
fi

schritt '5. Verzeichnisse'
# setgid (2770): jede neu angelegte Datei erbt die Gruppe des Verzeichnisses.
# Ohne das liefe der erste Lauf und der zweite nicht mehr - hier arbeiten zwei
# Benutzer im selben Baum.
for verzeichnis in "$DATEN" "$DATEN/pgbackrest" "$DATEN/restic" "$DATEN/spool" \
                   "$DATEN/spool/eingang" "$DATEN/spool/ergebnis" "$DATEN/state" \
                   "$DATEN/log" "$DATEN/log/pgbackrest" "$DATEN/spool-wal" \
                   "$DATEN/cache" "$DATEN/lock" "$DATEN/logisch" "$DATEN/recovery"; do
  install -d -m 2770 -o "$DIENST_BENUTZER" -g "$DIENST_BENUTZER" "$verzeichnis"
done
# Das Repository und der WAL-Spool gehoeren dem PostgreSQL-Benutzer: pgBackRest
# legt dort Unterverzeichnisse an und will sie besitzen.
if id -u "$PG_BENUTZER" >/dev/null 2>&1; then
  chown -R "$PG_BENUTZER:$DIENST_BENUTZER" "$DATEN/pgbackrest" "$DATEN/spool-wal" "$DATEN/log/pgbackrest"
fi
# Der Eingang ist das EINZIGE Verzeichnis, in das die WebApp schreiben darf.
chmod 2770 "$DATEN/spool/eingang"
# Und das Ergebnisverzeichnis darf sie nur lesen.
chmod 2750 "$DATEN/spool/ergebnis"
ok "Verzeichnisse unter $DATEN angelegt."

schritt '6. systemd'
install -m 0644 "$QUELLE"/systemd/* /etc/systemd/system/
systemctl daemon-reload
ok 'Units installiert.'
printf '\n  Einschalten - bewusst NICHT automatisch:\n\n'
printf '      systemctl enable --now swisshub-backup-stuendlich.timer\n'
printf '      systemctl enable --now swisshub-backup-taeglich.timer\n'
printf '      systemctl enable --now swisshub-backup-woechentlich.timer\n'
printf '      systemctl enable --now swisshub-backup-verify.timer\n'
printf '      systemctl enable --now swisshub-restore-test.timer\n'
printf '      systemctl enable --now swisshub-backup-monitor.timer\n'
printf '      systemctl enable --now swisshub-backup-controller.path\n'
printf '      systemctl enable --now swisshub-backup-controller.timer\n'
printf '\n  Erst nach Schritt 8. Ein Zeitplan auf einer leeren Konfiguration\n'
printf '  erzeugt stuendlich einen Fehlschlag und sonst nichts.\n'

schritt '7. Wenn PostgreSQL im Container laeuft'
cat <<'HINWEIS'
  Zwei Ergaenzungen in docker-compose.prod.yml, beim Dienst `postgres`:

      build:
        context: .
        dockerfile: deploy/backup/vorlagen/Dockerfile.postgres
      volumes:
        - swisshub-postgres:/var/lib/postgresql/data
        - /etc/swisshub-backup:/etc/swisshub-backup:ro
        - /var/lib/swisshub-backup:/var/lib/swisshub-backup

  Das Abbild ist postgres:16-alpine mit pgBackRest darin. Ohne pgBackRest IM
  Container gibt es kein physisches Backup: es kopiert Dateien des Clusters,
  und die liegen nur dort.

  Und beim Dienst `web`, damit die WebApp Anforderungen ablegen und Zustaende
  lesen kann - nur diese zwei Pfade, und der Zustand nur lesend:

      volumes:
        - /var/lib/swisshub-backup/spool/eingang:/var/lib/swisshub-backup/spool/eingang
        - /var/lib/swisshub-backup/state:/var/lib/swisshub-backup/state:ro
        - /var/lib/swisshub-backup/spool/ergebnis:/var/lib/swisshub-backup/spool/ergebnis:ro

  Mehr braucht sie nicht, und mehr soll sie nicht haben. Das Repository selbst
  sieht sie nie.
HINWEIS

schritt '8. Was jetzt noch zu tun ist'
cat <<HINWEIS
  1. Zwei Passwoerter erzeugen und in $KONF/swisshub-backup.env eintragen:

         openssl rand -base64 48    -> SWISSHUB_PGBACKREST_CIPHER_PASS
         openssl rand -base64 48    -> SWISSHUB_RESTIC_PASSWORD

     Beide NIE mehr aendern: ein geaenderter Wert macht das bestehende
     Repository unlesbar.

  2. Pfade und Betriebsart eintragen: SWISSHUB_PG_MODE, SWISSHUB_PG_DATA,
     SWISSHUB_UPLOAD_DIR. Das Upload-Verzeichnis bei Docker so finden:

         docker volume inspect swisshub-uploads --format '{{.Mountpoint}}'

  3. DEN WICHTIGSTEN SCHRITT - auf einem ANDEREN Rechner, nicht hier:

         age-keygen -o swisshub-recovery.key

     Die Zeile «public key: age1...» nach SWISSHUB_RECOVERY_AGE_RECIPIENTS
     uebertragen. Mindestens zwei Schluessel erzeugen und beide eintragen.

     Die privaten Schluessel gehoeren an zwei getrennte Orte: einen
     Passwortmanager und ein Medium im Safe. NIE auf diesen Server.

     Das ist der Grund, weshalb ein Angreifer, der diesen Server uebernimmt,
     aus den Wiederherstellungspaketen nichts bekommt: er kann sie nicht
     oeffnen, und der Schluessel dazu liegt nicht hier.

  4. Externen Speicher einrichten: SWISSHUB_S3_*. Die Richtlinien fuer
     Object Lock und die getrennten Zugangsdaten stehen in
     deploy/backup/vorlagen/s3-richtlinien.md.

  5. Archivierung in PostgreSQL einschalten (postgresql.conf):

         wal_level = replica
         archive_mode = on
         archive_command = 'pgbackrest --stanza=swisshub --config=$KONF/pgbackrest.conf archive-push %p'
         archive_timeout = 300

     Ohne archive_timeout wird ein WAL-Segment erst archiviert, wenn es voll
     ist (16 MB) - auf einem ruhigen Server kann das Stunden dauern, und so
     alt waere dann der jungste erreichbare Zeitpunkt.

  6. Dann, in dieser Reihenfolge:

         swisshub-backup-selbsttest        # prueft die Anlage auf einem
                                           # Wegwerf-Cluster, beruehrt nichts
         swisshub-backup konfiguration-schreiben
         swisshub-backup einrichten
         swisshub-backup db-voll
         swisshub-backup dateien
         swisshub-backup geheimnisse
         swisshub-backup-verify
         swisshub-restore-test

  7. Zuletzt, und erst wenn alles davon gruen ist: die Timer einschalten.

  Ausfuehrlich: docs/BACKUP.md und docs/DISASTER-RECOVERY.md
HINWEIS

printf '\n\033[1mInstallation abgeschlossen. Eingeschaltet ist noch nichts.\033[0m\n'
