# Pass 00: Ingestion (INGEST)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 00 |
| Schlüssel | `ingest` (Vorab-Pass; nicht über `--passes` auswählbar) |
| Signal-Präfix | keines (Pass 00 erzeugt keine Signale) |
| Typ | Deterministische Dateinormalisierung, kein LLM |
| Standard | Läuft immer vor der Pass-Schleife, sofern `<app>/ingestion/` existiert und Dateien enthält |
| Assessment-Typen | `application`, `service` (läuft immer), `llm` (läuft innerhalb des Assessments jedes Legs). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Projektunterlagen kommen selten geordnet an. Kunden übergeben Architektur-Foliensätze, Workshop-Protokolle in Word, Richtlinien als PDF, CMDB-Exporte in Excel und Terraform-State-Dateien, oft alles in einem Ordner. Pass 00 beantwortet die Frage: **„Wie bringe ich all dieses Material in das Assessment, ohne es von Hand zu sortieren?“**

Sie legen die Dateien in einem einzigen Ordner ab: `<app>/ingestion/`. Pass 00 sortiert jede Datei in die strukturierte Ablage `wsp/inputs/`, die von den nachfolgenden Passes gelesen wird, extrahiert lesbaren Text aus Office- und PDF-Dateien, damit die LLM-Passes sie nutzen können, und merkt sich, was bereits verarbeitet wurde. Wiederholte Läufe sind dadurch schnell.

## Was Sie bereitstellen müssen

- Dateien in `<app>/ingestion/` (Unterordner sind erlaubt und bleiben im Zielpfad erhalten). Dateien mit den Namen `.gitkeep`, `README.md` und `ingestion-manifest.json` werden ignoriert.
- Mehr ist nicht erforderlich. Fehlt `ingestion/` oder ist der Ordner leer, tut der Pass nichts.
- Optional: Pulumi-Cloud-Stacks unter `iac.pulumi.stacks` in der App-`.swao.yml` sowie ein Pulumi-Zugriffstoken im SWAO-Credential-Store unter dem Schlüssel `pulumi-api-token`. Pass 00 lädt dann jeden Stack-Export herunter, bevor lokale Dateien verarbeitet werden.

Legen Sie keine Archive in `ingestion/` ab. Entpacken Sie diese vorher und legen Sie die Dateien einzeln ab.

## Wie der Pass arbeitet

1. **Optionaler Pulumi-Download.** Für jeden konfigurierten Stack (`org`, `project`, `stack`) ruft SWAO den Export-Endpunkt von Pulumi Cloud auf (`https://api.pulumi.com/api/stacks/{org}/{project}/{stack}/export`) und schreibt das Ergebnis nach `wsp/inputs/pulumi/<project>-<stack>.json`. Pass 01 liest diese Dateien später.
2. **Dateien auflisten.** Alle Dateien unter `ingestion/` werden rekursiv erfasst.
3. **Binärdateien referenzieren, Archive ablehnen.** Programme, Installationspakete und Pakete unter `ingestion/binary/` (`.exe`, `.msi`, `.msp`, `.msix`, `.appx`, `.dll`, `.sys`, `.so`, `.dylib`, `.jar`, `.war`, `.ear`, `.pkg`, `.dmg`, `.deb`, `.rpm`, `.cab`, dazu `.bin`, `.iso`, `.img` und die unten genannten Archivtypen) werden in jedem Bewertungstyp nicht kopiert. In einem Service Portfolio Assessment werden die Installations- und Pakettypen zusätzlich an jeder anderen Stelle unter `ingestion/` referenziert, weil Service-Apps keine Hinweisordner haben; in einer Anwendungsbewertung wird eine solche Datei außerhalb von `ingestion/binary/` wie bisher nach `wsp/inputs/` kopiert. Referenzierte Dateien werden im Manifest als `referenced` vermerkt (Pfad und Größe, kein Hash). In einem Service Portfolio Assessment analysiert [Pass 25 BINARY](/de/passes/25-binary) sie an Ort und Stelle: Er liest `ingestion/binary/` sowie die Installations- und Paketdateien an jeder anderen Stelle unter `ingestion/`. Eine Kopie, die ein früherer Lauf in `wsp/inputs/` hinterlassen hat, wird entfernt. An allen anderen Stellen werden Dateien mit den Endungen `.zip`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.7z` oder `.rar` ebenfalls nicht kopiert: Sie werden als `rejected` vermerkt, verbunden mit dem Hinweis, sie zu entpacken.
4. **Warnung bei Dateien ohne Text.** Bilder (`.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.bmp`, `.webp`, `.ico`) werden immer nach `intake/` geleitet und mit `image-no-text-extraction` markiert; legen Sie eine `.description.txt` daneben, wenn der Bildinhalt wichtig ist. Für `.xps`-Dateien erscheint ein Hinweis, sie in PDF umzuwandeln.
5. **Jede Datei einem Kategorieordner zuordnen.** Die Entscheidung fällt anhand von **Dateiname** und Endung:
   - Zuerst werden Namensregeln geprüft. Beispiele: Namen mit `sbom`, `bom` oder `bill-of-materials` (als `.xlsx`, `.csv`, `.xml`, `.json`, `.cdx`) landen in `compliance/`; Namen mit `cmdb` oder `incident` (als `.csv` oder `.xlsx`) in `operations/`; CSV-Dateien `network-flow*` oder `nftables*` in `operations/`; Terraform- und HCL-Dateien sowie YAML-Dateien mit Begriffen wie `infra`, `k8s`, `helm`, `deploy`, `pipeline` oder `ansible` im Namen in `terraform/`; PDFs mit `policy` oder `procedure` im Namen in `architecture/guardrails/`; PDFs, die mit `dpa` oder `soc` beginnen oder `agreement` bzw. `legal` enthalten, in `compliance/`; `.docx`-Dateien in `workshops/`; `.pptx`- und Markdown-Dateien in `architecture/` (Markdown, das mit `workshop`, `meeting` oder `notes` beginnt, in `workshops/`); Quellcode-Dateien in `intake/`.
   - Greift keine Regel, entscheidet die Endung: `.csv`, `.xlsx`, `.xls` nach `operations/`; `.pdf`, `.docx`, `.doc`, `.pptx` nach `docs/`; `.yaml`, `.yml`, `.json` nach `structured/`; `.md`, `.txt` nach `architecture/`; `.tf`, `.tfstate`, `.tfplan`, `.hcl` nach `terraform/`; alles andere nach `intake/`.
   - Der Zielpfad lautet `wsp/inputs/<Kategorie>/<ursprünglicher relativer Pfad>`. Bei späteren Läufen wird das bisherige Ziel wiederverwendet, damit Dateien nicht zwischen Läufen wandern.
6. **Unveränderte Dateien überspringen.** Der SHA-256-Hash jeder Datei wird mit dem vorherigen Manifest verglichen. Stimmen Hash, Zieldatei und alle extrahierten Begleitdateien überein, wird die Datei übersprungen. Jedes Dokument zählt als neu (nicht im vorherigen Manifest), geändert (anderer Hash, oder die Kopie oder eine Begleitdatei fehlt) oder unverändert.
7. **Kopieren und Text extrahieren.** Neue oder geänderte Dateien werden kopiert. Binäre Office-Formate erhalten anschließend eine Text-Begleitdatei neben der Kopie:
   - PDF nach `<Datei>.extracted.txt` (pdf-parse)
   - DOCX nach `<Datei>.extracted.md` (mammoth; schlägt mammoth fehl, wird das Dokument-XML direkt ausgelesen)
   - XLSX nach je einer `<Datei>.<Blattname>.csv` pro Arbeitsblatt (exceljs)
   - PPTX nach `<Datei>.extracted.txt` mit dem Text aller Folien (adm-zip)
   - `.xls`- und ältere `.doc`-Dateien werden kopiert, aber nicht extrahiert; eine Warnung empfiehlt, sie in `.xlsx` beziehungsweise `.docx` umzuwandeln.
   - Dateien über 10 MB werden kopiert, aber nicht extrahiert.
8. **Aufräumen.** Verschwindet eine Datei aus `ingestion/`, werden ihre Kopie und ihre Begleitdateien aus `wsp/inputs/` entfernt.
9. **Warnung bei nicht verwalteten Dateien.** Liegen Dateien direkt in Unterordnern von `wsp/inputs/`, die Pass 00 nicht verwaltet, erscheint eine Warnung mit der Empfehlung, sie nach `ingestion/` zu verschieben. Reservierte Ordner werden nicht geprüft: `source`, `catalogs`, `terraform`, `yara-rules`, `checklists`, `evidence`, `interviews`, `cmdb`, `llm-gateway`, `research`, `binary`.
10. **Manifest schreiben** nach `ingestion/ingestion-manifest.json`.

## Wie gemessen wird

Pass 00 erzeugt weder Signale noch Bewertungen. Seine Wirkung ist indirekt:

- Jede Textdatei, die er unter `wsp/inputs/` ablegt, wird Kontext für [Pass 04 (CTX)](/de/passes/04-ctx). Der gewählte Kategorieordner bestimmt zugleich die Priorität der Datei im Prompt-Budget von CTX (beispielsweise haben `architecture/`, `compliance/` und `intake/` die höchste Priorität).
- Terraform-State in `wsp/inputs/terraform/` und Pulumi-Exporte in `wsp/inputs/pulumi/` speisen die Diensterkennung von [Pass 01 (INV)](/de/passes/01-inv).
- Nach `wsp/inputs/compliance/` geleitete SBOM-Exporte können in [Pass 05 (SBOM)](/de/passes/05-sbom) einfließen.

Die Konsolenzeile `Ingestion normalised  N file(s) (Kategorie: Anzahl, ...)` fasst jeden Lauf zusammen, und `[info] INGEST: N new, M changed, K unchanged document(s) in ingestion/` zeigt, was ein erneuter Lauf übernommen hat.

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| pdf-parse | Textextraktion aus PDF | MIT | Gebündelt | Entfällt (gebündelt); eine fehlerhafte Datei wird ohne Extraktion kopiert, mit Warnung |
| mammoth | DOCX nach Markdown | BSD-2-Clause | Gebündelt | Rückfall auf direkte XML-Textextraktion |
| exceljs | XLSX-Arbeitsblätter nach CSV | MIT | Gebündelt | Entfällt (gebündelt) |
| adm-zip | Folientext aus PPTX, DOCX-Rückfall | MIT | Gebündelt | Entfällt (gebündelt) |
| Pulumi Cloud API | Download von Stack-Exporten (optional) | Externer Dienst; Lizenz im Repository nicht erfasst | Extern, Netzwerkzugang und Token nötig | Pulumi-Schritt wird mit der Warnung `pulumi-token-missing` oder `pulumi-fetch-failed` übersprungen; die Dateiverarbeitung läuft weiter |

## Ausgaben

| Pfad | Inhalt |
|---|---|
| `ingestion/ingestion-manifest.json` | Schemaversion, Zeitstempel, jede zugeordnete Datei (Quelle, Ziel, Kategorie, SHA-256, Größe, extrahierte Begleitdateien), Anzahl je Kategorie, abgelehnte Dateien, an Ort und Stelle referenzierte Installationspakete und Pakete (`referenced`) |
| `wsp/inputs/<Kategorie>/...` | Zugeordnete Kopien Ihrer Dateien |
| `wsp/inputs/<Kategorie>/....extracted.txt`, `.extracted.md`, `.<Blatt>.csv` | Extrahierte Text-Begleitdateien |
| `wsp/inputs/pulumi/<project>-<stack>.json` | Pulumi-Stack-Exporte (nur mit `iac.pulumi.stacks`) |

Pass 00 schreibt keine Datei unter `wsp/runs/<ts>/passes/`.

## Konfiguration und Einschränkungen

**Konfiguration**

- `iac.pulumi.stacks` in der App-`.swao.yml`: Liste von `{ org, project, stack }`; Token aus dem Credential-Store-Schlüssel `pulumi-api-token`.
- `swao ingest [--workspace <path>] [--app <id>]` führt Pass 00 eigenständig aus. Nutzen Sie den Befehl vor `swao assess`, wenn Sie eine große Dokumentensammlung haben, damit die Extraktion das Assessment nicht verzögert.
- `swao assess` führt Pass 00 immer vor der Pass-Schleife aus (in einem Service Portfolio Assessment nach Pass 25 BINARY); `--passes` hat darauf keinen Einfluss.

**Einschränkungen und bekannte Lücken**

- Die Zuordnung nutzt Dateinamen und Endungen, nicht den Dateiinhalt. Benennen Sie Dateien aussagekräftig (zum Beispiel `cmdb-export.xlsx`, `architecture-overview.pptx`), damit sie im richtigen Ordner landen.
- Bilder und `.xps`-Dateien liefern keinen Text an die LLM-Passes.
- `.xls`- und `.doc`-Dateien sowie Dateien über 10 MB werden ohne Textextraktion kopiert. Wandeln Sie ältere Office-Dateien vorher in `.xlsx` oder `.docx` um.
- Archive werden abgelehnt, nicht entpackt. Unter `ingestion/binary/` werden sie stattdessen wie Installationspakete referenziert.
- In einem [Service Portfolio Assessment](/de/service-assessment/) legt `swao service init` nur den leeren Ordner `apps/<id>/ingestion/` an; legen Sie Dateien dort in beliebigen Unterordnern oder direkt ab. Bei Textdateien bleibt der Unterordner als Teil des Pfads unterhalb des Kategorieordners erhalten (aus `ingestion/binary/x.json` wird beispielsweise `wsp/inputs/structured/binary/x.json`). Hinweisordner wie `binary/` und `data-flow/` aus früheren Versionen funktionieren weiterhin: Das Service-Pass-Profil sucht sie zuerst in `wsp/inputs/` und `ingestion/` und verwendet andernfalls die Installationspakete, SBOMs und Dokumente an beliebiger Stelle unter `ingestion/`. Installationspakete bleiben an ihrem Ort und belegen in `wsp/inputs/` keinen zusätzlichen Speicherplatz.
