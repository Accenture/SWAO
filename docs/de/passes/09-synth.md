# Pass 09: Migrationssynthese (SYNTH)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 09 |
| Schlüssel | `synth` |
| Pass-Name in der Ausgabe | `synthesis` |
| Signal-Präfix | `SYNTH` |
| Typ | LLM-gestützt, mit deterministischem Landing-Zone-Abgleich und deterministischen Bewertungsanpassungen |
| Standard | Aktiv (wird durch `--skip-llm` nicht entfernt) |
| Assessment-Typen | `application`; `service` (läuft immer und fasst die im Service-Modus erzeugten Signale zusammen); `llm` (innerhalb jedes Legs, Vergleich über Modelle). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Die vorangehenden Passes liefern viele Einzelbeobachtungen. Pass 09 beantwortet die Frage, die ein Lenkungsausschuss stellt: **„Was sollen wir also mit dieser Anwendung tun?“**

Er führt alle Signale des Laufs zu einem 7R-Migrationsurteil zusammen (Retire, Retain, Rehost, Replatform, Repurchase, Refactor, Re-architect), mit Begründung, strategischer Modernisierungsposition, Portabilitätswert, den wichtigsten Hindernissen und Treibern, empfohlenen nächsten Schritten und einer empfohlenen souveränen Landing Zone aus dem Cloud-Provider-Katalog von SWAO.

## Was Sie bereitstellen müssen

- Einen konfigurierten LLM-Provider (`providers.llm.primary`, `--llm <connector[:model]>` oder `SWAO_LLM_PROVIDER`). Ohne Provider wird der Pass übersprungen.
- Die übrigen Passes desselben Laufs. Pass 09 hat keine eigenen Eingaben; je mehr Passes gelaufen sind, desto fundierter ist das Urteil.
- Optional: ein Ergebnis von Pass 23 (LZR) aus demselben Lauf, das entsteht, wenn Sie `--lzr <landingZoneId>` angeben.

## Wie der Pass arbeitet

1. **Position in der Ausführung.** Obwohl er die Nummer 09 trägt, läuft der Pass spät in der kanonischen Reihenfolge: `inv, state, data, ctx, sbom, tf, egr, crypto, dynamic, scope, malware, lzr, comp, synth, blocks`. Er sieht daher auch die Signale von Pass 10 (DYNAMIC), Pass 13 (SCOPE), Pass 14 (MALWARE, wenn angefordert), Pass 23 (LZR, mit `--lzr`) und die Zusammenfassungssignale je Framework aus Pass 11 (COMP). Pass 12 (BLOCKS) läuft nach diesem Pass und liest dessen Ergebnis; Block-Urteile fließen daher nicht in die Synthese ein.
2. **Bisherige Signale laden.** Jede `.yaml`-Datei im Ordner `passes/` des aktuellen Laufs außer der eigenen wird gelesen, und alle Signale werden gesammelt.
3. **Abdeckungswert.** `coverage_score` = 1 minus Anteil der bisherigen Signale mit niedriger Konfidenz, auf zwei Nachkommastellen gerundet; 0,5, wenn es keine bisherigen Signale gibt.
4. **Landing-Zone-Abgleich (deterministisch).** Der Pass lädt `controls/cloud-provider-catalogue.yaml` (16 Provider) und leitet Bedingungen aus den `implies`-Tags der bisherigen Signale ab:
   - Harte Bedingungen: `de_only_residency_confirmed`, `eu_only_residency_confirmed`, `bsi_c5_required`, `hipaa_required`, `low_vendor_lock_in_required`. Ein Provider, der eine davon nicht erfüllt, wird mit Begründung ausgeschlossen (zum Beispiel keine DE-only-Garantie, BSI C5 nicht testiert, HIPAA nicht erfüllt, hoher Lock-in).
   - Benötigte Dienste: jeder Tag `service_dep:<service>`, vor allem aus [Pass 01 (INV)](/de/passes/01-inv).
   - Eignungswert je verbleibendem Provider: 0,50 × Souveränitätswert + 0,35 × Anteil verfügbarer benötigter Dienste + 0,10 × Portabilitätswert des Providers laut Katalog (eine Eigenschaft des Providers, nicht der `portability_score` der Anwendung) + 0,05 × (1 minus Kostenstufe, mit low = 0, medium = 0,5, high = 1), begrenzt auf 1,0.
   - Die Provider werden gereiht; der beste nicht ausgeschlossene Provider wird `recommended_landing_zone`. Benötigte Dienste, die kein verbleibender Provider anbietet, erscheinen als `landing_zone_blockers`.
   - Konfidenz der Empfehlung: high bei einer Abdeckung von mindestens 0,9 und einer DE-only-, BSI-C5- oder HIPAA-Bedingung; medium bei einer Abdeckung von mindestens 0,7; sonst low (ebenfalls low, wenn kein Provider verbleibt).
5. **Prompt aufbauen.** Er enthält die Signalanzahl nach Präfix und nach Schweregrad, bis zu zehn Signale mit hohem Schweregrad, alle EGR-Signale (jeweils auf 120 Zeichen gekürzt) und die empfohlene Landing Zone. Das Modell muss `seven_r_label`, `migration_rationale`, `modernization_position`, `portability_score`, `confidence`, `landing_zone`, `recommended_next_steps`, `migration_blockers` und `migration_enablers` liefern und `SYNTH-01` (7R-Urteil), `SYNTH-02` (Begründung, warum andere Rs verworfen wurden) und `SYNTH-03` (zentrale Rahmenbedingung) erzeugen.
6. **Antwort prüfen.**
   - Die Antwort muss gültiges JSON sein.
   - `seven_r_label` wird normalisiert (zum Beispiel werden `refactor`, `re_architect` und `rearchitect` akzeptiert) und muss eines der sieben Rs sein.
   - `modernization_position` muss eine nicht leere Zeichenkette sein. Kanonische Werte sind `invest_modernize_now`, `migrate_stabilize`, `tolerate_contain` und `retire_replace`; Verfeinerungen wie `invest_modernize_with_remediation` werden akzeptiert.
   - `portability_score` muss eine Zahl zwischen 0,0 und 1,0 sein.
7. **Anpassung nach Landing-Zone-Bereitschaft.** Liegt in `23-lzr.yaml` des aktuellen Laufs ein Urteil von Pass 23 (LZR) vor:

   | LZR-Urteil | 7R des Modells | Anpassung |
   |---|---|---|
   | `blocked` | Rehost oder Replatform | Urteil wird zu Retain; Bewertungsänderung minus 1,0 für das ursprüngliche R und plus 0,15 für Retain |
   | `blocked` | Retain | Retain plus 0,15 |
   | `blocked` | jedes andere R | Keine Änderung, nur Hinweis |
   | `advisory` | Rehost oder Replatform | Urteil bleibt; Bewertungsänderung minus 0,15; Warnungen vor der Migration beheben |
   | `advisory` | jedes andere R | Keine Änderung, nur Hinweis |
   | `ready` | beliebig | Keine Änderung |
   | keines | beliebig | `lzr_adjustment.verdict: not_assessed` |

## Wie gemessen wird

| Signal | Bedeutung |
|---|---|
| `SYNTH-01` | 7R-Urteil mit Begründung |
| `SYNTH-02` | Begründung für das Verwerfen der anderen Rs |
| `SYNTH-03` | Zentrale Rahmenbedingung, die das Urteil bestimmt |
| weitere `SYNTH-NN` | Zusätzliche Signale, die das Modell erzeugt |
| `SYNTH-00` | Pass übersprungen oder eingeschränkt (informational, Outcome `indeterminate`, Status `not_applicable`): kein LLM konfiguriert oder `--skip-llm` gesetzt (`skipped_reason: no_llm_provider`; mit dem Flag zusätzlich `skip_llm_flag: true`), oder die Antwort hat die Prüfung nicht bestanden (`skipped_reason: invalid_llm_response`, Ursache in `invalid_response_detail`) |

Alle SYNTH-Signale tragen `synthesis: true`. Schweregrade und Outcomes legt das Modell im Rahmen des SWAO-Signalschemas fest.

**Portabilitätswert.** Der Prompt definiert `portability_score` als Anteil der Egress-Signale mit souveränem Cloud-Äquivalent: (verfügbar + 0,5 × teilweise) / Egress gesamt, mit 0,70 als Schwelle für Souveränitätsreife. Ohne EGR-Signale schätzt das Modell den Wert aus TF- und CTX-Signalen: containerisiert mit vollständiger IaC-Abdeckung 0,8 bis 1,0, ohne IaC auf Bare Metal 0,1 bis 0,3, jedes CTX-Signal mit Hinweis auf Vendor-Lock-in (proprietäres SDK, Managed PaaS, reine SaaS-API) minus 0,1 bis 0,2, ganz ohne Signale 0,5.

Der `assessment`-Block enthält die Felder des Modells (`seven_r_label` nach Anpassung, `migration_rationale`, `modernization_position`, `portability_score`, `confidence`, `landing_zone`, `recommended_next_steps`, `migration_blockers`, `migration_enablers`) sowie `lzr_adjustment`, `coverage_score`, `prior_signals_analysed`, `landing_zone_candidates` (je Provider: Eignungswert, Begründung, Ausschluss, Dienstlücken, passende Zertifizierungen, Lock-in-Hinweise, meshStack-Integration), `recommended_landing_zone`, `landing_zone_recommendation_confidence` und `landing_zone_blockers`.

**Wie die Ergebnisse genutzt werden.** 7R-Label, Abdeckungswert und Portabilitätswert erscheinen im [Bericht](/de/generate-report), in der [HTML-Publikation](/de/publish-html), im [BI-Export](/de/export-bi) (Anwendungsdimension) und im SWAO-MCP-Server. In einem [LLM-Assessment](/de/assessment/llm) führt jedes Leg diesen Pass mit seinem eigenen Modell aus, sodass sich die Urteile über Modelle hinweg vergleichen lassen.

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| js-yaml | Lesen der bisherigen Pass-Dateien, des Provider-Katalogs und von `23-lzr.yaml` | MIT | Gebündelt | Entfällt |
| LLM-Provider oder LLM-Gateway-Connector | 7R-Synthese | Externer Dienst; Lizenz im Repository nicht erfasst | Extern, von Ihnen konfiguriert | Skip-Signal `SYNTH-00` |

## Ausgaben

- `wsp/runs/<ts>/passes/09-synth.yaml` mit Kopf (`id: 9`, `name: synthesis`), Signalen, `assessment` und `data_source`.
- `wsp/runs/<ts>/llm-traces/09-synth-call-1.json` mit dem geschwärzten Prompt und der Rohantwort.
- Zwischengespeicherte Antworten unter `wsp/cache/llm/<model>/` (bis zu 30 Tage; mit `--no-cache` umgehen).

## Konfiguration und Einschränkungen

**Konfiguration**

- LLM-Auswahl: `providers.llm.primary`, `--llm`, `--model`, `SWAO_LLM_PROVIDER`, `SWAO_LLM_CONNECTOR`.
- `--passes` bestimmt, welche Signale zur Verfügung stehen; ein Lauf nur mit `synth` hat nichts zusammenzufassen.
- `--lzr <landingZoneId>` führt Pass 23 (LZR) vor diesem Pass aus; dessen Urteil passt das 7R-Ergebnis desselben Laufs an.
- `--skip-llm` belässt diesen Pass im Lauf, ruft aber kein LLM auf; der Pass schreibt die Übersprung-Markierung `SYNTH-00`.
- Frameworks in `assessment.regimes_active` beeinflussen das Urteil indirekt über die Zusammenfassungssignale von COMP.

**Einschränkungen und bekannte Lücken**

- **Unbrauchbare Antworten schränken den Pass ein.** Ist die Antwort kein gültiges JSON, fehlt das `assessment`-Objekt, hat sie ein ungültiges 7R-Label, fehlt `modernization_position` oder liegt `portability_score` außerhalb von 0 bis 1, erzeugt der Pass nur `SYNTH-00` mit `skipped_reason: invalid_llm_response`, und der Lauf geht ohne 7R-Urteil weiter. Wiederholen Sie den Lauf oder wählen Sie ein Modell, das JSON-Vorgaben zuverlässig einhält.
- Kann der Cloud-Anbieterkatalog nicht gefunden oder gelesen werden, entfällt der Landing-Zone-Abgleich, die Landing-Zone-Felder fehlen, und `landing_zone_match_skipped_reason` im `assessment`-Block nennt den Grund.
- Im Prompt werden nur bis zu zehn Signale mit hohem Schweregrad und die EGR-Signale zitiert; alle anderen Signale sieht das Modell nur als Anzahl.
