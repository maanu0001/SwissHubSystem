# Externer Speicher: Unveränderbarkeit und getrennte Zugangsdaten

Dieses Dokument beschreibt, wie der externe Backup-Speicher so eingerichtet
wird, dass **ein Angreifer mit vollem Zugriff auf den produktiven Server die
Backup-Historie nicht vernichten kann.**

Das ist der Zweck der ganzen Übung. Alles andere in diesem Dokument folgt
daraus.

---

## Das Problem in einem Satz

Der produktive Server braucht Schreibrechte auf den Backup-Speicher — sonst
kann er nicht sichern. Wer den Server übernimmt, bekommt diese Rechte. Wenn
Schreibrechte auch Löschrechte sind, löscht die Ransomware nach den Daten auch
die Backups, und zwar zuerst.

## Die Lösung in drei Sätzen

1. Der Server erhält Zugangsdaten, die **anlegen und lesen** dürfen — nicht
   löschen, nicht überschreiben, nicht die Sperre ändern.
2. Der Bucket ist **versioniert** und hat **Object Lock** mit einer
   Aufbewahrungsfrist. Innerhalb dieser Frist kann niemand eine Fassung
   entfernen — auch der Betreiber nicht.
3. Ein **zweites, getrenntes Zugangsdatenpaar** darf nur lesen. Es liegt nicht
   auf dem Server, sondern beim privaten Recovery-Schlüssel, und wird
   ausschließlich für eine Wiederherstellung benutzt.

---

## Warum Object Lock und nicht „Versionierung genügt doch“

Versionierung allein hilft nicht. Bei einem versionierten Bucket erzeugt ein
`DELETE` nur eine Löschmarkierung, die Fassung bleibt — aber ein
`DeleteObjectVersion` entfernt sie endgültig, und dazu genügen gewöhnliche
Schreibrechte. Ein Angreifer mit Schreibrechten kann also alle Fassungen
löschen.

Object Lock im **Compliance-Modus** ist die einzige Einstellung, bei der das
nicht geht. Sie lässt sich für eine Fassung innerhalb der Frist von niemandem
aufheben — nicht vom Betreiber, nicht vom Anbieter-Support, nicht mit dem
Hauptschlüssel des Kontos.

> **Der Preis ist echt und gehört genannt:** was im Compliance-Modus geschrieben
> wurde, belegt Platz und kostet Geld bis zum Ablauf der Frist. Ein
> versehentlich hochgeladenes 500-GB-Archiv ist 30 Tage lang nicht zu entfernen.
> Governance-Modus erlaubt eine Aufhebung mit einer besonderen Berechtigung —
> und damit ist er gegen einen Angreifer, der auch diese Berechtigung erlangt,
> wirkungslos. **Compliance ist die Wahl, wenn der Schutz echt sein soll.**

---

## Einrichtung: Backblaze B2

B2 ist der günstigste Anbieter mit vollem Object-Lock-Support und ist hier
deshalb das erste Beispiel. Die Schritte bei Wasabi, Scaleway, Hetzner und AWS
sind gleichartig; die Begriffe unterscheiden sich.

### 1. Bucket anlegen

Web-Oberfläche → **Buckets** → **Create a Bucket**

| Einstellung        | Wert                                         |
| ------------------ | -------------------------------------------- |
| Bucket Name        | `swisshub-backup-<etwas-eindeutiges>`        |
| Files in Bucket    | **Private**                                  |
| Object Lock        | **Enable** — nachträglich nicht aktivierbar! |
| Default Encryption | Enable (schadet nicht, ersetzt nichts)       |

> **Object Lock lässt sich bei B2 nach dem Anlegen nicht mehr einschalten.**
> Wer es vergisst, muss den Bucket neu anlegen und alles neu übertragen. Das
> ist der eine Schritt, bei dem ein Versehen teuer wird.

### 2. Aufbewahrungsfrist setzen

Bucket → **Object Lock** → Default Retention

    Mode:   Compliance
    Period: 30 days

30 Tage ist die Untergrenze für den Fall, um den es geht: eine Beschädigung,
die erst nach drei Wochen auffällt. Bei weniger ist sie schon aus der Historie
gelaufen, bevor jemand sie bemerkt.

### 3. Lifecycle-Regel

Bucket → **Lifecycle Settings** → Custom

    Keep only the last version of the file: nein
    Hide files after:   90 days
    Delete files after: 120 days

Die Aufbewahrung wird **hier** geregelt und nicht auf dem Server. Das ist der
Kern: der Server hat keinen Weg, alte Sicherungen zu entfernen, und braucht
auch keinen. Die Gegenseite räumt auf, nach einer Regel, die der Server nicht
ändern kann.

Die Zahlen müssen zur Object-Lock-Frist passen: „delete after“ muss **größer**
sein als die Frist, sonst versucht die Lifecycle-Regel zu löschen, was gesperrt
ist, und scheitert dauerhaft.

### 4. Die schreibenden Zugangsdaten (für den Server)

**App Keys** → **Add a New Application Key**

| Einstellung             | Wert                                     |
| ----------------------- | ---------------------------------------- |
| Name of Key             | `swisshub-server-schreibend`             |
| Allow access to Bucket  | nur der Backup-Bucket                    |
| Type of Access          | **Read and Write**                       |
| Allow List All Bucket Names | nein                                 |

B2 hat kein feineres Raster als „Read and Write“. Der Löschschutz kommt hier
also **allein** aus Object Lock — und genau deshalb ist Object Lock bei B2
nicht optional, sondern die ganze Absicherung.

Diese beiden Werte nach `/etc/swisshub-backup/swisshub-backup.env`:

    SWISSHUB_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
    SWISSHUB_S3_REGION=eu-central-003
    SWISSHUB_S3_BUCKET=swisshub-backup-<...>
    SWISSHUB_S3_WRITE_KEY_ID=<keyID>
    SWISSHUB_S3_WRITE_SECRET=<applicationKey>

Der Endpunkt steht bei **Buckets → Endpoint**. Die Region ist der Teil daraus.

### 5. Die lesenden Zugangsdaten (NICHT für den Server)

**App Keys** → **Add a New Application Key**

| Einstellung            | Wert                          |
| ---------------------- | ----------------------------- |
| Name of Key            | `swisshub-recovery-lesend`    |
| Allow access to Bucket | nur der Backup-Bucket         |
| Type of Access         | **Read Only**                 |

**Diese beiden Werte gehören nicht auf den produktiven Server.** Sie gehören
an denselben Ort wie der private age-Schlüssel: Passwortmanager und Medium im
Safe.

Der Grund: wiederhergestellt wird auf einem *anderen* Server. Auf dem
produktiven haben lesende Zugangsdaten keinen Zweck — und ein Angreifer, der
ihn übernimmt, soll nicht auch noch bequem die Historie durchsehen können.

---

## Einrichtung: AWS S3 (mit echter Rechtetrennung)

AWS erlaubt, was B2 nicht kann: Schreibrechte ohne Löschrechte. Wo die Wahl
besteht, ist das die bessere Lösung — dann schützt nicht nur Object Lock,
sondern auch die Richtlinie.

### Bucket

    aws s3api create-bucket --bucket swisshub-backup-xyz \
        --region eu-central-1 \
        --create-bucket-configuration LocationConstraint=eu-central-1 \
        --object-lock-enabled-for-bucket

    aws s3api put-object-lock-configuration --bucket swisshub-backup-xyz \
        --object-lock-configuration '{
          "ObjectLockEnabled": "Enabled",
          "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Days": 30}}
        }'

### Richtlinie für den Server — schreiben, nicht löschen

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AnlegenUndLesen",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:GetBucketLocation",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": [
        "arn:aws:s3:::swisshub-backup-xyz",
        "arn:aws:s3:::swisshub-backup-xyz/*"
      ]
    },
    {
      "Sid": "NichtsLoeschenUndSperreNichtAnfassen",
      "Effect": "Deny",
      "Action": [
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:PutObjectRetention",
        "s3:PutObjectLegalHold",
        "s3:PutBucketObjectLockConfiguration",
        "s3:PutBucketVersioning",
        "s3:PutLifecycleConfiguration",
        "s3:PutBucketPolicy",
        "s3:DeleteBucket",
        "s3:DeleteBucketPolicy"
      ],
      "Resource": [
        "arn:aws:s3:::swisshub-backup-xyz",
        "arn:aws:s3:::swisshub-backup-xyz/*"
      ]
    }
  ]
}
```

Das ausdrückliche `Deny` ist der wichtige Teil. In AWS schlägt `Deny` jedes
`Allow` — auch eines, das später versehentlich oder böswillig hinzugefügt wird.
Eine Richtlinie, die nur die erlaubten Aktionen aufzählt, ließe sich durch ein
zweites `Allow` erweitern; ein `Deny` nicht.

`PutLifecycleConfiguration` steht ausdrücklich dabei: ohne dieses Verbot könnte
ein Angreifer eine Lifecycle-Regel „nach 1 Tag löschen“ setzen und damit
erreichen, was ein direktes `DeleteObject` nicht kann. Object Lock hielte die
gesperrten Fassungen, aber alles nach Ablauf der Frist wäre weg.

### Richtlinie für die Wiederherstellung — nur lesen

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:GetBucketLocation"
    ],
    "Resource": [
      "arn:aws:s3:::swisshub-backup-xyz",
      "arn:aws:s3:::swisshub-backup-xyz/*"
    ]
  }]
}
```

---

## Prüfen, dass es wirklich greift

Eine Einstellung, die man nicht geprüft hat, ist eine Annahme.
`swisshub-backup-verify` prüft sie in Stufe 3, und zwar auf die einzige
ehrliche Weise: **es versucht zu löschen und erwartet, dass es scheitert.**

    swisshub-backup-verify

Der Befund `unveraenderbarkeit` sagt eines von drei Dingen:

| Befund                                                     | Bedeutung                            |
| ---------------------------------------------------------- | ------------------------------------ |
| „Der Loeschversuch wurde abgelehnt“                        | Die Richtlinie greift. Gut.          |
| „Loeschen setzt nur eine Loeschmarkierung“                  | Versionierung greift. Gut.           |
| „liess sich restlos loeschen“                              | **Es greift nichts.** Nachbessern.   |

Für diese Prüfung braucht es die aws-CLI (`apt install awscli`). Fehlt sie,
sagt die Prüfung ausdrücklich, dass sie nicht durchgeführt wurde — statt
„unveränderbar“ zu behaupten.

Von Hand:

    aws --endpoint-url "$SWISSHUB_S3_ENDPOINT" s3api delete-object \
        --bucket "$SWISSHUB_S3_BUCKET" --key 'pgbackrest/backup/swisshub/backup.info'

Erwartet wird `AccessDenied` oder eine Löschmarkierung ohne Verlust der
Fassung. Klappt es restlos, ist der Schutz nicht vorhanden.

---

## Kosten, realistisch gerechnet

Für eine SwissHub-Installation mit einer Datenbank von etwa 2 GB und Uploads
von etwa 5 GB:

| Posten                                     | Menge      | B2       | Wasabi   | AWS S3   |
| ------------------------------------------ | ---------- | -------- | -------- | -------- |
| Speicher (4 Vollbackups + WAL + Dateien)   | ~40 GB     | 0.24 $   | 6.99 $¹  | 0.92 $   |
| Übertragung hinein                         | ~50 GB/Mt  | 0 $      | 0 $      | 0 $      |
| API-Aufrufe                                | ~200 000   | 0.08 $   | 0 $      | 1.00 $   |
| **Laufend im Monat**                       |            | **~0.35 $** | **~7 $** | **~2 $** |
| Übertragung heraus bei EINER Wiederherstellung | ~10 GB | 0 $²     | 0 $      | 0.90 $   |

¹ Wasabi berechnet mindestens 1 TB.
² B2 gibt dreimal die gespeicherte Menge je Monat kostenlos heraus.

**Compliance-Mode-Zuschlag:** Innerhalb der Frist gelöschte oder überschriebene
Fassungen belegen weiter Platz. Mit 30 Tagen Frist und täglicher Rotation
liegt der tatsächliche Verbrauch etwa 30–50 % über der Nettomenge. In der
Tabelle ist das eingerechnet.

Die Zahlen sind Listenpreise von September 2026 und als Größenordnung zu
lesen, nicht als Zusage.

---

## Wenn kein Budget da ist

Ein zweiter Server mit `rsync` über SSH ist **deutlich besser als nichts** und
deutlich schlechter als Object Lock: ein Angreifer mit dem SSH-Schlüssel des
produktiven Servers kommt an beide. Wenn es diesen Weg sein muss, dann
mindestens:

- Der Zielserver **zieht** per `rsync --ignore-existing`, statt dass der
  Quellserver schiebt. Damit braucht der produktive Server keinen Zugang zum
  Zielserver, und das ist die halbe Absicherung.
- Auf dem Ziel ein täglicher Hardlink-Snapshot (`cp -al`). Ein Überschreiben
  trifft dann nur den aktuellen Stand.
- Das Ziel gehört einem anderen Anbieter und einem anderen Rechenzentrum.

Dokumentiert werden muss dabei ehrlich: das ist **keine** unveränderbare Kopie.
`swisshub-backup-verify` wird das in Stufe 3 auch sagen.
