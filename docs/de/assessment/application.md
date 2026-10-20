# Anwendungsbewertung

![Banner Anwendungsbewertung: eine kristalline Anwendung speist die SWAO-Engine, die einen Ergebnisbildschirm erzeugt](/visuals/banner-application.svg)

Die Anwendungsbewertung ist der zentrale Arbeitsablauf von SWAO. Sie verweisen SWAO auf
den Quellcode einer Anwendung, ergänzen den vorhandenen Betriebskontext, und SWAO führt
eine Folge von Analyse-Passes aus. Das Ergebnis ist eine auditfähige Beweiskette: Jeder
Befund (ein *Signal*) hält fest, was gefunden wurde, wo, wie er abgeleitet wurde und wer
ihn bewertet hat (die Regel-Engine oder das LLM). Aus diesen Signalen leitet SWAO
Compliance-Bewertungen für Ihre aktiven Rahmenwerke, eine 7R-Migrationsempfehlung und
die Eingaben für die Landing-Zone-Bewertung ab.

Die Anwendungsbewertung ist zugleich die Grundlage für zwei weitere Typen: Die
[Landing-Zone-Katalogbewertung](/de/assessment/landing-zone) nutzt die erkannten
Plattformanforderungen, und die [LLM-Bewertung für SWAO](/de/assessment/llm) setzt
mindestens eine abgeschlossene Anwendungsbewertung voraus.

---

## Was Sie damit tun können

- **Souveränitäts- und Compliance-Prüfung.** Die Anwendung gegen DSGVO, BSI C5, NIS2,
  DORA, ISO 27001 oder jedes andere installierte [Community-Rahmenwerk](/de/frameworks/)
  abbilden und je Kontrolle ein Ergebnis mit Begründung und Nachweis erhalten.
- **Migrationsplanung.** Eine 7R-Empfehlung (Retire, Retain, Rehost, Replatform,
  Repurchase, Refactor, Re-architect) mit Begründung, Blockern, Befähigern und
  Portabilitäts-Score erhalten.
- **Technische Due Diligence.** Inventar der Sprachen, Frameworks und Abhängigkeiten,
  eine Software-Stückliste mit Lizenz- und CVE-Informationen, Lage bei Kryptografie und
  Geheimnissen, ausgehende Datenflüsse, Twelve-Factor-Reife.
- **Landing-Zone-Eignung.** Im selben Lauf prüfen, ob eine oder mehrere Cloud-Regionen
  die benötigten Dienste unter Ihren Souveränitätsanforderungen anbieten.
- **Audit-Vorbereitung.** Prüferinnen und Prüfern eine eigenständige HTML-Publikation
  oder einen Markdown-Prüfbericht übergeben, in dem jede Aussage auf Datei und Zeile
  zurückführbar ist.

---

## Was Sie bereitstellen

| Eingabe | Erforderlich | Ablageort |
|---|---|---|
| Quellcode | Ja | Ein lokaler Pfad (`source.path` in der `.swao.yml` der App oder `--source-path`) oder ein Git-Repository (`source.vcs.url` und `source.vcs.ref`; die TUI fragt Repository-URL, Branch und Unterverzeichnis ab) |
| Aktive Rahmenwerke | Empfohlen | `assessment.regimes_active` in der eigenen `apps/<id>/.swao.yml` der App (hat die App keine Liste, verwendet der Compliance-Pass die Liste in der Workspace-`.swao.yml`). Jedes aufgeführte Rahmenwerk muss installiert sein: Kopieren Sie dessen Ordner aus dem öffentlichen Verzeichnis [community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks) nach `<workspace>/wsp/inputs/catalogs/community/<ordner>/` auf Workspace-Ebene |
| LLM-Konnektor | Empfohlen | `.swao.yml` des Workspace (`providers.llm.primary`) oder `--llm <konnektor[:modell]>`; API-Schlüssel gehören in den SWAO-Credential-Store, nie in YAML |
| Kontextdokumente | Optional | CMDB-Exporte, Workshop-Protokolle, Architekturdokumente und FinOps-Berichte in `apps/<id>/ingestion/` ablegen; Pass 00 verteilt sie nach `wsp/inputs/` |
| URL der laufenden Anwendung | Optional | Für den Playwright-Crawl (Pass 10). URL und Anmeldedaten liegen im Credential-Vault; in `.swao.yml` stehen nur nicht sensible Crawl-Einstellungen |
| Terraform-State oder -Plan | Optional | `apps/<id>/wsp/inputs/terraform/*.tfstate` oder `*.tfplan`, für die Landing-Zone-Bereitschaftsprüfung (`--lzr`) |
| Landing-Zone-Ziel | Optional | `assessment.landing_zone.provider` und `.region` oder `--lz-cat-targets` |

Eine minimale App-Konfiguration:

```yaml
# apps/app-crm-01/.swao.yml
source:
  path: ./source

assessment:
  regimes_active: [GDPR, BSI_C5]
  landing_zone:
    provider: stackit
    region: eu01
```

Das vollständige Schema finden Sie unter [Workspace einrichten](/de/workspace-setup) und
[Workspace konfigurieren](/de/runbooks/workspace-config).

### Rahmenwerke auswählen

1. Jeder Rahmenwerksordner unter `<workspace>/wsp/inputs/catalogs/community/<ordner>/`
   wird automatisch erkannt und in der TUI-Auswahl der Rahmenwerke einer Bewertung
   angeboten. Eine Registrierung ist nicht nötig. Um ein Rahmenwerk hinzuzufügen,
   kopieren Sie dessen Ordner aus dem öffentlichen Verzeichnis
   [community-frameworks](https://github.com/Accenture/SWAO/tree/main/community-frameworks).
2. Die gewählten Rahmenwerke werden je App in `apps/<id>/.swao.yml` als
   `assessment.regimes_active` gespeichert, entweder über die TUI oder mit
   `swao regime-select --app <id> --regimes GDPR,BSI_C5`. Der
   [Compliance-Pass](/de/passes/11-comp) wertet genau diese Liste aus.
3. Hat eine App keine eigene `regimes_active`-Liste, verwendet der Compliance-Pass die
   Liste aus der `.swao.yml` auf Workspace-Ebene (die zum Beispiel `swao regime-select`
   ohne `--app` schreibt). Eine Liste in der App hat immer Vorrang.

---

## Was Sie erhalten

Nach einem Lauf enthält der App-Ordner:

```
apps/<id>/wsp/
+-- latest.txt                    Verweis auf den jüngsten Lauf
+-- runs/<zeitstempel>/
    +-- passes/
    |   +-- 01-inv.yaml           eine YAML-Datei je ausgeführtem Pass
    |   +-- ...
    |   +-- 11-comp.yaml          Compliance-Bewertung
    |   +-- 13-scope.yaml
    |   +-- 23-lzr.yaml           nur mit --lzr
    +-- run-manifest.json         LLM-Anbieter und Modell, Kosten, Pass-Statistik, Schemaversion
    +-- run-context.yaml
    +-- findings.yaml
    +-- lz-catalogue-fit*.yaml    nur bei integrierter Landing-Zone-Bewertung
    +-- lz-narratives.json        nur bei integrierter Landing-Zone-Bewertung
    +-- redaction-report.json     was der Redactor vor LLM-Aufrufen maskiert hat
```

Jedes Signal enthält:

- `outcome`: das Ergebnis der Prüfung
- `derivation`: die Beweiskette, aus der das Signal entstanden ist
- `evidence`: Verweise auf Datei und Zeile
- `assessor`: `rule_engine` bei deterministischen Passes, `llm` bei LLM-gestützten Passes
- `assessed_at`: Zeitstempel nach ISO 8601

Aus dem Lauf erzeugen Sie anschließend:

| Ergebnis | Befehl | Lizenzstufe |
|---|---|---|
| Text-, Markdown- und PDF-Berichte | `swao report --app <id>` (PDF: `--format pdf`) | Text und Markdown alle Stufen; PDF ab Consultant |
| Eigenständige HTML-Publikation | `swao publish --app <id>` | Ab Consultant |
| BI-Export (CSV im Sternschema, NDJSON, optional XLSX) | `swao export --app <id> --formats csv,ndjson,xlsx` | Alle Stufen für eine einzelne App |

Siehe [Bericht erstellen](/de/generate-report), [HTML publizieren](/de/publish-html) und
[BI-Export](/de/export-bi).

---

## Die Analyse-Passes

Der Standardlauf umfasst 13 Passes. Die Malware-Prüfung muss ausdrücklich angefordert
werden. Pass 00 läuft automatisch vor der Pass-Schleife, Pass 23 nur auf Anforderung.

| Nr. | Schlüssel | Pass | Art | Was er Ihnen sagt |
|---|---|---|---|---|
| 00 | `ingest` | [Ingest](/de/passes/00-ingest) | Deterministischer Vorlauf | Verteilt Dateien aus `ingestion/` nach `wsp/inputs/`, extrahiert Text aus PDF, DOCX, XLSX und PPTX, überspringt unveränderte Dateien |
| 01 | `inv` | [Inventar](/de/passes/01-inv) | Deterministisch | Sprachen, Frameworks, Abhängigkeiten und benötigte Plattformdienste |
| 02 | `state` | [Zustandsanalyse](/de/passes/02-state) | Deterministisch | Zustandsbehaftete Komponenten: Datenbanken, Sitzungen, Caches, Dateiablagen |
| 03 | `data` | [Datenklassifizierung](/de/passes/03-data) | LLM | Personenbezogene Daten, besondere Kategorien, Hinweise auf Datenresidenz |
| 04 | `ctx` | [Kontextaufnahme](/de/passes/04-ctx) | LLM | Liest CMDB-Exporte, Protokolle und Architekturdokumente aus `wsp/inputs/` |
| 05 | `sbom` | [SBOM](/de/passes/05-sbom) | Deterministisch | Software-Stückliste, Lizenzen, bekannte Schwachstellen |
| 06 | `tf` | [Twelve-Factor](/de/passes/06-tf) | Deterministisch | Cloud-Reife gemessen an den Twelve-Factor-Prinzipien |
| 07 | `egr` | [Egress](/de/passes/07-egr) | Deterministisch | Ausgehende Aufrufe und Datenübermittlungen an Dritte |
| 08 | `crypto` | [Kryptografie](/de/passes/08-crypto) | Deterministisch | Hashing, TLS, Umgang mit Schlüsseln und Geheimnissen |
| 10 | `dynamic` | [Dynamische Analyse](/de/passes/10-dynamic) | Playwright | Durchläuft die laufende Anwendung und erstellt Screenshots |
| 13 | `scope` | [Abdeckung](/de/passes/13-scope) | Deterministisch | Welche bekannten blinden Flecken Ihre Eingaben schließen, teilweise schließen oder offen lassen, mit Abdeckungsquote |
| 14 | `malware` | [Malware-Prüfung](/de/passes/14-malware) | Deterministisch, auf Anforderung | Gitleaks, OSV-Scanner, ClamAV und YARA, sofern im `PATH` installiert |
| 23 | `--lzr` | [Landing-Zone-Bereitschaft](/de/passes/23-lzr) | Deterministisch, auf Anforderung | Bereitschaftsprüfungen gegen Terraform-State- oder JSON-Plan-Dateien (`--lzr <id>`) |
| 11 | `comp` | [Compliance-Bewertung](/de/passes/11-comp) | LLM | Ordnet Signale den Kontrollen jedes aktiven Rahmenwerks zu, mit Begründung |
| 09 | `synth` | [Synthese](/de/passes/09-synth) | LLM | 7R-Empfehlung, Begründung, strategische Disposition, Portabilitäts-Score, nächste Schritte |
| 12 | `blocks` | [Block-Bewertungen](/de/passes/12-blocks) | LLM | Betriebliche Bewertungen auf Blockebene (Observability, Lizenz-Compliance und weitere) |

Die Tabelle folgt der Ausführungsreihenfolge. SWAO führt die Passes immer in dieser
festen Reihenfolge aus, unabhängig davon, wie Sie sie in `--passes` angeben. Die
Compliance-Bewertung läuft nach den statischen Passes, der dynamischen Analyse, der
Abdeckung, der Malware-Prüfung und der Landing-Zone-Bereitschaft und sieht deren
Signale. Die Synthese läuft nach der Compliance-Bewertung, sodass ihre 7R-Empfehlung
die Compliance-Lücken und das Bereitschaftsurteil desselben Laufs berücksichtigt. Die
Block-Bewertungen laufen zuletzt und können das Ergebnis der Synthese nutzen. Die
Ausführungsreihenfolge ist in der [Pass-Übersicht](/de/passes/) beschrieben.

**Ohne LLM.** Ist kein LLM-Konnektor konfiguriert, liefern die LLM-gestützten Passes
`not_applicable`, statt fehlzuschlagen; die deterministischen Passes laufen normal.
`--skip-llm` garantiert, dass der Lauf kein LLM aufruft: Er entfernt `ctx`, `comp` und
`blocks`, führt `data` und `synth` ohne LLM aus (sie schreiben eine Übersprung-Markierung
`DATA-00` beziehungsweise `SYNTH-00`) und schaltet den Vision-Schritt von Pass 10 ab.

---

## Schritt für Schritt (CLI)

1. **Workspace vorbereiten.** Legen Sie ihn mit dem Einrichtungsassistenten oder
   `swao init` an, fügen Sie die App mit ihrem Quellcode hinzu und setzen Sie
   `assessment.regimes_active` in der `.swao.yml` der App. Siehe
   [Workspace einrichten](/de/workspace-setup).
2. **Workspace prüfen.** Führen Sie `swao health-check` aus und beheben Sie gemeldete
   Punkte. Siehe [Health Check](/de/health-check).
3. **Kontext ergänzen (optional).** Kopieren Sie Dokumente nach `apps/<id>/ingestion/`.
4. **Bewertung ausführen.**

   ```bash
   swao assess --app app-crm-01
   ```

5. **Ergebnisse sichten.** Öffnen Sie `apps/app-crm-01/wsp/runs/<zeitstempel>/` oder
   erstellen Sie einen Bericht.
6. **Publizieren und exportieren.**

   ```bash
   swao report --app app-crm-01
   swao publish --app app-crm-01
   swao export --app app-crm-01 --formats csv,ndjson,xlsx
   ```

7. **Abgenommenen Lauf sperren (optional).** Ist ein Lauf mit dem Auftraggeber
   abgestimmt, hält `swao accept` ihn fest. Ein späteres `swao assess` bricht dann mit
   Exit-Code 2 ab, sofern Sie nicht `--force` angeben.

### Nützliche Varianten

```bash
# Schneller statischer Lauf: kein LLM, kein Crawl
swao assess --app app-crm-01 --skip-llm --no-crawl

# Nur ausgewählte Passes
swao assess --app app-crm-01 --passes inv,sbom,crypto

# Malware-Prüfung zum Standardumfang hinzufügen
swao assess --app app-crm-01 --passes inv,state,data,ctx,sbom,tf,egr,crypto,synth,dynamic,comp,blocks,scope,malware

# Bestimmten LLM-Gateway-Konnektor und Modell verwenden
swao assess --app app-crm-01 --llm ollama:llama3.3

# Nur das Modell überschreiben
swao assess --app app-crm-01 --model <modell-id>

# Integrierte Landing-Zone-Bewertung gegen zwei Regionen
swao assess --app app-crm-01 --lz-cat-targets "stackit:eu01,aws-esc:eusc-de-east-1"

# Landing-Zone-Bereitschaft gegen Terraform-State in wsp/inputs/terraform/
swao assess --app app-crm-01 --lzr lz-prod

# Alle Anwendungen im Workspace (Enterprise)
swao assess --portfolio
```

### Exit-Codes für Pipelines

| Code | Bedeutung |
|---|---|
| 1 | Fehler (Workspace oder App nicht gefunden, ungültige `.swao.yml`, ...) |
| 2 | Ein abgenommener Lauf existiert und `--force` wurde nicht angegeben |
| 4 | `--lzr-fail-on-blocked` gesetzt und die Landing-Zone-Bereitschaft ist blockiert |
| 5 | `--malware-fail-on-detection` gesetzt und ein MAL-01- oder MAL-03-Treffer liegt vor |
| 6 | `--fail-on <bedingung>` hat angeschlagen, zum Beispiel `--fail-on severity=critical` |

---

## Schritt für Schritt (TUI)

1. Starten Sie `swao`, wählen Sie **3 Run Assessment** und dann **[1] Application Assessment**.
2. Wählen Sie eine bestehende Anwendung oder legen Sie eine neue an. Für eine neue App
   fragt die TUI die Anwendungs-ID, die Git-Repository-URL, Branch oder Ref und das
   Unterverzeichnis ab, optional außerdem die Crawl-URL für Playwright und die
   Anmeldedaten (gespeichert im Credential-Vault).
3. Wählen Sie optional eine **Target Landing Zone**: Cloud-Anbieter auswählen, Regionen
   filtern und eine oder mehrere Zielregionen markieren. SWAO führt die
   Landing-Zone-Bewertung dann zusammen mit den Passes aus.
4. Bestätigen Sie. Eine Fortschrittsanzeige zeigt jeden abgeschlossenen Pass.
5. Nach dem Lauf geht es im Hauptmenü mit **4 Generate Report**, **5 Publish HTML** oder
   **6 Export BI** weiter.

---

## Grenzen

- Die Qualität der LLM-gestützten Passes hängt vom Modell ab. Mit der
  [LLM-Bewertung](/de/assessment/llm) vergleichen Sie Modelle an Ihrer eigenen Anwendung.
- Der dynamische Crawl benötigt Chromium und `playwright-core`; im Binary führen Sie
  zuvor `swao install-playwright` aus. Fehlen sie, überspringt Pass 10 den Live-Crawl.
- Die Malware-Prüfung nutzt nur Werkzeuge, die im `PATH` installiert sind.
- `--lzr` leitet den Zielanbieter aus der Landing-Zone-ID, dem konfigurierten Anbieter
  oder den Terraform-Ressourcen ab, anbieterspezifische Bereitschaftsprüfungen gibt es
  aber nur für STACKIT; andere Anbieter werden nur mit den generischen Prüfungen bewertet
  (siehe [Pass 23](/de/passes/23-lzr) und die [Landing-Zone-Seite](/de/assessment/landing-zone#landing-zone-bereitschaft-aus-terraform-lzr)).
- Die Bewertung berücksichtigt nur, was Sie bereitstellen. Pass 13 zeigt, welche blinden
  Flecken offen bleiben, damit Sie entscheiden können, welche Eingaben Sie ergänzen.

---

## Live-Beispielbericht

Eine Publikation der Anwendungsbewertung für den Demo-Workspace Sovereign Health:

[Live-Bericht öffnen](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-23T17-29-27-sovereign-health.html)

Er zeigt DSGVO- und BSI-C5-Befunde, das Risikoregister und die 7R-Migrationsstrategie
für eine fiktive Patientenverwaltung.

---

## Weiterführende Seiten

- [Überblick über die Bewertungstypen](/de/assessment/) und die [Pass-Referenz](/de/passes/)
- [Landing-Zone-Katalogbewertung](/de/assessment/landing-zone)
- [LLM-Bewertung für SWAO](/de/assessment/llm)
- [Service-Portfolio-Bewertung](/de/service-assessment/) für Anwendungen ohne Quellcode
- [CLI-Referenz](/de/runbooks/cli-reference) und [LLM-Gateway-Konnektoren erstellen](/de/runbooks/llm-gateway-authoring)
