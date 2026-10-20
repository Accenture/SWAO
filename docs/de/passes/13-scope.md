# Pass 13: Abdeckung des Prüfumfangs (SCOPE)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 13 |
| Schlüssel (`--passes`) | `scope` |
| Signal-Präfix | `SCOPE` |
| Typ | Deterministisch (Regel-Engine, kein LLM, kein Netzwerk) |
| Standard | Aktiv (Teil der Standardliste von `--passes`) |
| Assessment-Typen | `application`, `service` (im Service-Profil immer aktiv) |
| Tier | Alle Tiers (keine Lizenzsperre) |
| Quelle | `packages/@swao/module-app-assessment/src/passes/pass-13-scope.ts`, Katalog `controls/blind-spots-catalogue.yaml` |

## Wofür dieser Pass gedacht ist

Jedes Assessment hat blinde Flecken: Bereiche, die sich allein aus dem Quellcode nicht beurteilen lassen, etwa Netzwerkrichtlinien, SIEM-Regeln oder Auftragsverarbeitungsverträge. Pass 13 beantwortet die Frage: „Welche dieser bekannten blinden Flecken sind durch die bereitgestellten Nachweise abgedeckt, und welche bleiben außerhalb des Prüfumfangs?“

Er macht die Grenzen des Assessments sichtbar, sodass Leser des Berichts erkennen, was geprüft wurde und wofür noch Eingaben fehlen. Außerdem nennt er genau den Ordner, der zum Schließen jeder Lücke befüllt werden muss.

## Was Sie bereitstellen müssen

Nichts ist zwingend. Um blinde Flecken zu schließen, legen Sie Nachweisdateien in den unten genannten Ordnern unter `wsp/inputs/` der App ab. Ein Pfad gilt als bereitgestellt, wenn er eine nicht leere Datei ist oder ein Ordner mit mindestens einer nicht leeren Datei oder einem Unterordner (versteckte Einträge, die mit `.` beginnen, werden ignoriert). Leere Dateien und leere Ordner zählen nicht; ein versehentlich angelegter Ordner schließt also keine Lücke.

## So funktioniert der Pass

1. Den Katalog der blinden Flecken laden (`controls/blind-spots-catalogue.yaml`, Version 1.0.0, 10 Einträge).
2. Für jeden Eintrag die Eingabepfade relativ zu `apps/<app>/` prüfen.
3. Die Abdeckung bestimmen:
   - **closed**, wenn ein Eingabepfad bereitgestellt ist oder der Katalog angibt, dass SWAO den Bereich vollständig abdeckt;
   - **partial**, wenn keine Eingabe vorliegt und der Katalog angibt, dass SWAO einen Teil nativ abdeckt;
   - **open** in allen anderen Fällen.
4. Je Eintrag ein Signal `SCOPE-NN` sowie einen Block `scope_coverage` mit Summen und einer Abdeckungsquote ausgeben.

## Wie gemessen wird

### Der Katalog der blinden Flecken

| # | Katalog-ID | Blinder Fleck | Standard-Schweregrad | Native Abdeckung | Eingabepfade, die ihn schließen | Zugehörige Frameworks |
|---|---|---|---|---|---|---|
| 1 | `BS_NETWORK_POLICY` | Netzwerkrichtlinien für Kubernetes / Service Mesh | high | none | `wsp/inputs/network-policies`, `wsp/inputs/platform` | BSI_C5, ISO_27001, SOC_2 |
| 2 | `BS_RUNTIME_SECRETS` | Injektion von Secrets zur Laufzeit | high | partial | `wsp/inputs/secrets-strategy.md`, `wsp/inputs/secrets` | GDPR, HIPAA, PCI_DSS, BSI_C5 |
| 3 | `BS_CLOUD_FIREWALL` | Firewall und Security Groups des Cloud-Providers | high | partial | `wsp/inputs/terraform` | BSI_C5, ISO_27001, SOC_2, DORA |
| 4 | `BS_SERVICE_MESH_MTLS` | Durchsetzung von mTLS im Service Mesh | medium | none | `wsp/inputs/service-mesh`, `wsp/inputs/pen-test` | GDPR, HIPAA, BSI_C5 |
| 5 | `BS_SIEM_DETECTION` | Erkennungsregeln in SIEM / EDR | medium | none | `wsp/inputs/soc-runbook.md`, `wsp/inputs/soc` | ISO_27001, SOC_2, DORA, BSI_C5 |
| 6 | `BS_WAF_API_GATEWAY` | Controls in WAF / API-Gateway | medium | none | `wsp/inputs/edge-controls.md`, `wsp/inputs/waf`, `wsp/inputs/api-gateway` | PCI_DSS, GDPR |
| 7 | `BS_CLOUD_IAM` | Cloud-IAM über IaC-Stubs hinaus | high | partial | `wsp/inputs/iam` | ISO_27001, SOC_2, BSI_C5 |
| 8 | `BS_OPERATIONAL_RUNBOOK` | Betriebs-Runbooks und manuelle Controls | medium | none | `wsp/inputs/runbooks`, `wsp/inputs/policies`, `wsp/inputs/ops` | SOC_2, ISO_27001, DORA |
| 9 | `BS_GRANTED_EXCEPTIONS` | Dokumentierte Sicherheitsausnahmen | low | none | `wsp/inputs/exception-register.csv`, `wsp/inputs/exceptions` | all |
| 10 | `BS_DATA_PROCESSING_AGREEMENTS` | Unterauftragsverarbeiter und Auftragsverarbeitungsverträge | high | none | `wsp/inputs/data-processing-agreements`, `wsp/inputs/legal` | GDPR, BSI_C5 |

### Signale

`SCOPE-01` bis `SCOPE-10` folgen der Reihenfolge des Katalogs oben. Der Bezug zum Katalogeintrag steht im Feld `implies` des Signals als `blind_spot_<coverage>:<Katalog-ID>`.

| Abdeckung | Schweregrad | Ergebnis | Nachweis |
|---|---|---|---|
| closed | positive | positive | Der Eingabepfad, der den blinden Fleck geschlossen hat |
| partial | medium | indeterminate | - |
| open | Der Standard-Schweregrad des Eintrags (high, medium oder low) | indeterminate | - |

Einträge der Kategorien `process`, `governance` und `contractual` werden unter der Signalkategorie `business_processes` geführt, alle anderen unter `infrastructure_platform`.

Kann der Katalog nicht geladen werden, gibt der Pass ein einzelnes informatives Signal `SCOPE-99` und einen leeren Abdeckungsblock aus.

### Abdeckungsquote

```text
coverage_ratio = (closed + 0.5 x partial) / total
```

Die Quote wird auf vier Nachkommastellen gerundet und ist 0, wenn der Katalog leer ist. Ganz ohne Eingaben sind drei Einträge partial und sieben open; das ergibt eine Quote von 0.15.

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Katalog der blinden Flecken | Definiert die 10 blinden Flecken | SWAO | Gebündelt | Signal `SCOPE-99`, leerer Abdeckungsblock |
| `js-yaml`, `zod` | Katalog lesen und validieren | MIT | Gebündelt | - |

Es werden keine externen Werkzeuge oder Netzwerkdienste verwendet.

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/13-scope.yaml` | Pass-Kopf, Signale `SCOPE-NN` und `assessment.scope_coverage` |
| `wsp-plan.yaml` (über die Plan-Ableitung) | `scope_coverage` als Block auf oberster Ebene für die Prüfersicht und den Health-Check |

Bei Service-Assessments schreibt SWAO zusätzlich `scope-coverage.json` in das Laufverzeichnis. Die Datei listet, welche Passes liefen, welche übersprungen wurden und warum.

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| `--passes` ohne `scope` | Überspringt den Pass |
| Dateien in den oben genannten Eingabepfaden | Schließen die jeweiligen blinden Flecken |

Bekannte Einschränkungen:

- Der Pass prüft nur, ob Nachweise vorhanden sind, nicht ihren Inhalt. Eine einzeilige Datei schließt einen blinden Fleck genauso wie ein vollständiges Dokument. Den Inhalt bewerten Pass 04 CTX und Pass 11 COMP.
- Der Katalog ist in diesem Build fest vorgegeben und kann nicht je Workspace erweitert werden.
- In einem Lens- oder Pass-Profil wählt die Kurzform `lzr` diesen Pass nicht aus; sie bezeichnet [Pass 23 LZR](/de/passes/23-lzr), der nur mit `--lzr <landingZoneId>` läuft.

Siehe auch [Workspace-Einrichtung](/de/workspace-setup) und [Health-Check](/de/health-check).
