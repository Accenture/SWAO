# Pass 11: Compliance-Bewertung (COMP)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 11 |
| Schlüssel (`--passes`) | `comp` |
| Signal-Präfix | `COMP` |
| Typ | LLM-gestützt (ohne LLM wird jedes Control auf `UNKNOWN` gesetzt) |
| Standard | Aktiv (Teil der Standardliste von `--passes`) |
| Assessment-Typen | `application`, `service` (im Service-Profil immer aktiv) |
| Tier | Alle Tiers (keine Lizenzsperre) |
| Quelle | `packages/@swao/module-framework/src/compliance-evaluator.ts` |

## Wofür dieser Pass gedacht ist

Pass 11 beantwortet die Frage: „Welche Controls der ausgewählten Compliance-Frameworks erfüllt dieser Workload, welche teilweise, welche nicht, und welche Nachweise gibt es dafür?“

Er nimmt alle Signale der vorangegangenen Passes desselben Laufs und lässt ein LLM in der Rolle eines Prüfers jedes Control jedes aktiven Frameworks bewerten. Das Ergebnis ist ein Urteil pro Control mit Begründung, den stützenden Signal-IDs und bei Lücken einem Satz zur Behebung. Die Urteile fließen in den Compliance-Teil des Berichts, in `wsp-plan.yaml` und in den BI-Export ein.

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Aktive Frameworks | `assessment.regimes_active` in der `.swao.yml` der App oder, wenn die App keine Liste hat, in der `.swao.yml` des Workspace | Ohne Liste endet der Pass mit dem Status `not_applicable` |
| Framework-Kataloge | `wsp/inputs/catalogs/` auf Workspace-Ebene (Standard- und Community-Kataloge) | Installiert durch `swao init` und `swao framework install <id>` |
| Ein LLM-Provider | `providers.llm` in `.swao.yml`, `--llm` oder `--model` | Ohne LLM ist jedes Control `UNKNOWN` |
| Signale vorangegangener Passes | Werden im selben Lauf automatisch geschrieben | Je mehr Passes laufen, desto besser die Nachweislage |
| Für das Framework `LLM_SELECTION` | Provider-Dokumente (Model Card, AVV, Konformitätsbewertung) in `apps/<app>/context/` | Andernfalls fügt SWAO ein informatives Warnsignal hinzu |

```yaml
# apps/app-crm-01/.swao.yml
assessment:
  regimes_active: [DORA, NIS2, GDPR]
```

Die verfügbaren Framework-IDs finden Sie unter [Frameworks](/de/frameworks/).

## So funktioniert der Pass

1. **Signale sammeln.** Der Pass liest alle bereits im aktuellen Laufverzeichnis geschriebenen Pass-Dateien `*.yaml` (ohne seine eigene Datei `11-*`) und sammelt alle Signale. Zusätzlich liest er die Signaldateien der App `wsp/signals/research-signals.json` ([Pass 24 RESEARCH](/de/passes/24-research)) und `wsp/signals/binary-signals.json` ([Pass 25 BINARY](/de/passes/25-binary)), sofern vorhanden.
2. **Aktive Frameworks lesen.** Er liest `assessment.regimes_active` aus der `.swao.yml` der App. Hat die App keine Liste, verwendet er die Liste aus der `.swao.yml` des Workspace. Sind beide leer, endet der Pass mit dem Status `not_applicable` und `skipped_reason: No regimes configured in .swao.yml`.
3. **Kataloge laden.** Für jede Framework-ID löst er den Katalog über die Regime-Registry in `wsp/inputs/catalogs/` auf. Fehlt ein Katalog, entsteht ein `COMP-NN`-Signal mit Schweregrad medium, das die Installation erklärt; das Framework wird übersprungen.
4. **Controls bündeln.** Die Controls werden in Paketen zu 20 gesendet. Jeder Prompt enthält Name und Version des Frameworks, die Definitionen der Ergebnisse, eine Zusammenfassung aller Signale (ID, Schweregrad und die ersten 280 Zeichen der Herleitung) sowie das Paket der Controls (ID, Titel, Beschreibung bis 400 Zeichen, Standard-Schweregrad).
5. **Antwort validieren.** Das LLM muss ausschließlich JSON liefern. Die Antwort wird geparst und gegen ein strenges Schema geprüft. Controls, die in der Antwort fehlen, oder ein Paket, dessen Antwort nicht auswertbar ist, fallen auf `UNKNOWN` zurück.
6. **Erfundene Verweise entfernen.** Jede zitierte Signal-ID, die im Lauf nicht existiert, wird verworfen und eine Warnung ausgegeben. Die `evidence_ids` eines Controls werden aus den Nachweisen der zitierten Signale übernommen; wird bei `SATISFIED`, `PARTIAL` oder `GAP` nichts zitiert, wird `llm-inference` als Nachweis eingetragen.
7. **Zusammenfassen.** Pro Framework wird ein zusammenfassendes Signal `COMP-NN` ausgegeben.

## Wie gemessen wird

### Ergebnisse je Control

| Ergebnis | Regel für den Prüfer |
|---|---|
| `SATISFIED` <span class="swao-badge pass">PASS</span> | Die Signale bestätigen positiv, dass das Control erfüllt ist |
| `PARTIAL` <span class="swao-badge partial">PARTIAL</span> | Einige Elemente sind vorhanden, es bleiben Lücken; ein Satz zur Behebung ist Pflicht |
| `GAP` <span class="swao-badge fail">FAIL</span> | Die Signale zeigen, dass das Control nicht erfüllt ist; ein Satz zur Behebung ist Pflicht |
| `N_A` | Das Control ist für diesen Workload nicht anwendbar (mit Begründung) |
| `UNKNOWN` | Kein Signal betrifft das Control, oder es gab keine LLM-Bewertung |

Das LLM wird angewiesen, nur auf Grundlage der Signalliste zu entscheiden und keine Fakten zu erfinden. Jedes bewertete Control enthält `outcome`, `rationale`, `signal_refs`, `evidence_ids`, `remediation`, `severity` (der `severity_default` des Katalogs, Standard medium), `assessor` (`llm` bzw. `rule_engine` bei Rückfällen) und `assessed_at`.

### Status je Framework

| Status | Bedingung |
|---|---|
| `evaluated` | Ein LLM war verfügbar und mindestens ein Control ist `SATISFIED`, `PARTIAL` oder `GAP` |
| `insufficient_evidence` | Ein LLM war verfügbar, aber alle Controls endeten mit `UNKNOWN` oder `N_A` |
| `pending-llm` | Kein LLM konfiguriert |

### Zusammenfassende Signale

| Signal | Bedeutung | Schweregrad |
|---|---|---|
| `COMP-NN` je Framework | Anzahl `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` und `N/A` von allen Controls | high bei mindestens einem `GAP`; medium bei mindestens einem `PARTIAL`; sonst informational |
| `COMP-NN` fehlender Katalog | Ein Framework ist eingetragen, sein Katalog aber nicht installiert | medium |
| `COMP-NN` Kontext für LLM-Auswahl | `LLM_SELECTION` ist aktiv, aber `apps/<app>/context/` ist leer | informational |

`NN` ist eine laufende Nummer in der Reihenfolge, in der die Frameworks verarbeitet werden. Dasselbe Framework kann in einem anderen Lauf also eine andere Nummer tragen.

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Konfigurierter LLM-Provider (Cloud oder lokal, zum Beispiel Ollama) | Bewertet die Controls | Abhängig vom Provider | Optional, für aussagekräftige Ergebnisse aber nötig | Jedes Control `UNKNOWN`, Framework-Status `pending-llm` |
| Framework-Kataloge (Community-Frameworks) | Definitionen der Controls | Siehe jeweilige Framework-Seite | Gebündelt und in den Workspace installiert | `COMP`-Signal mit medium; Framework übersprungen |
| `js-yaml`, `zod` | Kataloge lesen und LLM-Ausgabe validieren | MIT | Gebündelt | - |

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/11-comp.yaml` | Pass-Kopf, zusammenfassende Signale und `assessment.regimes[]` mit allen bewerteten Controls |
| `apps/<app>/wsp/runs/<ts>/llm-traces/11-comp-call-1.json` | Der erste Prompt (nach der Schwärzung) und die Antwort, zur Prüfung |
| `wsp-plan.yaml` (über die Plan-Ableitung) | `compliance.regimes[]` aus der Pass-Ausgabe; lief Pass 11 nicht, ein Ersatzblock mit allen Controls auf `UNKNOWN` und `assessor: auto-derived` |

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| `assessment.regimes_active` | Zu bewertende Frameworks (je App) |
| `--passes` ohne `comp` | Überspringt den Pass |
| `--skip-llm` (Alias `--no-llm`) | Entfernt `ctx`, `comp` und `blocks` aus dem Lauf |
| `--llm <connector[:model]>`, `--model <id>` | Wählt das LLM für diesen Lauf |
| `--no-cache` | Erzwingt neue LLM-Aufrufe statt zwischengespeicherter Antworten |
| `--fail-on severity=high` | Beendet mit Exit-Code 6, wenn ein Signal, auch eine `COMP`-Zusammenfassung, zutrifft |

Bekannte Einschränkungen:

- Pass 11 läuft in der Reihenfolge `... dynamic, scope, malware, lzr, comp, synth, blocks`. Er sieht die Signale von Pass 10 DYNAMIC, Pass 13 SCOPE, Pass 14 MALWARE und Pass 23 LZR aus demselben Lauf, nicht aber die von Pass 09 SYNTH, der nach ihm läuft.
- Das Urteil ist eine LLM-Einschätzung auf Basis von Signal-Zusammenfassungen, kein formales Audit. Jede Signal-Herleitung wird im Prompt auf 280 Zeichen gekürzt.
- Pass 11 liest ausschließlich `assessment.regimes_active`. Die Plan-Ableitung akzeptiert zusätzlich eine veraltete Liste `regimes:` auf oberster Ebene, die Pass 11 ignoriert.
- Große Frameworks benötigen einen LLM-Aufruf je 20 Controls, was Laufzeit und Kosten beeinflusst.

Siehe auch [Pass 12: Block-Assessments](/de/passes/12-blocks) und [Katalog der Assessment-Dimensionen](/de/assessment-dimension-catalogue).
