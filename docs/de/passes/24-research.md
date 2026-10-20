# Pass 24: Hersteller- und Schwachstellenrecherche (RESEARCH)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 24 |
| Schlüssel | Läuft als Befehl `swao service research` (außerhalb der Pass-Schleife von `swao assess`) |
| Signal-Präfix | `RES` (Signalcodes `CVE.*`, `EOL.*`, `ADVISORY.*`, `BINARY.VT_DETECTION_RATIO`, `VENDOR.*`, `DATA.*`, `MDR.*`), geschrieben nach `apps/<id>/wsp/signals/research-signals.json`, zusätzlich zu den Recherche-Stubs |
| Typ | Abfragen externer APIs (öffentliche Quellen zu Schwachstellen und Lebenszyklus) und, mit einem Workspace-LLM, LLM-gestützte Recherche |
| Standard | Optional: vor `swao assess` ausdrücklich ausführen |
| Assessment-Typen | `service` (Service Portfolio Assessment) |
| Tier | Alle Tiers (`service-assessment` ist eine Community-Funktion) |
| Quelle | `packages/@swao/module-service-assessment/src/research/` |

## Wofür dieser Pass gedacht ist

In einem Service Portfolio Assessment gibt es keinen Quellcode zum Prüfen; die Anwendungen sind Produkte Dritter, SaaS oder Standardsoftware, die in einer Intake-Arbeitsmappe beschrieben sind. Pass 24 beantwortet die Frage: „Was sagen öffentliche Quellen über dieses Produkt und diese Version: bekannte Schwachstellen, aktive Ausnutzung, Ende des Supports und ob das Installationspaket Antivirus-Engines bekannt ist?“

Für jede Service-App sammelt er diese Informationen aus öffentlichen APIs und Feeds, speichert sie als prüfbare Markdown-Dateien mit strukturiertem Front-Matter versieht jedes Ergebnis mit einer Konfidenzstufe und einer Herkunftsangabe und leitet aus den Ergebnissen Signale ab. Spätere Schritte (Pass 04 CTX, Pass 11 COMP, das APM-Scoring, die HTML-Veröffentlichung und die Exporte) verwenden diese Dateien.

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Service-Apps | `apps/<id>/.swao.yml` mit `assessment.type: service` | Werden von `swao service init` aus der Intake-Arbeitsmappe angelegt |
| Herstellername, Produktname, Version | `vendor.name`, `app_name`, `vendor.version` in der `.swao.yml` der App | NVD wird nur abgefragt, wenn ein echter Herstellername bekannt ist. Hat die Intake-Datei keine Herstellerspalte, tragen Sie `vendor.name` ein und entfernen Sie `vendor` aus `generated_fields` (siehe [Sicher bearbeiten](/de/service-assessment/configuration#sicher-bearbeiten)) |
| Betriebssystem | `platform.os` und `os_class` | `os_class` wählt über den INFRA-CAT-Eintrag das Produkt bei endoflife.date |
| Infrastrukturkategorie | `infra_category` | Wählt ein optionales Open-Source-Paket für OSV.dev |
| Installationsdateien (für VirusTotal) | An beliebiger Stelle in `apps/<id>/ingestion/` oder in `apps/<id>/wsp/inputs/binary/` | Werden von [Pass 25 BINARY](/de/passes/25-binary) gehasht (nur PE- und MSI-Dateien) |
| `NVD_API_KEY` (optional) | SWAO-Credential-Vault oder Umgebungsvariable | Erhöht das NVD-Ratenlimit |
| `VT_API_KEY` (optional) | SWAO-Credential-Vault oder Umgebungsvariable | Ohne ihn erfolgt keine Anfrage an VirusTotal |

Ein Schlüssel im Credential-Vault hat Vorrang vor der Umgebungsvariablen. Siehe [API-Schlüssel](/de/service-assessment/api-keys).

## So funktioniert der Pass

1. **Service-Apps finden.** Alle `apps/*/.swao.yml` mit `assessment.type: service` oder eine App mit `--app`.
2. **INFRA-CAT laden.** Der Infrastrukturkatalog liefert die Produkt-IDs von endoflife.date je OS-Klasse und optionale OSV-Pakete je Kategorie. Siehe [INFRA-CAT](/de/service-assessment/infra-cat).
3. **Je App und Thema** entscheiden, ob abgefragt wird:
   - Ein von einem Analysten geprüfter Stub (Front-Matter `reviewed_by` oder Herkunft `user-provided`) wird nie überschrieben (`protected`);
   - andernfalls wird ein Quellblock erneut abgefragt, wenn er fehlt, einen Fehler enthält, älter als seine Cache-Dauer ist oder aus anderen Werten für Hersteller, Produkt oder Version entstand;
   - `--refresh` fragt jeden nicht geschützten Block erneut ab; `--dry-run` zeigt nur den Plan, ohne Anfragen und ohne Schreibzugriffe;
   - ein Thema ohne recherchierbare Angaben wird nicht abgefragt. Die CVE-Recherche ohne Herstellername, Produktname und OSV-Paket sowie die End-of-Life-Recherche ohne Betriebssystem schreiben den Stub mit `status: skipped`, `skipped_reason: no_input`, der Liste `missing_inputs` (`[vendor_name, product_name]` bzw. `[os]`) und ohne Konfidenz, statt eines Ergebnisses mit niedriger Konfidenz.
4. **CVE-Zusammenfassung.**
   - **NVD:** eine Schlagwortsuche je Hersteller und Produkt (das Schlagwort ist der Herstellername gefolgt vom Produktnamen, oder nur der Produktname, wenn er den Herstellernamen bereits enthält). Ohne Herstellernamen wird NVD nicht abgefragt (`note: no_vendor_name`, Konfidenz `low`). Die Ergebnisse werden seitenweise gelesen (bis zu 5 Seiten mit je 2000 Treffern; jede Seite unterliegt dem NVD-Ratenlimit). Meldet NVD mehr Treffer, als gelesen wurden, oder schlägt eine spätere Seite fehl, wird der Block mit `truncated: true` markiert, und die Zahlen sind eine Untergrenze. Zählung nach CVSS-Schweregrad (v4.0, dann v3.1, v3.0, v2), die zehn höchstbewerteten Einträge und die Patch-Verfügbarkeit für kritische und hohe CVEs anhand der Referenz-Tags von NVD.
   - **CISA KEV:** Der Katalog bekannter ausgenutzter Schwachstellen wird vollständig heruntergeladen und lokal mit den CVE-IDs aus NVD abgeglichen.
   - **BSI CERT-Bund:** Der RSS-Feed der Sicherheitshinweise wird vollständig heruntergeladen und lokal abgeglichen: Der Produktteil jedes Hinweistitels wird mit dem Herstellernamen oder dem Produktnamen verglichen (jeweils mindestens vier Zeichen). Ein Treffer allein über den Produktnamen, weil kein Herstellername bekannt ist, erhält die Konfidenz `low`.
   - **OSV.dev:** wird nur abgefragt, wenn der INFRA-CAT-Eintrag ein Open-Source-Paket angibt.
5. **End-of-Life-Status.** endoflife.date wird für den Produkt-Slug abgefragt; der Release-Zyklus wird aus der OS-Angabe ermittelt (Windows-Bezeichnungen wie 2012 R2, Service Packs wie 12 SP5, danach numerische Versionen). Ergebnis: End-of-Life-Datum, ob es überschritten ist, verbleibende Monate, Support- und erweitertes Support-Datum.
6. **VirusTotal.** Zuerst läuft Pass 25 BINARY (offline), um den Hash des Installationspakets zu erhalten. Der erste SHA256-Wert wird bei VirusTotal nachgeschlagen.
7. **Ergebnisse schreiben.** Ein Stub je Thema und eine `confidence.json` je App. Beim Überschreiben ändern sich nur das Front-Matter und der Text zwischen den Markierungen `<!-- swao:generated:start -->` und `<!-- swao:generated:end -->`; Notizen des Analysten außerhalb der Markierungen bleiben erhalten.
8. **Signale ableiten.** Die Signale `RES-NN` werden aus den endgültigen Stubs abgeleitet (neu recherchiert, unverändert oder geschützt) und nach `apps/<id>/wsp/signals/research-signals.json` geschrieben; ein Lauf ohne `--refresh` leert die Datei daher nicht. Mit `--dry-run` wird nichts geschrieben.

Nur Herstellername, Produktname, Version, der OS-Produkt-Slug und Hashes der Installationspakete verlassen Ihr Netzwerk; die LLM-Prompts enthalten Herstellername, Produktname, Version und die INFRA-CAT-Kategorie. App-IDs, Standorte und andere Intake-Daten werden nie gesendet.

**LLM-gestützte Recherche.** Ist im Workspace ein LLM konfiguriert (`providers.llm` in der Workspace-`.swao.yml` oder `SWAO_LLM_CONNECTOR` / `SWAO_LLM_PROVIDER`, wie bei `swao assess`), fragt SWAO je Thema (`vendor-profile`, `certifications`, `data-residency`, `breach-history`) mit einem Prompt nach Erkenntnissen mit Quell-URLs und einer Konfidenz je Erkenntnis, als JSON-Objekt. Seit der Prompt-Version `1.1-2026-10-18` enthalten die Antworten für `vendor-profile`, `certifications` und `data-residency` zusätzlich einen kleinen Block `facts` (EU-Gesellschaft, Patch-Rhythmus in Tagen, EU-MDR-Klasse, BfArM-Eintrag, Auftragsverarbeitungsvertrag nach DSGVO; jeweils `yes`, `no` oder `unknown`, oder eine Klasse oder Zahl) mit eigenen Quell-URLs. Der Block ist optional: Eine Antwort ohne ihn oder mit Werten, die SWAO nicht lesen kann, wird trotzdem gespeichert, und diese Werte gelten als `unknown`. Die Antwort wird geprüft; jede Quell-URL wird als vom Modell genannt und nicht verifiziert gespeichert (SWAO ruft sie nicht auf). Der Provider wendet dieselbe Anfragebehandlung wie `swao assess` an: Wiederholungen, Log-Ereignisse, das Limit `max_concurrency` und die PII-Redaktion, bevor der Prompt Ihr Netzwerk verlässt. Ein recherchiertes Thema bleibt 30 Tage gültig. Ein fehlgeschlagener Aufruf (`llm_error`) oder eine Antwort im falschen Format (`llm_malformed_response`) wird als `skipped` festgehalten und beim nächsten Lauf wiederholt. Ohne Hersteller- und Produktname ist das Thema `skipped` mit `no_input`. Die Funktion steht in allen Lizenz-Tiers zur Verfügung; ohne LLM werden die vier Themen mit `no_llm_configured` übersprungen. Mit `--skip-llm` (oder „Skip LLM research for this run“ im TUI-Bildschirm des Service-Assessments) erfolgt kein LLM-Aufruf, und der Provider wird nicht aufgebaut: Themen ohne frühere Erkenntnisse werden als `skipped` mit `skipped_by_user` geschrieben, Stubs mit früheren LLM-Erkenntnissen für denselben Hersteller, dasselbe Produkt und dieselbe Version bleiben unverändert (auch mit `--refresh`).

## Wie gemessen wird

### Recherchethemen

| Themendatei | Quellen | Stand in diesem Build |
|---|---|---|
| `cve-summary.md` | NVD, CISA KEV, BSI CERT-Bund, OSV.dev | Recherchiert, oder `skipped` (`no_input`), wenn nichts zu recherchieren ist |
| `eol-status.md` | endoflife.date | Recherchiert, oder `skipped` (`no_input`) ohne Betriebssystem |
| `virustotal.md` | VirusTotal | Recherchiert oder `skipped` ohne Schlüssel bzw. Hash |
| `vendor-profile.md`, `certifications.md`, `data-residency.md`, `breach-history.md` | Workspace-LLM (LLM-gestützte Recherche, alle Tiers) | Recherchiert (Herkunft `LLM-researched`) oder `skipped` mit `no_llm_configured`, `llm_unavailable`, `llm_error`, `llm_malformed_response`, `skipped_by_user` oder `no_input` |

### Konfidenz

| Stufe | Bedeutung |
|---|---|
| `high` | Direkter API-Treffer einschließlich Version (zum Beispiel NVD mit Hersteller, Produkt und Version; ein Zyklustreffer bei endoflife.date; ein Treffer bei VirusTotal; der KEV-Abgleich) |
| `medium` | Produkttreffer ohne Version, ein BSI-Treffer (der Feed enthält nur aktuelle Hinweise) oder ein VirusTotal unbekannter Hash |
| `low` | API-Fehler, kein Herstellername (auch ein BSI-Treffer allein über den Produktnamen), kein Slug für die Kategorie, kein Zyklustreffer oder Extrapolation |

Die Konfidenz eines Themas ist die niedrigste Konfidenz seiner ausgeführten Quellblöcke (übersprungene Blöcke zählen nicht). Für `cve-summary` ist das das Minimum der Blöcke von NVD und OSV. Die **zusammengesetzte** Konfidenz der App in `confidence.json` ist das Minimum über die Themen, die eine Konfidenz geliefert haben (das schwächste Thema); sie ist `null`, wenn kein Thema eine geliefert hat. Der Befehl gibt die Verteilung der zusammengesetzten Konfidenz über alle Apps aus (high, medium, low und "nothing to look up" für Apps ohne jede Konfidenz) sowie eine Zeile pro Thema (`cve-summary`, `eol-status`, `virustotal`) mit denselben Zählungen, damit ein schwacher CVE-Treffer kein starkes End-of-Life-Ergebnis verdeckt. In der Zeile `virustotal` zählen Apps, die ohne API-Schlüssel oder ohne Hashwert eines Installationspakets übersprungen wurden, als "nothing to look up".

### Herkunft

Jeder Stub trägt eine der Angaben `API-verified`, `catalogue`, `LLM-researched` oder `user-provided`. In diesem Build wird die Herkunft zusätzlich je Quellblock vermerkt: Jeder Block (`cve`, `kev`, `bsi`, `osv`, `eol`, `vt`) erhält `API-verified`, wenn diese Quelle geantwortet hat, und bleibt leer, wenn sie übersprungen wurde, fehlschlug oder nichts abzufragen hatte. Der Stub selbst ist `API-verified`, wenn mindestens eine seiner Quellen geantwortet hat. Ein Analyst kennzeichnet einen Stub als `user-provided` (oder setzt `reviewed_by`), um ihn vor dem Überschreiben zu schützen.

### Signale

| Signal | Code | Regel | Schweregrad |
|---|---|---|---|
| `RES-01` | `CVE.CISA_KEV_MATCH` | Mindestens eine für das Produkt gefundene CVE steht im CISA-Katalog Known Exploited Vulnerabilities | critical |
| `RES-02` | `CVE.CRITICAL_OPEN` | NVD meldet kritische CVEs, und die Patch-Verfügbarkeit ist nicht für jede kritische und hohe CVE bestätigt | critical |
| `RES-03` | `CVE.CRITICAL_PATCH_AVAILABLE` | NVD meldet kritische CVEs, und jede kritische und hohe CVE hat eine Patch-Referenz | high |
| `RES-04` | `CVE.HIGH_SEVERITY_OPEN` | NVD meldet CVEs mit hohem Schweregrad, ohne bestätigten Patch für jeden schwerwiegenden Befund | high |
| `RES-05` | `EOL.OS_PAST_EOS` | Das Betriebssystem-Release hat sein Supportende überschritten (endoflife.date) | high |
| `RES-06` | `EOL.OS_WITHIN_18_MONTHS` | Das Betriebssystem-Release erreicht sein Supportende innerhalb von 18 Monaten | high |
| `RES-07` | `ADVISORY.BSI_CERT_BUND` | Aktuelle BSI-CERT-Bund-Hinweise passen zum Hersteller- oder Produktnamen | folgt dem höchsten Schweregrad der Hinweise (`kritisch` critical, `hoch` high, `mittel` medium, `niedrig` low); medium, wenn unbekannt |
| `RES-08` | `BINARY.VT_DETECTION_RATIO` | VirusTotal meldet für den Hash des Installationspakets mindestens ein Urteil „malicious“ | critical |
| `RES-09` | `VENDOR.BREACH_HISTORY` | `breach-history.md` wurde vom Workspace-LLM recherchiert und enthält mindestens eine Erkenntnis, die einen Sicherheitsvorfall, eine Datenpanne oder eine Aufsichtsmaßnahme meldet (eine Erkenntnis, die nur feststellt, dass nichts dokumentiert ist, zählt nicht) | medium (nie höher) |
| `RES-10` | `VENDOR.PATCH_CADENCE_SLOW` | Die Fakten in `vendor-profile.md` nennen einen Patch-Rhythmus von mehr als 90 Tagen für eine kritische Schwachstelle | medium (nie höher) |
| `RES-11` | `DATA.NO_EU_ENTITY` | Die Fakten in `vendor-profile.md` besagen, dass der Hersteller keine Gesellschaft in der EU hat (`eu_entity: no`), und die App hat `GDPR_ART9` in `data.regulatory` oder `data.gdpr_art9: true` | medium (nie höher) |
| `RES-12` | `DATA.GDPR_ART9_NO_DPA` | Die Fakten in `data-residency.md` besagen, dass kein Auftragsverarbeitungsvertrag nach DSGVO angeboten wird (`gdpr_dpa_available: no`), und die App hat `data.health_data: true` oder `data.gdpr_art9: true` | medium (nie höher) |
| `RES-13` | `MDR.CLASS_UNCLEAR` | Die Fakten in `certifications.md` besagen, dass das Produkt ein Medizinprodukt nach EU-MDR 2017/745 ist, aber keine Klasse veröffentlicht ist (`mdr_class: class_not_published`) | medium (nie höher) |
| `RES-14` | `MDR.NOT_REGISTERED_BFARM` | Die Fakten in `certifications.md` besagen, dass das Produkt nicht in der Medizinprodukte-Datenbank des BfArM geführt wird (`bfarm_listed: no`), das Produkt ist nicht als Nicht-Medizinprodukt angegeben, und die App hat `MDR` in `data.regulatory` | medium (nie höher) |

Die API-Signale `RES-01` bis `RES-08` tragen `outcome: negative`, `assessor: rule_engine` und die Konfidenz des zugrunde liegenden Quellblocks (beim KEV-Treffer die des NVD-Blocks). Blöcke mit Fehler, Übersprunggrund oder (bei NVD) ohne Abfrage erzeugen kein Signal. Der Nachweis enthält den Pfad des Stubs und öffentliche URLs (CVE-Seiten von NVD, Links zu Hinweisen, den VirusTotal-Permalink), nie Intake-Daten. Ist der CVE-Block `truncated`, weist die Herleitung darauf hin, dass die Zahlen eine Untergrenze sind.

`RES-09` stammt aus LLM-Erkenntnissen und ist entsprechend gekennzeichnet: `source: llm_inference`, `assessor: llm`, `outcome: negative`. Schweregrad und Konfidenz sind auf `medium` begrenzt (die Konfidenz ist die schwächste des Themas und der gezählten Erkenntnisse, eine Erkenntnis ohne Quell-URL macht sie also `low`); das Signal ist nie `critical` und nie ein Migrationsblocker. Die Herleitung nennt Provider, Modell und Prompt-Version und weist darauf hin, dass die Erkenntnisse vom Modell genannt und nicht verifiziert sind, bis ein Analyst den Stub prüft (`reviewed_by`). Der Nachweis enthält den Pfad des Stubs und jede vom Modell genannte URL mit dem Vermerk „cited by the model, not verified“. Da die Signale aus den Stubs abgeleitet werden, bleibt `RES-09` nach einem Lauf mit `--skip-llm` erhalten.

`RES-10` bis `RES-14` stammen aus den strukturierten `facts` der Prompt-Version 1.1 und tragen dieselben Kennzeichnungen und Grenzen: `source: llm_inference`, `assessor: llm`, Schweregrad `medium` (das Design bewertet einige höher; als Angaben des Modells sind sie begrenzt), nie ein Migrationsblocker. Ihre Konfidenz ist `medium`, wenn die Fakten eine Quell-URL nennen, sonst `low`. Nur eine ausdrückliche Antwort erzeugt ein Signal: `unknown`, eine fehlende Zahl, ein fehlender Block `facts` (Stubs aus Prompt-Version 1.0) oder ein unlesbarer Wert erzeugen nie ein Signal. Die regulatorischen Bedingungen stammen aus dem Block `data` der App-`.swao.yml` (`data.regulatory`, `data.health_data`, `data.gdpr_art9`); diese Werte dienen nur den Signalregeln und werden nie an das LLM gesendet. Ein mit Prompt-Version 1.0 recherchierter Stub wird, solange er gültig ist (30 Tage), nicht erneut abgefragt; die Signale erscheinen daher nach `--refresh` oder sobald der Stub abgelaufen ist.

### Cache-Dauern

| Quelle | Cache-Dauer |
|---|---|
| NVD | 7 Tage |
| CISA KEV | 1 Tag |
| OSV.dev | 7 Tage |
| BSI CERT-Bund | 1 Tag |
| endoflife.date | 30 Tage |
| VirusTotal | 7 Tage |

Die Feeds von KEV und BSI werden zusätzlich einen Tag lang als Dateien in `wsp/cache/research/` zwischengespeichert.

### Ratenlimits und Wiederholungen

| Quelle | Limit |
|---|---|
| NVD | 5 Anfragen je 30 s ohne Schlüssel, 10 je 30 s mit `NVD_API_KEY` |
| VirusTotal | 4 Abfragen je Minute (kostenlose Stufe der öffentlichen API) |

Antworten mit HTTP 429 werden bis zu dreimal mit Backoff wiederholt (unter Beachtung von `Retry-After`). Serverfehler und Timeouts (20 s je Anfrage, 60 s für Feed-Downloads) schlagen sofort fehl und werden im Block als `error` mit Konfidenz `low` festgehalten.

### Wie die Ergebnisse genutzt werden

Die Signale `RES-NN` in `research-signals.json` liest Pass 11 COMP zusätzlich zu den Signalen des Laufs als Evidenz. Die Stubs liest Pass 04 CTX als Kontext, und die APM-Scoring-Regeln verwenden sie direkt: End-of-Life-Status und -Horizont, Anzahl kritischer und hoher CVEs, KEV-Treffer, Patch-Verfügbarkeit, Schweregrad der BSI-Hinweise und VirusTotal-Erkennungen. Siehe [Service-Portfolio-Framework](/de/service-assessment/framework).

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Dienst | Zweck | Gesendete Daten | Schlüssel | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| NVD CVE API 2.0 (NIST) | Anzahl und Schweregrade von CVEs | Schlagwort aus Hersteller und Produkt | `NVD_API_KEY` optional | Block mit `error` oder `note`, Konfidenz low |
| CISA-Feed Known Exploited Vulnerabilities | Aktive Ausnutzung | Keine (vollständiger Feed-Download) | - | KEV-Block mit `error` oder übersprungen ohne CVE-IDs aus NVD |
| RSS der Sicherheitshinweise von BSI CERT-Bund (WID) | Deutsche Sicherheitshinweise | Keine (vollständiger Feed-Download) | - | BSI-Block mit `error` |
| OSV.dev | Schwachstellen in Open-Source-Paketen | Paketname, Ökosystem und Version | - | Übersprungen (`no_oss_package`) oder `error` |
| endoflife.date | End-of-Life-Daten | Produkt-Slug | - | Block mit `error` oder `note` |
| VirusTotal API v3 | Reputation des Installationspakets | Nur der SHA256-Hash | `VT_API_KEY` erforderlich | Übersprungen (`no_api_key` oder `no_binary_hash`) |

Alle HTTP-Aufrufe nutzen das in Node.js eingebaute `fetch`; eine zusätzliche Client-Bibliothek wird nicht verwendet. API-Schlüssel werden nur in Request-Headern übertragen und nie in Stubs oder Fehlermeldungen geschrieben.

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<id>/wsp/inputs/research/<topic>.md` | YAML-Front-Matter (Quellblöcke, Konfidenz, Herkunft, Zeitstempel) und eine lesbare Markdown-Zusammenfassung |
| `apps/<id>/wsp/inputs/research/confidence.json` | `app_id`, `generated_at`, `composite` und Konfidenz je Thema |
| `apps/<id>/wsp/signals/research-signals.json` | `generated_at`, `app_id` und die Signale `RES-NN` |
| `wsp/cache/research/cisa-kev.json`, `wsp/cache/research/bsi-cert-bund.rss` | Feed-Cache auf Workspace-Ebene |
| `apps/<id>/wsp/inputs/binary/binary-analysis.json` | Geschrieben von Pass 25, den die Recherche zuerst ausführt |

## Konfiguration und Einschränkungen

```bash
swao service research                       # alle Service-Apps
swao service research --app hosapp200       # eine App
swao service research --dry-run             # zeigen, was abgefragt würde
swao service research --refresh --json      # alles neu abfragen, Ausgabe als JSON
```

| Einstellung | Wirkung |
|---|---|
| `--app <id>`, `--workspace <dir>` | Umfang |
| `--refresh` | Cache-Dauern ignorieren (geschützte Stubs bleiben erhalten) |
| `--dry-run` | Nur Plan; keine Anfragen, keine Schreibzugriffe |
| `--json` | Maschinenlesbares Ergebnis |
| `NVD_API_KEY`, `VT_API_KEY` | API-Schlüssel (Eintrag im Vault hat Vorrang vor der Umgebungsvariablen) |
| `SWAO_NVD_BASE_URL`, `SWAO_EOL_BASE_URL`, `SWAO_KEV_URL`, `SWAO_BSI_RSS_URL`, `SWAO_OSV_BASE_URL`, `SWAO_VT_BASE_URL` | Alternative Endpunkte, zum Beispiel interne Spiegel in abgeschotteten Umgebungen |

Bekannte Einschränkungen:

- Die Schlagwortsuche von NVD kann auf ähnlich benannte, fremde Produkte treffen; prüfen Sie die CVE-Liste, bevor Sie sich auf die Zahlen stützen. Gelesen werden höchstens 10.000 CVEs (5 Seiten); darüber hinaus wird der Block als `truncated` markiert.
- Der BSI-Abgleich vergleicht nur Namen (mindestens vier Zeichen) und erfasst nur die Hinweise, die aktuell im Feed stehen.
- OSV.dev wird nur für INFRA-CAT-Einträge herangezogen, die ein Open-Source-Paket angeben.
- VirusTotal verwendet nur den ersten Hash in `binary-analysis.json`.
- Die LLM-Themen hängen vom Modell ab: Ein Modell ohne Websuche antwortet aus seinen Trainingsdaten. Quell-URLs sind Angaben des Modells und werden nicht geprüft; prüfen Sie sie, bevor Sie sich auf eine Erkenntnis stützen, und setzen Sie dann `reviewed_by`, um den Stub zu `user-provided` hochzustufen. Die Konfidenz eines LLM-Themas ist die schwächste Erkenntnis und nie höher als `medium`. Die LLM-Recherche erzeugt die RESEARCH-Signale `RES-09` bis `RES-14`, jeweils höchstens medium. Die Prompts (Version `1.0-2026-10-18`) hat der Product Owner am 2026-10-18 freigegeben; Version `1.1-2026-10-18` ergänzt den strukturierten Block `facts`, vom Product Owner am 2026-10-18 vorab freigegeben und im UAT bewertet.

Siehe auch [Service Portfolio Assessment](/de/service-assessment/) und [Befehle](/de/service-assessment/commands).
