# Pass 03: Datenklassifizierung (DATA)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 03 |
| Schlüssel | `data` |
| Pass-Name in der Ausgabe | `data_classification` |
| Signal-Präfix | `DATA` |
| Typ | LLM-gestützt im Application-Modus; deterministische Service-Variante im Service-Modus |
| Standard | Aktiv |
| Assessment-Typen | `application` (LLM); `llm` (innerhalb jedes Legs, Vergleich über Modelle); `service` (bedingt, deterministische Service-Variante). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Wo Daten gehostet werden dürfen und unter welchen Kontrollen, hängt von der Art der Daten ab. Pass 03 beantwortet die Frage: **„Welche personenbezogenen, sensiblen oder besonderen Kategorien von Daten verarbeitet diese Anwendung, und setzt der Code die damit verbundenen Pflichten um?“**

Er klassifiziert die verarbeiteten Datenklassen (zum Beispiel Kontaktdaten, Gesundheitsdaten, Finanzdaten), sucht nach umgesetzten DSGVO-Kontrollen wie Löschung (Artikel 17), Einwilligung und Aufbewahrung und prüft, ob Geheimnisse in Umgebungsvorlagen stehen. Sind die saudi-arabischen NCA Cloud Cybersecurity Controls aktiv, schlägt er zusätzlich die saudische Datenstufe vor.

## Was Sie bereitstellen müssen

**Application-Modus**

- Den Quellcode der Anwendung.
- Einen konfigurierten LLM-Provider: `providers.llm.primary` in der `.swao.yml`, einen Connector über `--llm <connector[:model]>` oder die Umgebungsvariable `SWAO_LLM_PROVIDER`. Ohne Provider wird der Pass übersprungen (siehe unten).
- Optional: `assessment.regimes_active` mit `NCA_CCC_CST` oder `NCA_CCC_CSP` in der App-`.swao.yml`, um die saudische Datenstufe anzufordern.

```yaml
assessment:
  regimes_active: [GDPR, NCA_CCC_CST]
```

**Service-Modus** (siehe [Service Portfolio Assessment](/de/service-assessment/))

- Datenfluss-Dokumente (ERD, als Text exportierte Datenflussdiagramme, Beschreibungen von Bildschirmmasken) in `ingestion/data-flow/` oder `wsp/inputs/data-flow/` oder beliebige in `ingestion/` abgelegte Dokumente (PDF-, Word-, Excel- und Textdateien, gelesen über den Text, den Pass 00 nach `wsp/inputs/` extrahiert) und/oder
- einen `data:`-Block in der App-`.swao.yml` mit einem der Felder `health_data`, `pii`, `gdpr_art9`, `classification` oder `categories`.

Fehlt beides, wird der Pass im Service-Modus übersprungen.

## Wie der Pass arbeitet

### Application-Modus (LLM)

1. **Bis zu 16 relevante Dateien sammeln**, in dieser Prioritätsreihenfolge:
   - `prisma/schema.prisma` (erste 4.000 Zeichen)
   - `.env.example`, `.env.sample`, `config.toml`, `config.yaml`, `config.yml` im Wurzelverzeichnis (je erste 1.500 Zeichen)
   - Bis zu vier weitere Schemadateien (`.prisma`, `.sql`, `.graphql`; je 2.500 Zeichen), bis zu sieben Verzeichnisebenen tief
   - Quelldateien (`.ts`, `.js`, `.rs`, `.go`, `.py`, `.java`, `.kt`, `.cs`, `.rb`), deren **Name** ein Datenschutz-Stichwort enthält, etwa `gdpr`, `erasure`, `consent`, `retention`, `pii`, `patient`, `medical`, `redact` (je 3.000 Zeichen)
   - Wurden weniger als drei solcher Dateien gefunden: Handler-Dateien, deren Name `auth`, `user`, `account`, `profile`, `settings`, `delete`, `export` oder `consent` enthält und deren Inhalt ein Datenschutz-Stichwort aufweist (je 2.500 Zeichen)
   - `node_modules`, `target`, `.git` und versteckte Ordner werden übersprungen.
2. **Prompt aufbauen.** Das Modell wird angewiesen, Datentypen und PII-Klassen zu klassifizieren, jedes Signal ausschließlich auf sichtbare Evidenz in den übergebenen Dateien zu stützen, fehlende Evidenz nicht als Beleg für Abwesenheit zu werten und für umgesetzte DSGVO-Kontrollen positive Signale mit Datei- und Funktionsangabe zu erzeugen. Signal-IDs müssen `DATA-NN` lauten. Ist `NCA_CCC_CST` oder `NCA_CCC_CSP` aktiv, ergänzt der Prompt die Anweisungen zur saudischen Datenstufe.
3. **Schwärzen und senden.** Der Prompt durchläuft in den Treibern für Anthropic, OpenAI, Amazon Bedrock und OpenAI-kompatible Endpunkte den SWAO-Redactor vor dem LLM-Aufruf (E-Mail-Adressen, IP-Adressen, Zugangsdaten in URLs, Geheimnis- und Token-Muster, Benutzerpfade, USt-ID, SSN, Reisepass- und UK-NI-Nummern; Personennamen nur mit `SWAO_SCRUB_PERSON_NAME=1`).
4. **Antwort auswerten.** Code-Fences und Streuzeichen werden entfernt, das JSON-Objekt wird extrahiert. Eine abgeschnittene Antwort wird einmal durch Schließen der Klammern repariert. Jedes Signal wird auf das SWAO-Signalschema normalisiert.

### Service-Modus (deterministisch)

1. Liest den `data:`-Block der App-`.swao.yml`.
2. Durchsucht Textdokumente (`.md`, `.txt`, `.csv`, `.sql`, `.xml`, `.json`, `.yaml`, `.yml`, `.html`, `.htm`, je bis 2 MB) im Datenfluss-Ordner Zeile für Zeile nach Feldnamen für personenbezogene Daten (zum Beispiel `patient`, `name`, `vorname`, `nachname`, `geburt`, `adresse`, `telefon`, `email`, `versicher`, `diagnos`, `befund`, `medikament`) und für Gesundheitsdaten (zum Beispiel `patient`, `diagnos`, `befund`, `icd`, `dicom`, `modality`, `lab_result`, `vital`).
3. Erzeugt Signale aus den Angaben und Treffern; die Evidenz nennt nur Datei und Zeile, niemals den gefundenen Wert.

## Wie gemessen wird

### Application-Modus

Signal-IDs, Schweregrade und Anzahl wählt das Modell im Rahmen des SWAO-Signalschemas (`DATA-01`, `DATA-02` usw.; Schweregrad `critical`, `high`, `medium`, `low`, `informational` oder `positive`; Outcome `positive`, `negative`, `neutral` oder `indeterminate`). Der Prompt fordert einen `assessment`-Block mit:

| Feld | Bedeutung |
|---|---|
| `data_classes` | Liste der beobachteten Datenklassen |
| `gdpr_art17_implemented` | Ob die Löschung umgesetzt ist |
| `secrets_in_env` | Ob Geheimnisse in Umgebungsdateien stehen |
| `saudi_data_tier` | Nur bei aktivem NCA CCC: `level` (`public`, `internal`, `confidential`, `restricted`), `label`, `cst_class_required` (`class_c` für public und internal, `class_b` für confidential, `class_a` für restricted oder `null`) |

Wurden keine Dateien gefunden, soll das Modell ein einziges `DATA-01` mit Hinweis auf die eingeschränkte Abdeckung erzeugen und keine Lücken erfinden.

Sonderfälle:

| Situation | Ergebnis |
|---|---|
| Kein LLM konfiguriert | Ein Signal `DATA-00` (informational, Outcome `indeterminate`); Pass-Status `not_applicable`; `skipped_reason: no_llm_provider` |
| LLM nach allen Wiederholungen nicht erreichbar | Status `not_applicable`, keine Signale, `skipped_reason: connectivity_failure`; ein konfigurierter sekundärer Connector wird vorher versucht |
| Antwort auch nach Reparatur nicht auswertbar | Ein Signal `DATA-00` (informational, Outcome `indeterminate`); Status `not_applicable`; `skipped_reason: invalid_llm_response` mit der Ursache in `invalid_response_detail`; Hinweis auf einen erneuten Lauf |
| `--skip-llm` gesetzt | Kein LLM-Aufruf; dieselbe Übersprung-Markierung `DATA-00` wie ohne LLM (`skipped_reason: no_llm_provider`), ergänzt um `skip_llm_flag: true` und eine Herleitung, die das Flag nennt |

### Service-Modus

| Signal | Wird erzeugt, wenn | Schweregrad |
|---|---|---|
| `DATA-NN` (erstes) | `data.health_data` oder `data.gdpr_art9` ist `true` oder Gesundheitsfeldnamen kommen in den Dokumenten vor | high, Outcome negative: besondere Kategorie Gesundheitsdaten (DSGVO Artikel 9) |
| `DATA-NN` (nächstes) | `data.pii` ist `true` oder Feldnamen für personenbezogene Daten kommen vor | medium, Outcome negative: Pflichten für personenbezogene Daten gelten |
| `DATA-01` | Keiner der beiden Fälle | informational, Outcome indeterminate: mit dem fachlichen Verantwortlichen bestätigen |

Der Service-`assessment`-Block enthält `mode: service`, die angegebenen Werte sowie die Anzahl der Dokumente und Feldtreffer.

**Wie die Ergebnisse in spätere Passes einfließen.** DATA-Signale sind der wichtigste Input für Datenschutz-Controls (zum Beispiel DSGVO, die saudischen NCA-Controls oder Frameworks für das Gesundheitswesen), die Pass 11 (COMP) bewertet, sowie für [Pass 09 (SYNTH)](/de/passes/09-synth). Signale mit hohem Schweregrad werden zu abgeleiteten Sicherheits-Findings und Risiken.

## Drittanbieter-Module und Werkzeuge

| Name | Zweck in diesem Pass | Lizenz (Paket-Metadaten) | Gebündelt oder extern | Verhalten bei Fehlen |
|---|---|---|---|---|
| js-yaml | Lesen von `assessment.regimes_active` und des Service-`data:`-Blocks | MIT | Gebündelt | Entfällt |
| LLM-Provider (Anthropic, OpenAI, Amazon Bedrock, Ollama, OpenAI-kompatibler Endpunkt oder LLM-Gateway-Connector) | Klassifizierung im Application-Modus | Externer Dienst; Lizenz im Repository nicht erfasst | Extern, von Ihnen konfiguriert | Pass erzeugt `DATA-00` und wird als übersprungen markiert |

## Ausgaben

- `wsp/runs/<ts>/passes/03-data.yaml`: Kopf (`id: 3`, `name: data_classification`), Signale, `assessment` und bei LLM-Läufen ein `data_source`-Block (Provider, Modell, Temperatur, Seed, Cache-Treffer, Platzhalter-Eingaben, Anzahl False-Positive-Markierungen).
- `wsp/runs/<ts>/llm-traces/03-data-call-1.json`: der geschwärzte Prompt und die Rohantwort (Application-Modus mit LLM).
- LLM-Antworten werden bis zu 30 Tage unter `wsp/cache/llm/<model>/` zwischengespeichert, sofern Sie nicht `--no-cache` verwenden.

## Konfiguration und Einschränkungen

**Konfiguration**

- `providers.llm.primary` in der `.swao.yml`, `--llm <connector[:model]>`, `--model <id>`, `SWAO_LLM_PROVIDER`, `SWAO_LLM_CONNECTOR`.
- `assessment.regimes_active` mit `NCA_CCC_CST` oder `NCA_CCC_CSP` für die saudische Datenstufe.
- `--no-cache` erzwingt einen neuen LLM-Aufruf.
- `.swao-pii-allowlist.txt` im Workspace-Wurzelverzeichnis listet Zeichenketten, die der Redactor unverändert lassen soll; `SWAO_SCRUB_PERSON_NAME=1` aktiviert das Schwärzen von Personennamen.
- Service-Modus: `data:`-Block (`health_data`, `pii`, `gdpr_art9`, `classification`, `categories`) in der App-`.swao.yml`.

**Einschränkungen und bekannte Lücken**

- Die Dateiauswahl erfolgt über Dateinamen. Datenschutzlogik in neutral benannten Dateien wird nur erfasst, wenn der Handler-Rückfall sie aufgreift.
- Es werden höchstens 16 Dateien mit festen Zeichenlimits je Datei gesendet; große Schemata werden gekürzt.
- Die Service-Variante arbeitet mit Stichwortabgleich und unterscheidet nicht zwischen einer Felddefinition und einer Erwähnung im Fließtext.
