# Pass 04: Kontextaufnahme (CTX)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 04 |
| Schlüssel | `ctx` |
| Pass-Name in der Ausgabe | `context_ingestion` |
| Signal-Präfix | `CTX` |
| Typ | LLM-gestützt |
| Standard | Aktiv (wird durch `--skip-llm` entfernt) |
| Assessment-Typen | `application`; `service` (läuft immer; im Service-Modus die wichtigste Signalquelle); `llm` (innerhalb jedes Legs, Vergleich über Modelle). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Der Quellcode zeigt, wie eine Anwendung gebaut ist, aber nicht, warum, wer sie betreibt, was das Fachgebiet von ihr erwartet oder welche Rahmenbedingungen in Workshops vereinbart wurden. Pass 04 beantwortet die Frage: **„Was sagen die Projektunterlagen über diesen Workload, und wo widersprechen sie einander oder dem Code?“**

Er liest alles, was Sie unter `wsp/inputs/` abgelegt haben (Architekturdokumente, Workshop-Protokolle, Compliance-Anforderungen, CMDB- und Incident-Exporte, Runbooks, Terraform-State als JSON, Research-Stubs), und macht daraus Signale. Außerdem zeigt er Datenlücken und Widersprüche auf, etwa eine Workshop-Notiz, die reines EU-Hosting behauptet, während ein CMDB-Export eine US-Region aufführt.

## Was Sie bereitstellen müssen

- Textkontext in `wsp/inputs/`. Am einfachsten legen Sie Dateien in `<app>/ingestion/` ab und lassen [Pass 00](/de/passes/00-ingest) sie zuordnen und extrahieren. Für diesen Pass zulässige Dateitypen: `.md`, `.txt`, `.yaml`, `.yml`, `.json`, `.csv` (Pass 00 erzeugt `.txt`-, `.md`- und `.csv`-Begleitdateien für PDF-, Word-, PowerPoint- und Excel-Dateien).
- Einen konfigurierten LLM-Provider (`providers.llm.primary`, `--llm <connector[:model]>` oder `SWAO_LLM_PROVIDER`).
- Optional: Budget- und Kategorie-Einstellungen in der App-`.swao.yml` (siehe Konfiguration).

Ersetzen Sie Beispiel- oder Vorlagentexte vor einem Assessment: Dateien mit Platzhaltertext erzeugen eine Warnung, weil das Modell sonst Findings auf Basis erfundener Daten melden könnte.

## Wie der Pass arbeitet

1. **Dateien sammeln.** Der Pass durchläuft `wsp/inputs/` und überspringt drei Ordner der obersten Ebene: `source/` (die geklonte Anwendung, die von den statischen Passes analysiert wird), `catalogs/` und `llm-gateway/`. Außerdem überspringt er CycloneDX-Exporte (`*.cdx.json`), aus Excel exportierte SBOM-Arbeitsblätter (`*sbom*.xlsx.*.csv`, `*bom*.xlsx.*.csv`), `package-lock.json` und `pnpm-lock.yaml`, da sie Budget verbrauchen, ohne Architekturkontext beizutragen.
2. **In Abschnitte teilen.** Jede Datei wird in Abschnitte zu 3.000 Zeichen zerlegt und mit `[part n/m]` gekennzeichnet.
3. **Nach Ordner klassifizieren.** Der erste Ordner unterhalb von `wsp/inputs/` bestimmt die Kategorie:

   | Ordner | Kategorie | Standardgewicht in Pass 04 |
   |---|---|---|
   | `architecture/`, `design/`, `adr/` | architecture | 1.0 |
   | `compliance/` | compliance | 1.0 |
   | `intake/`, `discovery/`, `kickoff/` | intake | 1.0 |
   | `workshops/`, `workshop/` | workshops | 0.9 |
   | jeder andere Ordner oder Dateien in der obersten Ebene | docs | 0.8 |
   | `terraform/`, `infra/` | terraform | 0.7 |
   | `operations/`, `ops/` | operations | 0.7 |
   | `structured/`, `data/`, `exports/` | structured | 0.6 |

   **Infrastrukturrollen: Ist vs. Ziel.** Infrastrukturdateien erhalten zusätzlich eine Rolle, die im Abschnittslabel erscheint (`--- [TARGET-LZ] terraform/lz-aws-snapshot.json ---`, `--- [CURRENT-INFRA] terraform/prod-state.json ---`). CURRENT ist die Plattform, auf der die Anwendung heute läuft; TARGET ist eine mögliche Ziel-Landing-Zone. Die Rolle wird in dieser Reihenfolge bestimmt:

   1. `context.infra_roles` in der App-`.swao.yml` (siehe Konfiguration); der erste passende Eintrag gilt.
   2. Ordner: Dateien unter `wsp/inputs/infra/current/` sind Ist-Infrastruktur, Dateien unter `wsp/inputs/infra/target/` Ziel-Infrastruktur.
   3. Dateiname: `lz-*-snapshot.json` (die Landing-Zone-Snapshots, die der LZ-Fit liest) ist Ziel; `*.tfstate` und jede andere Datei unter `terraform/` oder `pulumi/` ist Ist.
   4. Alle anderen Dateien (Dokumente, CSV-Exporte) haben keine Infrastrukturrolle.

   Lassen Sie `lz-<provider>-snapshot.json` in `wsp/inputs/terraform/`: Der Landing-Zone-Fit liest die Datei dort. Die `infra/`-Ordner sind für weitere Exporte gedacht, deren Rolle Sie ausdrücklich festlegen wollen.

4. **Prompt-Budget füllen.** Die Abschnitte werden nach Gewicht (höchstes zuerst), dann nach Größe (kleinste zuerst, damit mehr unterschiedliche Dateien hineinpassen) und dann nach Pfad sortiert. Sie werden hinzugefügt, bis das Zeichenbudget ausgeschöpft ist. Ein Gewicht von 0 schließt eine Kategorie vollständig aus. Ausgeschlossene Abschnitte werden in einer Konsolenwarnung gemeldet, die die erste ausgeschlossene Datei nennt und erklärt, wie Sie das Budget erhöhen.
5. **Platzhalter prüfen.** Dateien, die `Sample / placeholder`, `replace-with-` oder `Replace before the assessment` enthalten, werden gemeldet und in `placeholder_inputs` aufgeführt.
6. **LLM aufrufen.** Der Prompt bittet das Modell, alle Eingaben aufzunehmen, Widersprüche zwischen Dokumenten und Code-Evidenz zu erkennen, Datenlücken zu benennen und Signale mit den IDs `CTX-NN` sowie `context_inputs_found`, `contradictions_detected` und optional `context_overrides` zurückzugeben. Sind Infrastrukturdateien vorhanden, ergänzt der Prompt, dass Widersprüche nur gegenüber der Ist-Infrastruktur (CURRENT) gemeldet werden und dass eine Fähigkeit, die die Dokumentation verlangt, eine Ziel-Landing-Zone (TARGET) aber nicht bietet, eine Lücke der Zielplattform ist. In den Treibern für Anthropic, OpenAI, Amazon Bedrock und OpenAI-kompatible Endpunkte durchläuft der Prompt den SWAO-Redactor vor dem LLM-Aufruf.
7. **Evidenz prüfen.** Jeder vom Modell zurückgegebene Evidenzverweis wird gegen `wsp/inputs/` aufgelöst:
   - Ein Verweis, der den Workspace verlässt, wird mit `false_positive_flag` markiert (Schutz vor Path Traversal).
   - Eine vorhandene, aber durch das Budget abgeschnittene Datei wird unter `context_gaps` vermerkt, statt als falsch zu gelten.
   - Eine nicht vorhandene Datei wird mit `false_positive_flag` und einer Notiz markiert.
   - Aussagen über Abwesenheit („no ...“, „missing ...“) werden als Beobachtung ohne Dateiprüfung akzeptiert.
8. **Ziellücken von Widersprüchen trennen.** Ein Signal, dessen Evidenz eine TARGET-Datei und keine CURRENT-Datei zitiert, ist eine Lücke der Zielplattform, unabhängig davon, wie das Modell es genannt hat: SWAO ergänzt `gap_type:target_capability` in der Liste `implies`, begrenzt den Schweregrad auf `medium` und beginnt die Herleitung mit „Target platform gap“. Beispiel: Die Dokumentation verlangt MariaDB, und nur der Ziel-Snapshot zeigt PostgreSQL; das ist eine Lücke des Ziels, kein Widerspruch. Dieselbe Abweichung gegenüber einer Ist-State-Datei bleibt ein Widerspruch.

## Wie gemessen wird

Signal-IDs (`CTX-01`, `CTX-02` usw.), Schweregrade und Outcomes wählt das Modell im Rahmen des SWAO-Signalschemas; eine feste Signalliste gibt es nicht. SWAO ergänzt oder prüft Folgendes:

| Element | Bedeutung |
|---|---|
| `false_positive_flag`, `false_positive_note` an einem Signal | Die zitierte Evidenz wurde nicht gefunden oder zeigt aus dem Workspace hinaus; das Signal mit Vorsicht behandeln |
| `context_gaps` an einem Signal | Die zitierte Datei existiert, war aber wegen des Budgets nicht im Prompt |
| `assessment.context_inputs_found` | Anzahl der gefundenen unterschiedlichen Eingabedateien (vor der Budgetauswahl) |
| `assessment.chunks_included`, `chunks_excluded` | Wie viel des Materials das Modell erreicht hat |
| `assessment.files_excluded_by_pattern` | Übersprungene SBOM-Exporte und Lock-Dateien |
| `assessment.placeholder_inputs` | Dateien, die noch Vorlagentext enthalten |
| `assessment.contradictions_detected`, `context_overrides` | Wie vom Modell gemeldet |
| `implies: gap_type:target_capability` an einem Signal | Lücke der Zielplattform: Der Ziel-Landing-Zone fehlt etwas, das die Dokumentation verlangt |
| `assessment.infra_inputs` | Gelesene Infrastrukturdateien, gruppiert nach `current` und `target` |
| `assessment.target_capability_gaps` | Anzahl der Ziellücken-Signale (von SWAO berechnet) |

Sonderfälle:

| Situation | Ergebnis |
|---|---|
| Kein LLM konfiguriert | Ein Signal `CTX-00` (informational, Outcome `indeterminate`); Status `not_applicable` |
| Keine Eingabedateien | Das Modell soll ein CTX-Signal zur eingeschränkten Kontextabdeckung erzeugen |
| Antwort ist kein gültiges JSON (etwa am Ausgabe-Token-Limit abgeschnitten) | Wird als Fehler protokolliert (mit Hinweis auf Abschneiden, wenn die Antwort lang und nicht abgeschlossen ist); der Pass liefert ein Signal `CTX-00` mit Status `not_applicable` und `skipped_reason: invalid_llm_response`, und `invalid_response_detail` gibt an, ob die Antwort am Token-Limit abgeschnitten wurde oder kein gültiges JSON ist. Der Lauf geht weiter. |
| LLM nach allen Wiederholungen nicht erreichbar | Status `not_applicable`, keine Signale; ein konfigurierter sekundärer Connector wird vorher versucht |

**Wie die Ergebnisse in spätere Passes einfließen.** CTX-Signale sind Evidenz für Pass 11 (COMP) und Pass 12 (BLOCKS) sowie für [Pass 09 (SYNTH)](/de/passes/09-synth), dessen Portabilitätsschätzung für CTX-Signale mit Hinweis auf Vendor-Lock-in ausdrücklich Abzüge vorsieht. In einem [Service Portfolio Assessment](/de/service-assessment/) ohne Quellcode ist CTX die wichtigste Signalquelle.

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| js-yaml | Lesen von `context.allocations`, `context.categories` und `context.infra_roles` | MIT | Gebündelt | Entfällt |
| LLM-Provider oder LLM-Gateway-Connector | Kontextanalyse | Externer Dienst; Lizenz im Repository nicht erfasst | Extern, von Ihnen konfiguriert | Skip-Signal `CTX-00` |

Die Textextraktion aus PDF- und Office-Dateien erfolgt vorher in [Pass 00](/de/passes/00-ingest).

## Ausgaben

- `wsp/runs/<ts>/passes/04-ctx.yaml`: Kopf (`id: 4`, `name: context_ingestion`), Signale, `assessment`, `data_source`.
- `wsp/runs/<ts>/llm-traces/04-ctx-call-1.json`: geschwärzter Prompt (mit Zeichenzahl, geschätzter Tokenzahl und Anzahl der Schwärzungsmarker) und Rohantwort.
- Zwischengespeicherte Antworten unter `wsp/cache/llm/<model>/` (bis zu 30 Tage; mit `--no-cache` umgehen).

## Konfiguration und Einschränkungen

**Prompt-Budget.** Das Zeichenbudget für die Kontextabschnitte wird in dieser Reihenfolge bestimmt:

1. `context.allocations.ctx` in der App-`.swao.yml`
2. Andernfalls ein für den Lauf berechnetes Budget: die Umgebungsvariable `SWAO_CTX_PROMPT_MAX_CHARS`, falls gesetzt; sonst abgeleitet aus dem Kontextfenster des aktiven Connectors (Fenster in Tokens mal 4 Zeichen, abzüglich Reserven für System-Prompt und Ausgabe, mindestens 10.000 Zeichen); sonst 110.000 Zeichen
3. Der Pass begrenzt jeden Wert auf 110.000 Zeichen.

```yaml
context:
  allocations:
    ctx: 80000          # Zeichen für Pass 04
  categories:
    terraform: 0.5      # Faktor auf das Standardgewicht (Ergebnis auf 0.0..1.0 begrenzt)
    structured: 0       # CSV- und JSON-Exporte aus dem Prompt ausschließen
  infra_roles:          # optional; Pfad relativ zu wsp/inputs/ (Datei, Ordner oder Glob mit * und **)
    - path: terraform/ocp-export.json
      role: current     # current | target
    - path: terraform/candidate-*.json
      role: target
```

`infra_roles` gilt auch für [Pass 01](/de/passes/01-inv): Eine als `target` deklarierte State-Datei erzeugt kein `service_dep`-Signal und fließt nur in die Landing-Zone-Readiness ein.

**Weitere Einstellungen**

- `SWAO_TOKEN_CEILING` (Standard 8192): Liegt der Wert unter 8.000, protokolliert SWAO eine Warnung, dass die CTX-Antwort abgeschnitten werden kann.
- `--skip-llm` entfernt `ctx` (zusammen mit `comp` und `blocks`) aus dem Lauf.
- `--no-cache`, `--llm`, `--model` wie bei den anderen LLM-Passes.

**Einschränkungen und bekannte Lücken**

- Es werden nur die sechs oben genannten Textendungen gelesen; Bilder und Binärdateien tragen nichts bei, es sei denn, Pass 00 hat Text daraus extrahiert oder Sie ergänzen eine `.description.txt`.
- Umfangreiche Eingaben können das Budget überschreiten; prüfen Sie die Konsolenwarnung und `chunks_excluded`.
