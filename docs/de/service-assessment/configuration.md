# Konfigurationsreferenz

Die Service-Portfolio-Bewertung verwendet dieselben zwei Konfigurationsdateien wie jede SWAO-Bewertung. Eine eigene Service-Konfigurationsdatei gibt es nicht.

| Datei | Geltungsbereich | Geschrieben von |
|---|---|---|
| Workspace-`.swao.yml` | Gesamtes Portfolio | Ihnen; `swao service init` ergänzt den Block `service_portfolio:` |
| `apps/<id>/.swao.yml` | Eine Anwendung | `swao service init` (Scaffold); Sie dürfen sie bearbeiten |

## Workspace-`.swao.yml`: der Block `service_portfolio:`

```yaml
service_portfolio:
  source: wsp/inputs/service-intake/portfolio.xlsx      # Intake-Arbeitsmappe (relativer Pfad)
  mapping: wsp/inputs/service-intake/column-map.yaml    # Spaltenzuordnung, oder null für die Erkennung über die Kopfzeile
  imported_at: "2026-10-10"
  app_count: 214
  row_count: 309
  sheets: [Inventory]
  headers:                           # NUR Überschriften pro Blatt, niemals Zellwerte
    Inventory: { A: VM, I: OS, K: Hersteller Support }
  pii_columns: [K, L, N]             # auf Kennzeichen reduzierte Spalten
  cluster_threshold: 3
  cost:                              # optional: Berichtswährung
    currency: EUR                    # Standard EUR
    exchange_rates:                  # Einheiten pro 1 EUR, für andere Währungen erforderlich
      CHF: 0.94
  glossary:                          # optional: Intake-Begriff -> englischer Begriff
    Sonderbereich Nord: Special Unit North
    Radiologie: Diagnostic Imaging   # überschreibt den Produktstandard (Radiology)
```

| Schlüssel | Bedeutung |
|---|---|
| `source`, `mapping`, `imported_at`, `app_count`, `row_count`, `sheets`, `headers`, `pii_columns` | Vom Scaffold festgehaltene Intake-Metadaten. Probe 17 von `swao health-check` nutzt sie. |
| `cluster_threshold` | Mindestanzahl identischer Zeilen, die einen Cluster bilden (ganze Zahl, mindestens 2). |
| `cost.currency` | Berichtswährung der Kostenschätzungen. Standard `EUR`; `USD` funktioniert ohne weitere Angaben (EZB-Referenzkurs). |
| `cost.exchange_rates` | Weitere Währungen als Einheiten pro 1 EUR. Eine Währung ohne Kurs bricht den Scaffold mit einer klaren Fehlermeldung ab. Die Preise stammen aus der VM-Preistabelle, siehe [Kostenpreise](#kostenpreise). |
| `glossary` | Optional. Ordnet Fachbereichs- und Funktionsbegriffe aus dem Intake englischen Begriffen zu (Intake-Begriff -> englischer Begriff). Siehe [Intake-Begriffe auf Englisch](#intake-begriffe-auf-englisch). |

`swao service init` schreibt in diesem Block nur die Intake-Metadaten neu. Von Ihnen ergänzte Schlüssel, `cost` und `glossary`, bleiben bei einem erneuten Scaffold-Lauf erhalten.

Das Vorhandensein des Blocks `service_portfolio:` kennzeichnet den Workspace als Service-Workspace: Davon hängen die Health-Check-Probes 19 bis 25, die Service-Artefakte im Support-Bundle sowie die TIME-, CVE- und EoL-Kennzeichen im Engagement-Hub ab.

Compliance-Rahmenwerke funktionieren in zwei Schritten. Die **Erkennung** gilt für den ganzen Workspace: Jeder Rahmenwerksordner in `wsp/inputs/catalogs/community/<ordner>/` (zum Beispiel von [GitHub](https://github.com/Accenture/SWAO/tree/main/community-frameworks) kopiert) wird automatisch erkannt und in der Rahmenwerksauswahl der Terminal-Oberfläche angeboten. Die **Auswahl** gilt pro App: Die gewählten Rahmenwerke werden in `apps/<id>/.swao.yml` als `assessment.regimes_active` gespeichert; der Scaffold trägt dort `[SWAO_APM]` vor, und der Compliance-Pass ([Pass 11 COMP](/de/passes/11-comp)) bewertet genau diese Liste. Sie können die Liste auch von Hand bearbeiten oder `swao regime-select --app <id> --regimes SWAO_APM,DORA` verwenden:

```yaml
# apps/<id>/.swao.yml
assessment:
  type: service
  regimes_active: [SWAO_APM, DORA]
```

Ist `DORA` oder `NIS2` in einer App aktiv (oder in der Workspace-`.swao.yml` aufgeführt), füllt die Enterprise-Arbeitsmappe ihr Blatt DORA ICT Register. Das Blatt führt nur Apps mit einem Drittanbieter auf, also Apps, deren `.swao.yml` in `vendor.name` einen Hersteller nennt; Anwendungs-Apps ohne Hersteller bleiben außen vor.

## `apps/<id>/.swao.yml` pro App

Der Scaffold schreibt eine Datei pro Anwendung. Alle Blöcke werden gegen das Service-App-Schema geprüft.

```yaml
wsp_version: "0.9"
app_id: hosapp200
app_name: Imaging Viewer
assessment:
  type: service
  regimes_active: [SWAO_APM]
vendor_type: on-premises            # on-premises | saas | hybrid | legacy
site: Main campus
infra_category: INFRA_MEDIZIN_PACS  # oder UNKNOWN
os_class: INFRA_PLATFORM_OS_WINDOWS_SERVER
sovereign_rating: proprietary       # open-source | open-standard | proprietary
sovereign_alternatives:
  - { id: orthanc, name: Orthanc, sovereign_rating: open-source }
cluster: false
vendor:
  name: Example Imaging Vendor
  version: "7.2"
  support_active: true
  contract_expiry: "2028-06-30"
  support_contact_present: true     # nur Wahrheitswerte: Werte werden nie gespeichert
  support_phone_present: false
  support_email_present: true
platform: { os: Windows Server 2019, os_eol: null, auth_method: null, backup_enabled: true, sla_uptime: null }
hardware: { cpu_cores: 2, memory_mb: 8192, disk_count: 1, total_disk_gb: 100, est_cloud_cost_eur_mo: 77.8 }
business: { function: Image viewing, domain: Radiology, criticality: high, user_count: 120, annual_cost_eur: 18000 }
data: { health_data: true, pii: true, gdpr_art9: true, residency: DE, subprocessors: [], regulatory: [MDR] }
disposition:
  operational_status: active        # active | restricted | decommissioned | unused | inactive
  migration_candidate: false
  gartner_time: Tolerate            # die eigene TIME-Einschätzung aus der Intake-Tabelle
integrations: [hosapp900]           # App-IDs, von denen diese App abhängt
cost:
  currency: EUR
  monthly_estimate: 77.8
generated_fields: [app_name, vendor, platform, hardware, ...]
generated_at: "2026-10-10T08:00:00.000Z"
intake: { sheet: Inventory, row: 12, fields: [business_domain, business_function, cpu_cores, id_name_combined, integrations_raw, memory_mb, os, vendor_name, ...] }
```

### Blöcke

| Block | Inhalt |
|---|---|
| `assessment` | `type: service` und die aktiven Rahmenwerke (`regimes_active`, Standard `[SWAO_APM]`) |
| `vendor_type`, `site`, `infra_category`, `os_class`, `sovereign_rating`, `sovereign_alternatives` | Klassifizierung aus [INFRA-CAT](/de/service-assessment/infra-cat) |
| `cluster`, `cluster_id`, `cluster_member_count`, `cluster_members` | Cluster-Zusammenfassung (nur Cluster-Apps) |
| `vendor` | Hersteller, Version, Support, Vertrag; Ansprechpartner, Telefon und E-Mail nur als Wahrheitswerte |
| `platform` | Betriebssystem, Supportstatus des Betriebssystems, Authentifizierung, Backup, SLA |
| `hardware` | CPU, Arbeitsspeicher, Festplatten und die Cloud-Schätzung in Euro |
| `network` | IP und Netzwerkzone (optional) |
| `business` | Funktion, Fachbereich, Kritikalität, Nutzer, Jahreskosten, Lizenzart |
| `data` | Gesundheitsdaten, personenbezogene Daten, DSGVO Art. 9, HIPAA PHI, Klassifizierung, Speicherort, Unterauftragsverarbeiter, regulatorische Pflichten, MDR-Klasse |
| `disposition` | Betriebsstatus, Migrationskandidat, TIME der Analyse, Migrationsprojekt, Kennzeichen für ein Sovereign-Cloud-Programm |
| `integrations`, `integrations_notes` | Abhängigkeiten (App-IDs) und freie Integrationsnotizen, im Wortlaut des Kunden |
| `security` | Datum des letzten Sicherheitsaudits |
| `cost` | Lift-and-Shift-Schätzung in der Berichtswährung (Azure- und AWS-SKU, Monatsschätzung, Quelle des Wechselkurses) |
| `intake` | Blatt und Zeile, aus denen die App stammt; `fields`: die Intake-Felder, die der Spaltenaufbau zugeordnet hat (SWAO_APM unterscheidet damit einen leeren Wert von einer fehlenden Spalte); `source_text_fields`: Freitextfelder, die unverändert im Wortlaut des Kunden übernommen werden (derzeit `integrations_notes`) |
| `generated_fields`, `generated_at` | Vom Scaffold verwaltete Schlüssel |

### Kostenpreise

Die Lift-and-Shift-Schätzung bewertet jeden Server mit On-Demand-Listenpreisen (Pay-as-you-go) pro Stunde aus den öffentlichen Preis-APIs der Anbieter: der Azure Retail Prices API (Region `germanywestcentral`) und der AWS Price List API (Region `eu-central-1`). Jede Größe hat einen Linux-Preis und einen Windows-Preis mit enthaltener Windows-Server-Lizenz; ein Windows-Server (INFRA-CAT `os_class` oder der Betriebssystemtext im Intake) wird mit dem Windows-Preis dimensioniert und bewertet.

Die Preise stammen aus der VM-Preistabelle `prices/vm-prices.json`. `swao lz catalogue update` (CLI, oder LZ-Katalog aktualisieren in der Terminaloberfläche) aktualisiert sie im selben Lauf wie die LZ-Kataloge und schreibt `wsp/inputs/catalogs/lz-catalogues/prices/vm-prices.json`; der Scaffold verwendet diese Workspace-Kopie vorrangig vor der mit SWAO ausgelieferten Tabelle. Die Tabelle hält API, URL, Region, Währung und Abrufdatum jeder Quelle fest, und der Text in `cost.basis` nennt sie.

| Schlüssel in `cost` | Bedeutung |
|---|---|
| `price_os` | `windows`, wenn beide Provider mit einem Windows-Preis bewertet wurden, sonst `linux` |
| `azure.price_os`, `aws.price_os` | Betriebssystem des für diesen Provider verwendeten Preises |
| `windows_priced_as_linux` | Nur gesetzt, wenn die Tabelle für die Größe eines Windows-Servers keinen Windows-Preis hat und der Linux-Preis einspringt (die Lizenz ist dann nicht enthalten) |
| `provider_parity_assumed` | Nur gesetzt, wenn ein Provider für seine Größe keinen Preis hat; seine Schätzung übernimmt dann den Preis des anderen Providers (`price_from_provider` nennt ihn) |
| `skipped_reason: prices_unavailable` | Für keinen der Provider gibt es einen Preis (zum Beispiel keine Preistabelle); es gibt keine Schätzung |

Gleiche Schätzungen für Azure und AWS sind keine Annahme: Die Listenpreise von Azure D/E v3 und AWS m5/r5 sind in den beiden Regionen gleich (abgerufen am 2026-10-17).

### Intake-Begriffe auf Englisch

Intake-Arbeitsmappen sind oft deutsch oder gemischtsprachig. `swao service init` schreibt englische Standardwerte in `apps/<id>/.swao.yml` und behält den Wortlaut des Kunden daneben, sodass nichts verloren geht:

```yaml
business:
  domain: Radiology
  domain_source: Radiologie          # ursprünglicher Intake-Wert
  function: Diagnostic Reporting
  function_source: Befundung
  criticality: high
  criticality_source: Hoch
data:
  classification: Confidential
  classification_source: Vertraulich
disposition:
  gartner_time: Invest
  gartner_time_source: Investieren
```

| Feld | Englische Werte aus | `*_source`-Feld |
|---|---|---|
| `business.domain`, `business.domains` | Produkt-Glossar, dann `service_portfolio.glossary` | `domain_source`, `domains_source` (Liste) |
| `business.function` | Produkt-Glossar, dann `service_portfolio.glossary` | `function_source` |
| `business.criticality` | Feste Skala: `critical`, `high`, `medium`, `low` (zum Beispiel `Hoch` -> `high`) | `criticality_source` |
| `data.classification` | Feste Bezeichnungen: `Public`, `Internal`, `Confidential`, `Strictly Confidential`, `Secret` | `classification_source` |
| `disposition.gartner_time` | Feste Bezeichnungen: `Tolerate`, `Invest`, `Migrate`, `Eliminate` | `gartner_time_source` |

Regeln:

- Ein `*_source`-Feld wird nur geschrieben, wenn der Intake-Wortlaut vom englischen Wert abweicht. Ein englischer Intake erhält keine `*_source`-Felder.
- Groß- und Kleinschreibung sowie zusätzliche Leerzeichen spielen keine Rolle. Ja/Nein-Spalten akzeptieren `Ja`, `Nein`, `wahr`, `falsch`; `N/A`, `n.a.`, `k.A.` und `keine Angabe` bedeuten "nicht angegeben".
- `service_portfolio.glossary` in der Workspace-`.swao.yml` erweitert das Produkt-Glossar für Fachbereiche und Funktionen (zum Beispiel `Radiologie` -> `Radiology`, `Labor` -> `Laboratory`, `Verwaltung` -> `Administration`). Ihr Eintrag hat Vorrang vor einem Produkteintrag mit demselben Intake-Begriff. Die festen Skalen für Kritikalität, Klassifizierung und TIME ändert das Glossar nicht.
- Ein Wert ohne englischen Begriff bleibt unverändert. `swao service init` gibt pro Feld eine Warnung mit den nicht zugeordneten Werten aus; ergänzen Sie diese unter `service_portfolio.glossary` und führen Sie `swao service init --refresh` aus.
- Freitextnotizen (`integrations_notes`) werden nie übersetzt; `intake.source_text_fields` kennzeichnet sie als Text des Kunden.
- Die HTML-Publikation, die Enterprise-Arbeitsmappe und das Sternschema (`dim_service_app`) zeigen die englischen Werte; das Blatt Source Data der Arbeitsmappe enthält zusätzlich die `*_source`-Spalten. `--lang de` übersetzt die Bezeichnungen von SWAO, nicht die Kundendaten.

### Sicher bearbeiten

`swao service init --refresh` schreibt nur die in `generated_fields` aufgeführten Schlüssel der obersten Ebene neu. Das Scaffold führt dort `app_id`, `app_name`, `assessment`, `vendor_type`, `site`, `infra_category`, `os_class`, `sovereign_rating`, `sovereign_alternatives`, `cluster`, `cluster_id`, `cluster_member_count`, `cluster_members`, `vendor`, `platform`, `hardware`, `network`, `business`, `data`, `disposition`, `integrations`, `integrations_notes`, `security`, `intake` und `cost` auf. Alles andere in `apps/<id>/.swao.yml` bleibt erhalten, zum Beispiel ein von Ihnen ergänzter Block `binary:` oder `crawl:`. Vom Block `assessment` setzt der Refresh nur `type: service`; `regimes_active` und andere von Ihnen ergänzte Schlüssel bleiben unverändert.

Ein aufgeführter Schlüssel wird als ganzer Block ersetzt. Tragen Sie einen Wert innerhalb eines aufgeführten Blocks ein, zum Beispiel `vendor.name`, weil die Intake-Datei keine Herstellerspalte hat, entfernen Sie diesen Schlüssel (hier `vendor`) aus `generated_fields`; sonst überschreibt ihn der nächste Refresh mit dem Wert aus der Intake-Datei. Ergebnisse (TIME, Bewertungen, CVEs) werden nie in diese Datei geschrieben; sie liegen in `wsp/portfolio-summary.json` und in den Lauf-Ordnern.

Der Betriebsstatus ist wichtig: Apps mit `decommissioned`, `unused` und `inactive` werden als Eliminate eingestuft; `restricted` (behalten, nicht starten) bewusst nicht.

## Konfiguration des Rahmenwerks SWAO_APM

Das Bewertungsrahmenwerk ist das Community-Rahmenwerk `SWAO_APM`. Um es für ein Engagement anzupassen, kopieren Sie den mitgelieferten Rahmenwerksordner (sowohl `framework-meta.yaml` als auch `controls.yaml`) im Workspace nach `wsp/inputs/catalogs/community/swao-apm/`; SWAO liest dann beide Dateien aus der Workspace-Kopie.

| Schlüssel in `framework-meta.yaml` | Bedeutung |
|---|---|
| `framework.domain_weights` | Gewicht pro Domäne für den Risikowert; ganze Zahlen, deren Summe genau 100 ergeben muss (Health-Check-Probe 18) |
| `framework.time_rules` | Schwellenwerte der TIME-Einordnung (Betriebsstatus, CVE, Supportende, Domänenschwellen) |
| `framework.status`, `framework.version` | Metadaten des Rahmenwerks |

Details und Standardwerte: [Referenz zum Rahmenwerk SWAO_APM](/de/service-assessment/framework).
