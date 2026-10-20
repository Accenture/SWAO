# Leitfaden zur Spaltenzuordnung

`swao service init` muss wissen, welche Tabellenspalte welche Information enthält. Dafür gibt es zwei Wege.

## Variante 1: Spalten aus der Kopfzeile erkennen lassen

Verwendet die Kopfzeile (Zeile 1 jedes Blatts) erkannte Namen, ist keine Konfiguration nötig. SWAO vergleicht die Überschriften ohne Beachtung der Groß- und Kleinschreibung, ohne führende und nachfolgende Leerzeichen und mit mehrfachen Leerzeichen als einem Leerzeichen, in zwei Durchgängen:

1. **Exakte Übereinstimmung.** Eine Überschrift, die einem erkannten Namen entspricht, wird zuerst zugeordnet.
2. **Präfix-Übereinstimmung.** Für noch nicht zugeordnete Felder wird auch eine Überschrift zugeordnet, die mit einem erkannten Namen beginnt, gefolgt von einem Leerzeichen oder einem der Zeichen `(` `[` `:` `/` `,` `;` `.`. So wird zum Beispiel `OS according to the configuration file` zu `os` und `AMS Sovereign Cloud Ja / Nein` zu `ams_sovereign_cloud`. `OSI layer` passt nicht zu `os`, und `Migrationsprojekt` passt nicht zu `migration`.

Jede Spalte speist höchstens ein Feld. Ein Blatt ohne Identitätsspalte (keine der Überschriften für `id`) wird mit einer Warnung übersprungen.

| Feld | Erkannte Überschriften | Ablage in `apps/<id>/.swao.yml` |
|---|---|---|
| `id` | `App ID`, `VM`, `ID`, `Server`, `Hostname` | `app_id` |
| `name` | `App Name`, `Application`, `Anwendung`, `Name` | `app_name` |
| `vendor_name` | `Vendor`, `Hersteller`, `Manufacturer` | `vendor.name` |
| `vendor_version` | `Version` | `vendor.version` |
| `vendor_url` | `Vendor Website`, `URL`, `Website` | `vendor.url` |
| `vendor_type` | `Assessment Type`, `Vendor Type` | `vendor_type` |
| `vendor_support_active` | `Vendor Support Active` | `vendor.support_active` |
| `contract_expiry` | `Contract Expiry`, `Vertragsende` | `vendor.contract_expiry` |
| `os` | `OS`, `Operating System`, `Betriebssystem` | `platform.os` |
| `os_eol` | `OS Support Status` | `platform.os_eol` |
| `active_memory_mb` | `Active Memory (MB)`, `Active Memory`, `Aktiver Speicher` | `hardware.active_memory_mb` |
| `memory_mb` | `Memory (MB)`, `Memory`, `RAM (MB)`, `RAM`, `Arbeitsspeicher` | `hardware.memory_mb` |
| `cpu_cores` | `CPU Cores`, `CPUs`, `CPU`, `vCPU`, `vCPUs` | `hardware.cpu_cores` |
| `disk_count` | `Disks`, `Disk Count` | `hardware.disk_count` |
| `total_disk_mib` | `Total Disk Capacity MiB`, `Total Disk (MiB)`, `Disk Capacity MiB` | `hardware.total_disk_mib` |
| `total_disk_gb` | `Total Disk (GB)`, `Disk (GB)`, `Total Disk Capacity GB` | `hardware.total_disk_gb` |
| `ip` | `IP`, `IP Address`, `IP-Adresse` | `network.ip` |
| `network_zone` | `Network Zone` | `network.zone` |
| `auth_method` | `Authentication` | `platform.auth_method` |
| `backup_enabled` | `Backup / DR`, `Backup` | `platform.backup_enabled` |
| `sla_uptime` | `SLA Uptime (%)`, `SLA Uptime` | `platform.sla_uptime` |
| `business_domain` | `Department`, `Fachbereich` | `business.domain` |
| `business_function` | `Function`, `App-Funktion`, `App Funktion` | `business.function` |
| `user_count` | `User Count` | `business.user_count` |
| `criticality` | `Criticality` | `business.criticality` |
| `annual_cost_eur` | `Annual Cost (EUR)`, `Annual Cost` | `business.annual_cost_eur` |
| `license_type` | `License Type`, `Licence Type` | `business.license_type` |
| `health_data` | `Contains Health Data` | `data.health_data` |
| `data_pii` | `Contains Personal Data (PII)`, `Contains Personal Data` | `data.pii` |
| `data_subjects` | `Data Subjects` | `data.subjects` |
| `data_categories` | `Data Categories` | `data.categories` |
| `data_classification` | `Data Classification` | `data.classification` |
| `data_residency` | `Data Residency` | `data.residency` |
| `subprocessors` | `Sub-processors`, `Subprocessors` | `data.subprocessors` |
| `gdpr_art9` | `GDPR Art.9 Health Data`, `GDPR Art.9` | `data.gdpr_art9` |
| `hipaa_phi` | `HIPAA PHI` | `data.hipaa_phi` |
| `regulatory` | `Regulatory Obligations` | `data.regulatory` |
| `mdr_class` | `MDR / IVDR Classification`, `MDR Class` | `data.mdr_class` |
| `migration_candidate` | `Migration Candidate`, `Migration` | `disposition.migration_candidate` |
| `migration_project_vendor` | `Migrationsprojekt mit Hersteller`, `Migration Project with Vendor`, `Vendor Migration Project` | `disposition.migration_project_vendor` |
| `ams_sovereign_cloud` | `AMS Sovereign Cloud` | `disposition.ams_sovereign_cloud` |
| `gartner_time` | `Gartner TIME` | `disposition.gartner_time` |
| `last_audit_date` | `Last Security Audit` | `security.last_audit_date` |
| `integrations_raw` | `Integration Dependencies`, `Integrations`, `KIS-Anbindung`, `KIS Anbindung`, `Schnittstellen` | `integrations` |

Die Listenfelder `data_subjects`, `data_categories`, `subprocessors` und `regulatory` werden an `,` aufgeteilt, `business_domain` an `/`.

Überschriften, die nach personenbezogenen Daten aussehen, sind immer PII-Spalten, unabhängig davon, zu welchem Feld sie sonst passen würden: Überschriften mit phone, Telefon, Telefonnummer, Tel, mobile, Mobil, e-mail, email, mail, contact, Kontakt oder Ansprechpartner sowie die Überschrift `Hersteller Support`. Ihre Werte werden nie gespeichert: SWAO hält nur fest, ob ein Wert vorhanden ist (`support_contact_present`, `support_phone_present`, `support_email_present` im Block `vendor`). Diese Prüfung läuft vor der Feldzuordnung, daher wird `Hersteller Support` nie zum Herstellernamen.

Hat das Blatt eine ID-Spalte, aber keine eigene Namensspalte (keine der Überschriften für `name`), wird die ID-Spalte in der kombinierten Form `ID (Name) Notizen` gelesen; siehe [Wie SWAO die ID-Zelle liest](#wie-swao-die-id-zelle-liest).

Nach `swao service init` zeigt die Zusammenfassung pro Blatt, welche Spalten erkannt wurden, und warnt, wenn Betriebssystem, App-Name oder Hersteller fehlen, weil die Recherche sie benötigt:

```text
  Columns (Inventory, header detection): 5 recognised: id_name_combined A, os B, cpu_cores C, memory_mb D, integrations_raw E
  [warn] Not in the intake: vendor name (CVE research). Add the column (or a column map) for better research, or fill the values in apps/<id>/.swao.yml.
```

## Wie SWAO die ID-Zelle liest

Die Identitätsspalte enthält die App-ID und oft mehr: einen Namen in Klammern, ein Betriebskennzeichen oder freie Notizen. SWAO wendet dieselben Regeln auf eine kombinierte Zelle `ID (Name) Notizen` (`id_name_combined`) und auf eine eigene ID-Spalte (`id`) an:

- **App-ID**: der Text vor der ersten `(` (oder dem Zeichen aus `split_on`), abgeschnitten an der ersten Kennzeichen-Phrase und an einem Bindestrich mit Leerzeichen auf beiden Seiten. Die übrigen Wörter bleiben Teil der ID, sodass `FILESRV 2020` zu `filesrv-2020` wird und sich von `FILESRV (Linux Fileserver)` unterscheidet, das zu `filesrv` wird.
- **Ordnertaugliche Form**: Kleinschreibung; `ä`, `ö`, `ü` und `ß` werden zu `ae`, `oe`, `ue` und `ss`; jedes andere Zeichen außerhalb von `a-z`, `0-9`, `.`, `_` und `-` wird zu einem Bindestrich; mehrere Bindestriche hintereinander werden zu einem zusammengefasst; führende und abschließende Bindestriche werden entfernt.
- **App-Name**: der Text in den Klammern bis zur letzten `)`, abgeschnitten vor einer Kennzeichen-Phrase; URL-kodierte Zeichen wie `%2f` werden dekodiert. Ohne Klammern bleibt der Name leer. Eine zugeordnete Namensspalte hat Vorrang.
- **Notizen**: Text nach der schließenden Klammer oder nach einer Kennzeichen-Phrase gelangt nie in die ID oder den Namen, weil Notizen Mitarbeitende nennen können.
- **Betriebskennzeichen**: die erste Kennzeichen-Phrase an beliebiger Stelle der Zelle, auch innerhalb der Klammern, setzt `disposition.operational_status`. Groß- und Kleinschreibung spielen keine Rolle.

| Phrase in der Zelle | Betriebsstatus |
|---|---|
| `nicht starten & nicht löschen` (auch mit `und` oder in der Schreibweise `loeschen`) | `restricted` (behalten, nicht starten) |
| `Alt Abgeschaltet`, `decommissioned` | `decommissioned` |
| `Ungenutzte Ressource` (auch gefolgt von `Nicht starten`) | `unused` |
| `nicht starten` oder `nicht löschen` allein | `restricted` |

Eine Zeile ohne Kennzeichen ist `active`, oder `inactive`, wenn ihr Arbeitsspeicher oder aktiver Speicher 0 ist. Apps mit `decommissioned`, `unused` oder `inactive` werden als Eliminate eingestuft; Apps mit `restricted` nicht.

| Zelle | App-ID | App-Name | Betriebsstatus |
|---|---|---|---|
| `HOSAPP133 (Imaging Viewer)` | `hosapp133` | Imaging Viewer | `active` |
| `HOSAPP145 (Archive4) NICHT LÖSCHEN ...` | `hosapp145` | Archive4 | `restricted` |
| `HOSAPP146 (Old Archive) Alt Abgeschaltet` | `hosapp146` | Old Archive | `decommissioned` |
| `HOSAPP051 (Spare VM) Ungenutzte Ressource. Nicht starten` | `hosapp051` | Spare VM | `unused` |
| `HOSAPP047 (Spare nicht starten)` | `hosapp047` | Spare | `restricted` |
| `FILESRV 2020` | `filesrv-2020` | (leer) | `active` |
| `HOSAPP200 - Imaging Router` | `hosapp200` | (leer) | `active` |
| `Prüf-Server` | `pruef-server` | (leer) | `active` |

Leitet eine neuere SWAO-Version die IDs anders ab als ein früheres Scaffold, listet `swao service init` die bestehenden Service-Apps auf, die die Intake-Datei nicht mehr erzeugt, und lässt sie unverändert. Löschen Sie diese App-Ordner oder legen Sie die Apps in einem neuen Workspace an.

## Variante 2: eine Spaltenzuordnung bereitstellen

Für jeden anderen Aufbau schreiben Sie eine YAML-Datei mit der Spaltenzuordnung. Übergeben Sie sie mit `--mapping` oder legen Sie sie neben die Arbeitsmappe in `wsp/inputs/service-intake/` (zum Beispiel als `column-map.yaml`): Fehlt `--from` und gibt es genau eine solche Datei, verwendet `swao service init` sie automatisch.

```bash
swao service init --from server-list.xlsx --mapping column-map.yaml
```

Vorlage für einen Export, dessen erste Spalte ID, Name und Notizen kombiniert (zum Beispiel `HOSAPP145 (Archive4) NICHT LÖSCHEN ...`). Die Überschriften in `note:` dienen nur der Orientierung; SWAO ordnet nach Spaltenbuchstaben zu. Passen Sie die Buchstaben an Ihr Blatt an und löschen Sie die Zeilen für Spalten, die Sie nicht haben, behalten Sie aber die Identität und `os`:

```yaml
# wsp/inputs/service-intake/column-map.yaml
version: "1.0"
source:
  sheet: 1                # Blattname oder 1-basierte Nummer; Standard: alle Blätter
  header_row: 1
  data_start_row: 2
fields:
  # Spalte A "Server (Application)": ID vor "(", Name in den Klammern
  id_name_combined:    { col: A, split_on: "(", strip_closing: ")", strip_flags: true }
  os:                  { col: B, note: "Operating System / Betriebssystem" }
  vendor_name:         { col: C, note: "Vendor / Hersteller" }
  vendor_version:      { col: D, note: "Version" }
  cpu_cores:           { col: E, type: integer, note: "vCPU" }
  memory_mb:           { col: F, unit: mb, note: "Memory (MB) / Arbeitsspeicher" }
  active_memory_mb:    { col: G, unit: mb, note: "Active Memory (MB) / Aktiver Speicher" }
  total_disk_gb:       { col: H, unit: gb, note: "Disk (GB) / Festplatte (GB)" }
  integrations_raw:    { col: I, multi_value_separator: ",", note: "Integrations / Schnittstellen" }
  business_domain:     { col: J, multi_value_separator: "/", note: "Department / Fachbereich" }
  business_function:   { col: K, note: "Function / Funktion" }
  migration_candidate: { col: L, true_values: ["Yes", "Ja"], false_values: ["No", "Nein"], note: "Migration candidate / Migrationskandidat" }
pii_columns:              # Werte auf wahr/falsch reduziert, nie gespeichert
  - { col: M, reason: support_contact }
  - { col: N, reason: support_phone }
  - { col: O, reason: support_email }
```

### Feldoptionen

| Option | Bedeutung |
|---|---|
| `col` | Spaltenbuchstabe (`A` bis `AZ`) oder 1-basierte Spaltennummer |
| `required` | Dokumentiert, dass die Spalte erwartet wird; zur Lesbarkeit akzeptiert, aber nicht pro Zelle erzwungen (Zeilen ohne Identität werden immer mit einem Signal SCAFFOLD.MANDATORY_FIELD_MISSING übersprungen) |
| `type` | `string`, `integer`, `number`, `boolean` oder `list` (Standard je Feld) |
| `unit` | `mb`, `mib` oder `gb` für Kapazitätsspalten; Werte wie `16 GB` werden umgerechnet |
| `true_values`, `false_values`, `null_values` | Wörter, die in Ihrer Tabelle ja, nein oder leer bedeuten |
| `multi_value_separator` | Eine Zelle in eine Liste aufteilen (Listenfelder) |
| `split_on` | Trennzeichen zwischen ID und Name in einer kombinierten Identitätszelle |
| `strip_closing`, `strip_flags` | Kombinierte Identitätszellen bereinigen: ein schließendes Zeichen entfernen und Betriebsstatus-Kennzeichen abtrennen (standardmäßig aktiv; das Kennzeichen wird weiterhin für den Betriebsstatus verwendet) |
| `app_id_pattern` | Für `integrations_raw`: regulärer Ausdruck, der App-IDs unter den Zellinhalten erkennt (übriger Text bleibt als Integrationsnotiz erhalten) |
| `note` | Freitext für Ihre eigene Dokumentation |

### Regeln, die SWAO durchsetzt

- Eine Identität ist Pflicht: Ordnen Sie entweder `id_name_combined` zu oder `id` (optional mit `name`), nicht beides.
- `os` ist in einer eigenen Zuordnung Pflicht: Es steuert die End-of-Life-Recherche, das wertvollste Signal pro Zeile.
- Eine in `pii_columns` aufgeführte Spalte darf nicht zusätzlich einem Feld zugeordnet werden.
- Unbekannte Feldnamen werden mit der Liste der unterstützten Felder abgelehnt.
- Überschriften, die nach personenbezogenen Daten aussehen, aber nicht in `pii_columns` stehen, erzeugen eine Warnung; auch Probe 17 von `swao health-check` meldet sie.

### Unterstützte Felder

`id_name_combined`, `id`, `name`, `vendor_type`, `vendor_name`, `vendor_version`, `vendor_url`, `vendor_support_active`, `contract_expiry`, `os`, `os_eol`, `auth_method`, `backup_enabled`, `sla_uptime`, `cpu_cores`, `memory_mb`, `active_memory_mb`, `disk_count`, `total_disk_mib`, `total_disk_gb`, `ip`, `network_zone`, `integrations_raw`, `business_function`, `business_domain`, `user_count`, `criticality`, `annual_cost_eur`, `license_type`, `health_data`, `data_pii`, `data_subjects`, `data_categories`, `data_classification`, `data_residency`, `subprocessors`, `gdpr_art9`, `hipaa_phi`, `regulatory`, `mdr_class`, `migration_candidate`, `gartner_time`, `migration_project_vendor`, `ams_sovereign_cloud`, `last_audit_date`.

## Welche Spalten am wichtigsten sind

| Priorität | Spalten | Warum |
|---|---|---|
| Pflicht | App-ID (und Name) | Ohne Identität kann kein App-Ordner angelegt werden |
| Dringend empfohlen | Betriebssystem, Migrationskandidat, Hersteller | End-of-Life-Recherche, TIME-Einordnung, CVE-Recherche |
| Empfohlen | CPU, Arbeitsspeicher, Festplatten, Integrationen, Fachbereich, fachliche Funktion | Cloud-Kostenschätzung, Integrationsgraph, Gruppierung, Kontext für die Recherche |
| Optional | IP, URL, Migrationsprojekt, Kennzeichen für ein Sovereign-Cloud-Programm | Netzwerkkontext, strategischer Kontext |

## Wo die Zuordnung festgehalten wird

Die Workspace-`.swao.yml` enthält einen Block `service_portfolio:` mit der Quelldatei, dem Pfad der Spaltenzuordnung, den Überschriften pro Blatt, den Buchstaben der PII-Spalten und dem Cluster-Schwellenwert. Er enthält nur Überschriften, niemals Zellwerte. Die `.swao.yml` jeder App führt zusätzlich in `intake.fields` auf, welche Felder der Spaltenaufbau zugeordnet hat; SWAO_APM unterscheidet damit einen leeren Wert von einer fehlenden Spalte.
