# Pass 25: Statische Binäranalyse (BINARY)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 25 |
| Schlüssel | Läuft automatisch (nicht über `--passes` auswählbar) |
| Signal-Präfix | `BIN` (Signalcodes `BINARY.*`) |
| Typ | Deterministische, statische Offline-Analyse von Dateien (nichts wird ausgeführt) |
| Standard | Für Service-Apps aktiv: läuft vor der Pass-Schleife von `swao assess` und vor VirusTotal in `swao service research`; ohne bereitgestellte Binärdateien geschieht nichts |
| Assessment-Typen | `service` (Service Portfolio Assessment) |
| Tier | Alle Tiers (`service-assessment` ist eine Community-Funktion) |
| Quelle | `packages/@swao/module-service-assessment/src/binary/`, Signalkatalog `packages/@swao/core/src/binary-signals.ts` |

## Wofür dieser Pass gedacht ist

Bei Standardsoftware liegt oft das Installationspaket vor, aber nicht der Quellcode. Pass 25 beantwortet die Frage: „Was lässt sich allein aus den Dateien über diese Software sagen: Ist sie signiert, ist die Signatur noch gültig, hängt sie von einer nicht mehr unterstützten Laufzeit ab, und ist sie nur als 32-Bit-Version verfügbar?“

Diese Fakten sind für die Migrationsplanung wichtig (veraltete Laufzeiten und 32-Bit-Programme schränken die Zielplattformen ein) und für die Sicherheit (unsignierte oder ungültig signierte ausführbare Dateien). Außerdem liefert der Pass den Hash des Installationspakets für die VirusTotal-Abfrage in [Pass 24 RESEARCH](/de/passes/24-research) und die Zertifikatsdaten für Pass 08 CRYPTO im Service-Modus.

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Installationspakete und ausführbare Dateien | Jede Datei in `apps/<id>/ingestion/binary/` und `apps/<id>/wsp/inputs/binary/` sowie Installations- und Paketdateien an jeder anderen Stelle in `apps/<id>/ingestion/` (`.exe`, `.dll`, `.sys`, `.msi`, `.msp`, `.msix`, `.appx`, `.jar`, `.war`, `.ear`, `.so`, `.dylib`, `.cab`, `.pkg`, `.dmg`, `.deb`, `.rpm`); einschließlich Unterordnern | Analysiert werden PE-Dateien (`.exe`, `.dll` und ähnliche) und MSI-Pakete; andere Installationsformate werden als nicht unterstützt aufgeführt (siehe unten), alle übrigen Dateien werden ignoriert |
| Installierter Programmordner (optional) | `binary.local_install_path` in der `.swao.yml` der App, zusätzlich Umgebungsvariable `SWAO_LOCAL_BINARY_SCAN=true` | Prüft eine vorhandene Installation nur lesend. Beide Einstellungen sind erforderlich. |

```yaml
# apps/hosapp200/.swao.yml (optionale lokale Prüfung)
binary:
  local_install_path: "C:/Program Files/ExampleVendor/HosApp"
```

## So funktioniert der Pass

1. **Dateien sammeln.** `ingestion/binary/` (jede Datei), den übrigen Ordner `ingestion/` (nur Installations- und Paketendungen), `wsp/inputs/binary/` und, falls aktiviert, den lokalen Installationspfad durchlaufen, bis zu 500 Dateien. Ein Hinweisordner ist nicht nötig: `swao service init` legt nur `ingestion/` an. Dateien, die SWAO selbst dort ablegt (`binary-analysis.json`, `manifest.json`), werden übersprungen.
2. **Format erkennen.** Jede Datei wird mit einem begrenzten Leser geöffnet: Jeder Lesezugriff wird gegen die Dateigröße geprüft, Dateien werden nie vollständig geladen. Eine Datei wird als PE analysiert, wenn sie einen gültigen PE-Header hat, sonst als MSI, wenn sie eine OLE-Verbunddatei mit MSI-Property-Tabelle ist. Dateien, die keines von beiden sind, aber eine Installations- oder Paketendung tragen, die Pass 25 nicht auswertet (`.msix`, `.msixbundle`, `.appx`, `.appxbundle`, `.jar`, `.war`, `.ear`, `.so`, `.bin`, `.deb`, `.rpm`, `.dmg`, `.pkg`), werden mit ihrem Format in `unsupported_files` aufgeführt, damit die Lücke sichtbar ist. Alle anderen Dateien werden ignoriert.
3. **PE-Analyse.** Liest den Maschinentyp (x86, x64, arm64, arm), PE32 oder PE32+, den Kompilierzeitstempel, importierte DLLs, das Alter der Visual-C++-Laufzeit aus dem CRT-Import (zum Beispiel bedeutet `msvcr100.dll` das Jahr 2010) und bei .NET-Assemblies die Metadatenversion, das Ziel-Framework und ob die Assembly AnyCPU ist.
4. **Authenticode.** Ist eine Signatur eingebettet, wird die PKCS#7-Struktur durchlaufen, um das Signaturzertifikat (Subject, Aussteller, Gültigkeit) zu finden und einen Zeitstempel zu erkennen (klassische Gegensignatur oder RFC 3161). Die Signatur wird nicht kryptografisch verifiziert.
5. **MSI-Analyse.** Liest die Tabelle `Property`, ohne `msiexec` auszuführen: Produktname, Version, Hersteller, Produktcode und Installationsverzeichnis.
6. **Hashing.** Ein SHA256-Hash wird in Blöcken zu 1 MB berechnet. Sind Größe und Änderungszeit einer Datei seit dem vorigen Lauf unverändert, wird der gespeicherte Hash wiederverwendet.
7. **Signale ableiten** (siehe unten) und Ergebnisse schreiben.

Fehlerhafte Strukturen werden für die Datei als `parse_error` festgehalten und halten den Pass nie an; nicht lesbare Dateien werden übersprungen.

## Wie gemessen wird

| Signal | Code | Regel | Schweregrad |
|---|---|---|---|
| `BIN-01` | `BINARY.UNSIGNED` | PE-Dateien ohne eingebettete Authenticode-Signatur | medium |
| `BIN-02` | `BINARY.EXPIRED_CERT` | PE-Dateien, deren Signaturzertifikat abgelaufen ist. Ein Signal je Lauf deckt beide Fälle ab und führt sie getrennt auf: Ohne Zeitstempel ist die Signatur nicht mehr gültig, mit Zeitstempel bleibt sie gültig | high, wenn mindestens eine betroffene Datei keinen Zeitstempel hat, sonst informational |
| `BIN-03` | `BINARY.LEGACY_RUNTIME` | Ziel-Framework .NET Framework unter 4.6.2, oder .NET-Metadatenversion unter 4 (2.0 bis 3.5) ohne Ziel-Framework, oder eine Visual-C++-Laufzeit älter als 2015 | high |
| `BIN-04` | `BINARY.LEGACY_ARCH` | Ausführbare Dateien nur für 32-Bit-x86, die nicht AnyCPU sind | low |
| `BIN-05` | `BINARY.COMPILATION_DATE_ANOMALY` | PE-Zeitstempel mehr als einen Tag in der Zukunft (oft ein Wert aus reproduzierbaren Builds, gelegentlich Manipulation) | low (Konfidenz low) |

Ausgewertet werden nur PE-Dateien, die fehlerfrei geparst wurden. Jedes Signal fasst alle betroffenen Dateien zusammen und nennt bis zu 20 Dateipfade als Nachweis; Dateiinhalte werden nie übernommen. Jedes Signal erscheint höchstens einmal je Lauf. Informative Signale tragen das Ergebnis `neutral`, alle anderen `negative`.

Beachten Sie, dass Systemdateien, die über einen Windows-Katalog statt über eine eingebettete Signatur signiert sind, bei statischer Analyse ebenfalls als unsigniert erscheinen.

### Wie die Ergebnisse genutzt werden

- **Pass 08 CRYPTO (Service-Modus)** meldet abgelaufene Signaturzertifikate ohne Zeitstempel als Befund mit Schweregrad high.
- **APM-Scoring** setzt die Regel `binary_runtime_current` auf 20, wenn `BINARY.LEGACY_RUNTIME` vorliegt, sonst auf 100 (keine Bewertung, wenn keine Binärdateien analysiert wurden).
- **Pass 24 RESEARCH** schlägt den ersten SHA256-Wert bei VirusTotal nach.
- **Pass 11 COMP** liest `binary-signals.json` zusätzlich zu den Signalen des Laufs als Evidenz.
- Die Portfolio-Exporte enthalten die Binärsignale.

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Node.js `crypto` (`X509Certificate`, SHA256) | Zertifikate lesen und Hashes berechnen | Node.js (MIT) | Eingebaut | - |
| SWAO-Leser für PE, Authenticode und MSI | Formatanalyse | SWAO | Gebündelt | - |
| `js-yaml`, `zod` | `.swao.yml` lesen, Signaldatei validieren | MIT | Gebündelt | - |

Keine externen Werkzeuge, kein Netzwerkzugriff und keine Ausführung der analysierten Dateien.

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<id>/wsp/inputs/binary/binary-analysis.json` | `generated_at`, `app_id`, ein Eintrag je erkannter Datei (Pfad, SHA256, Größe, Art, PE- oder MSI-Details, Zertifikate), `unsupported_files` (Pfad und Format jedes gefundenen, aber nicht ausgewerteten Installationspakets), `skipped_reason: no_binary_inputs`, wenn nichts gefunden wurde, `msi_skipped_reason: no_msi_inputs`, wenn kein MSI gefunden wurde, sowie die Einstellungen unter `local_scan` |
| `apps/<id>/wsp/signals/binary-signals.json` | Die Signale `BIN-NN` |

Dateipfade sind relativ zum App-Ordner; Dateien aus dem lokalen Installationspfad tragen das Präfix `local:`. Die Signale stehen in dieser separaten Datei und sind nicht Teil des Ordners `passes/` des Laufs; Pass 11 COMP liest sie von dort.

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| Installationspakete an beliebiger Stelle in `ingestion/`, Dateien in `ingestion/binary/` oder `wsp/inputs/binary/` | Eingaben |
| `binary.local_install_path` plus `SWAO_LOCAL_BINARY_SCAN=true` | Nimmt einen installierten Ordner hinzu (nur lesend) |

Bekannte Einschränkungen:

- Ausgewertet werden nur PE- und MSI-Dateien. MSIX- und APPX-Pakete, JAR-Dateien, Linux-Programme und andere Paketformate analysiert dieser Pass nicht; sie werden in `unsupported_files` aufgeführt. MSIX-, APPX-, JAR- und `.so`-Dateien (sowie `.bin`-Dateien unter `ingestion/binary/`) zählen für den Service-Pass-Plan weiterhin als Binäreingaben, sodass [Pass 14 MALWARE](/de/passes/14-malware) sie prüft (zum Beispiel mit ClamAV), wenn er angefordert wird.
- Authenticode-Signaturen werden gelesen, aber nicht verifiziert; eine manipulierte Datei mit unauffälligem Signaturblock wird nicht erkannt.
- Je App werden höchstens 500 Dateien analysiert.
- Die Laufzeitregeln decken nur .NET Framework und die Visual-C++-Laufzeit ab.

Siehe auch [Service Portfolio Assessment](/de/service-assessment/) und [Malware-Prüfung](/de/malware-scanning) (Pass 14 kann dieselben Binärdateien prüfen).
