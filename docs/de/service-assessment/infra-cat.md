# INFRA-CAT-Referenz

SWAO-INFRA-CAT ist der Katalog der Infrastruktur- und Anwendungskategorien, mit dem die Service-Portfolio-Bewertung jede Intake-Zeile klassifiziert. Eine Kategorie sagt SWAO, um welche Art von System es sich handelt (zum Beispiel ein PACS, einen Domänencontroller oder eine VDI-Farm), welche Hersteller und Produktnamen darauf hinweisen, wie Supportende und Schwachstellen nachgeschlagen werden und welche souveränen oder Open-Source-Alternativen es gibt.

Die Klassifizierung fließt in die SWAO_APM-Bewertung (Domänen Souveränität und Migration), die Herstellerkonsolidierung, das Aufwandsmodell des [Migrationswellen-Generators](/de/service-assessment/migration-waves) und die HTML-Seite pro App ein.

## Tier 1: eingebaute Kategorien

Der eingebaute Katalog wird mit SWAO in `controls/infra-catalogue/` ausgeliefert (5 Dateien, 25 Kategorien). `swao service init` lädt ihn automatisch.

Jede eingebaute Datei deklariert oben ihre eigene `id`, ihren `name` und ihre `load_order`; eine Registry-Datei gibt es nicht. SWAO lädt jede `*.yaml` im Verzeichnis in aufsteigender `load_order` (Plattform 10, Infrastruktur 20, Arbeitsplatz 30, Sicherheit 40, Medizin 50); definieren zwei Dateien dieselbe Kategorie-ID, gewinnt die später geladene. Eine Datei mit fehlenden oder ungültigen Metadaten wird mit einer Warnung übersprungen. Tier-2-Dateien (unten) benötigen diese Metadaten nicht.

| Gruppe | Kategorie-ID | Name | Genannte souveräne Alternativen |
|---|---|---|---|
| Infrastruktur | `INFRA_INFRASTRUCTURE_DIRECTORY` | Directory Service / Domain Controller | Samba Active Directory, FreeIPA |
| Infrastruktur | `INFRA_INFRASTRUCTURE_DHCP_DNS` | DHCP / DNS | ISC Kea |
| Infrastruktur | `INFRA_INFRASTRUCTURE_FILE` | File Server / NAS | Nextcloud, Samba |
| Infrastruktur | `INFRA_INFRASTRUCTURE_BACKUP` | Backup and Recovery | Bareos |
| Infrastruktur | `INFRA_INFRASTRUCTURE_MAIL` | Mail Server | Open-Xchange |
| Infrastruktur | `INFRA_INFRASTRUCTURE_PKI` | Certificate Authority / PKI | EJBCA Community |
| Medizin | `INFRA_MEDIZIN_KIS` | Clinical Information System (KIS / EPR) | GNU Health, openEHR-basierte Systeme |
| Medizin | `INFRA_MEDIZIN_PACS` | Picture Archiving and Communication System | Orthanc |
| Medizin | `INFRA_MEDIZIN_LIS` | Laboratory Information System | SENAITE LIMS |
| Medizin | `INFRA_MEDIZIN_PDMS` | Patient Data Management System (Intensivstation) | keine katalogisiert |
| Medizin | `INFRA_MEDIZIN_DOSE` | Radiation Dose Management | keine katalogisiert |
| Medizin | `INFRA_MEDIZIN_TELEMATIK` | Telematikinfrastruktur (TI) | keine katalogisiert |
| Plattform | `INFRA_PLATFORM_OS_WINDOWS_SERVER` | Windows Server | Debian GNU/Linux, Ubuntu Server (LTS), openSUSE Leap |
| Plattform | `INFRA_PLATFORM_OS_LINUX_DEBIAN` | Debian GNU/Linux | keine katalogisiert (Open Source) |
| Plattform | `INFRA_PLATFORM_OS_LINUX_UBUNTU` | Ubuntu Linux | keine katalogisiert (Open Source) |
| Plattform | `INFRA_PLATFORM_OS_LINUX_SUSE` | SUSE Linux Enterprise Server | keine katalogisiert |
| Plattform | `INFRA_PLATFORM_OS_LINUX_RHEL` | Red Hat Enterprise Linux family | keine katalogisiert |
| Plattform | `INFRA_PLATFORM_OS_SOLARIS` | Oracle Solaris | keine katalogisiert |
| Plattform | `INFRA_PLATFORM_DATABASE` | Standalone Database Server | PostgreSQL, MariaDB |
| Sicherheit | `INFRA_SECURITY_ENDPOINT` | Endpoint Protection / EDR | keine katalogisiert |
| Sicherheit | `INFRA_SECURITY_NAC` | Network Access Control | PacketFence |
| Sicherheit | `INFRA_SECURITY_SIEM` | SIEM / Log Management | Wazuh |
| Arbeitsplatz | `INFRA_WORKPLACE_VDI` | VDI / Virtual Desktop Infrastructure (clusterfähig) | OpenStack + Apache Guacamole |
| Arbeitsplatz | `INFRA_WORKPLACE_PRINT` | Print Services | CUPS |
| Arbeitsplatz | `INFRA_WORKPLACE_THIN_CLIENT` | Thin Client Management | keine katalogisiert |

Zeilen ohne Treffer werden als `UNKNOWN` eingestuft und erzeugen ein Signal `SCAFFOLD.CATEGORY_UNKNOWN`. Die Scaffold-Zusammenfassung listet sie auf; setzen Sie `infra_category` in `apps/<id>/.swao.yml` von Hand oder ergänzen Sie eine Tier-2-Kategorie.

## Wie eine Zeile klassifiziert wird

SWAO probiert drei Strategien in fester Reihenfolge. Innerhalb einer Strategie gewinnt die erste Kategorie in Ladereihenfolge.

1. **`id_prefix_hints`**: Die führenden Buchstaben der App-ID (zum Beispiel `hospacs` aus `HOSPACS004`) passen zu einem Hinweis.
2. **`vendor_patterns`**: Die Hersteller-Zelle enthält eines der Muster (Teilzeichenkette, ohne Beachtung der Groß- und Kleinschreibung).
3. **`product_name_patterns`**: Ein regulärer Ausdruck passt auf den App-Namen (ohne Beachtung der Groß- und Kleinschreibung).

Unabhängig davon setzen `os_string_patterns` der Plattformkategorien die `os_class` der App aus der Betriebssystem-Zelle, und Standort-Präfixe setzen `site`.

## Cluster

Kategorien mit `cluster_hint: true` (eingebaut: VDI) erlauben dem Scaffold, identische Zeilen zusammenzufassen. Teilen mindestens `cluster_threshold` Zeilen (Standard 3) dasselbe ID-Präfix und dieselbe Kategorie, entsteht daraus eine Cluster-App (zum Beispiel `hoscix-cluster` für `HOSCIX001` bis `HOSCIX005`), die ihre `cluster_members` auflistet. Eine VDI-Farm mit 30 Workern wird dann einmal bewertet, nicht dreißigmal.

## Tier 2: engagementspezifische Kategorien

Ergänzen oder überschreiben Sie Kategorien für ein Engagement, indem Sie YAML-Dateien im Workspace unter `wsp/inputs/catalogs/infra-cat/` ablegen. Tier 2 ist optional.

- Eine Tier-2-Kategorie mit einer **neuen ID** wird nach den eingebauten Kategorien ergänzt.
- Eine Tier-2-Kategorie mit **derselben ID** wie eine eingebaute ersetzt diese für diesen Workspace.
- Dateien werden alphabetisch geladen; steht dieselbe ID in zwei Tier-2-Dateien, gewinnt die letzte, und Probe 21 von `swao health-check` warnt davor.

```yaml
# wsp/inputs/catalogs/infra-cat/engagement.yaml
id: INFRA_ENGAGEMENT
name: "Engagement-specific categories"
services:
  - id: INFRA_CUSTOM_LAB_ANALYSER
    name: "Laboratory analyser middleware"
    sovereign_rating: proprietary
    id_prefix_hints: [labmw]
    vendor_patterns: ["Example Lab Systems"]
    product_name_patterns: ["\\bAnalyser\\b", "\\bLabor\\b"]
    eol_product_ids: [windows-server]
    sovereign_alternatives:
      - { id: senaite, name: "SENAITE LIMS", sovereign_rating: open-source }
sites:
  - { prefix: anx, site: "Annex building" }
```

### Schlüssel einer Kategorie

| Schlüssel | Bedeutung |
|---|---|
| `id` | `INFRA_` gefolgt von Großbuchstaben, Ziffern, Unterstrichen |
| `name`, `short` | Anzeigename und Kurzbezeichnung |
| `sovereign_rating` | `open-source`, `open-standard` oder `proprietary` |
| `id_prefix_hints` | App-ID-Präfixe, die auf die Kategorie hinweisen |
| `vendor_patterns` | Teilzeichenketten des Herstellernamens (ohne Beachtung der Groß- und Kleinschreibung) |
| `vendor_canonical_name` | Normalisierter Herstellername für die Konsolidierungsgruppierung |
| `product_name_patterns` | Reguläre Ausdrücke auf den App-Namen; müssen kompilierbar sein (Probe 21 prüft das) |
| `os_string_patterns` | Teilzeichenketten der Betriebssystem-Zelle, die `os_class` setzen |
| `cluster_hint`, `cluster_by` | Cluster-Zusammenfassung erlauben (`cluster_by: id_prefix`) |
| `eol_product_ids` | Produkt-IDs von endoflife.date, die für diese Kategorie abgefragt werden |
| `osv_package` | `{ name, ecosystem }` für OSV.dev-Abfragen von Open-Source-Produkten |
| `data_health_implied`, `regulatory` | Standardwerte für Gesundheitsdaten und regulatorische Pflichten |
| `sovereign_alternatives` | Liste von `{ id, name, sovereign_rating }` |

Tier-2-Dateien sind nach der Bereinigung personenbezogener Daten im `swao support-bundle` enthalten.
