# Anwendungsbewertung

Die Anwendungsbewertung ist die Kernfunktion von SWAO. Sie analysiert eine Cloud-Anwendung
anhand ihres Quellcodes, ihrer Konfigurationsdateien und operativer Kontextdokumente und
erstellt dann einen umfassenden Satz von Compliance-Signalen, ein Migrationsbereitschafts-
urteil und ein vollstaendiges Publikationspaket.

**CLI:** `swao assess --app <app-id>`

**TUI:** Hauptmenue > Bewertung durchfuehren > [1] Anwendungsbewertung

---

## Ergebnisse

Nach einem vollstaendigen Bewertungsdurchlauf erhalten Sie:

| Ausgabe | Speicherort | Inhalt |
|---|---|---|
| Signale | `apps/<id>/wsp/signals/` | Jeder Befund mit ID, Schweregrad, Steuerungszuordnung, Begruendung und Evidenz |
| Pruefbericht | `apps/<id>/wsp/auditor.md` | Vollstaendige Signalliste in Markdown -- druckbar, per E-Mail versendbar |
| BI-Exportpaket | `apps/<id>/wsp/exports/` | 17-Tabellen-Sternschema (CSV + NDJSON + XLSX) fuer Power BI oder Tableau |
| HTML-Publikation | `apps/<id>/wsp/publications/` | Eigenstaendige HTML-Datei mit Suche, Persona-Ansichten und Evidenzgalerie |

---

## Analysedurchlaeufe

SWAO fuehrt bis zu 14 Analysedurchlaeufe durch, die jeweils einen spezifischen Aspekt der
Anwendung ansprechen. Durchlaeufe, die kein LLM erfordern, sind immer enthalten;
LLM-abhaengige Durchlaeufe benoetigen einen konfigurierten Anbieter.

| Durchlauf | Was analysiert wird | LLM? |
|---|---|---|
| Inventar | Dateitypen, Technologiestapel, Erkennung von Abhaengigkeitsmanifesten | Nein |
| Zustandsanalyse | Laufzeitkonfiguration, Umgebungsvariablen, Secrets-Hygiene | Nein |
| Datenklassifizierung | PII und sensible Datenfelder in Schemas und Quellcode | Nein |
| Kontextimport | Dokumente in `apps/<id>/ingestion/` (CMDB, Architekturreviews, Transkripte) | Ja |
| Compliance-Bewertung | Quellcode gegen aktive Framework-Steuerungen (DSGVO, BSI C5 usw.) | Ja |
| SBOM | Software-Stueckliste aus Abhaengigkeitsmanifesten | Nein |
| Kryptografie | Verwendung von Cipher-Suiten, Zertifikatsverwaltung, Schluesselhandling | Nein |
| 7R-Synthese | Empfehlung fuer Migrationsstrategie (Retire, Retain, Rehost, Replatform, Refactor, Re-architect, Replace) | Ja |
| Landing-Zone-Bereitschaft | Pruefung der Kompatibilitaet mit souveraenen Cloud-Zielen | Nein |
| Risikoregister | Abgeleitete Risikoeintraege aus der Signalaggregation | Nein |

Durchlaeufe, die nicht ausgefuehrt werden koennen (fehlender Quellcode, fehlende
Anmeldeinformationen, LLM nicht konfiguriert), werden problemlos uebersprungen -- SWAO
meldet am Ende jedes Durchlaufs, welche Durchlaeufe ausgefuehrt und welche uebersprungen
wurden.

---

## Compliance-Frameworks

Die Bewertung wertet Signale gegen die in Ihrem Workspace aktiven Frameworks aus.
Sie koennen Frameworks installieren und aktivieren mit:

```
swao framework list
swao framework install <id>
```

Neun Community-Frameworks sind standardmaessig verfuegbar: DSGVO, AI 10 Pillars, COBIT 5,
NIST SP 800-66 R2, ISO 27001, PCI DSS, SOC 2, BSI C5, DORA.
Benutzerdefinierte Frameworks (eigenes YAML) werden in allen Editionen ebenfalls unterstuetzt.

---

## Kontextimport

Legen Sie unterstuetzende Dokumente in `apps/<app-id>/ingestion/` ab, bevor Sie die
Bewertung durchfuehren, um SWAO operativen Kontext bereitzustellen, der allein aus dem
Quellcode nicht sichtbar ist:

- Architekturdiagramme (PDF, DOCX, MD)
- CMDB / ServiceNow-Exporte (CSV, XLSX, JSON)
- Workshop-Transkripte oder Interview-Notizen (DOCX, MD, TXT)
- Terraform- oder IaC-Statusdateien
- Bestehende Pruefungsbefunde oder Risikoregister

SWAO liest diese waehrend des Kontextimport-Durchlaufs und kombiniert die Befunde mit
quellabgeleiteten Signalen. Aus Kontextdokumenten extrahierte Evidenz wird in der Ausgabe
separat attributiert, sodass Pruefende jeden Befund zu seiner Quelle zurueckverfolgen koennen.

---

## Laufzeit

Ein vollstaendiger Durchlauf gegen eine mittelgrosse Anwendung (50.000 Zeilen, 3
LLM-Durchlaeufe) dauert in der Regel 3 bis 8 Minuten, abhaengig von der Antwortzeit des
LLM-Anbieters. Nachfolgende Durchlaeufe, die gecachte Ergebnisse fuer unveraenderte Dateien
verwenden, sind erheblich schneller.
