# Pass 10: Dynamische Analyse (DYNAMIC)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 10 |
| Schlüssel (`--passes`) | `dynamic` (Kurzform `dyn` in `--passes` und Lens-Profilen) |
| Signal-Präfix | `DYN` |
| Typ | Dynamisch (Crawl mit Headless-Browser) plus deterministische Regeln; optionaler LLM-Vision-Schritt |
| Standard | In der Standardliste von `--passes` enthalten, liefert Crawl-Ergebnisse aber nur, wenn eine Ziel-URL konfiguriert und Playwright mit Chromium verfügbar ist |
| Assessment-Typen | `application`; `service` nur, wenn für ein Hersteller-Portal vom Typ `saas` oder `hybrid` ein Crawl konfiguriert wurde |
| Tier | Alle Tiers (keine Lizenzsperre) |
| Quelle | `packages/@swao/module-app-assessment/src/passes/pass-10-dynamic.ts`, `.../passes/phase2/`, Crawler in `packages/swao/src/crawl/` |

## Wofür dieser Pass gedacht ist

Statische Passes lesen Code und Dokumente. Pass 10 betrachtet die Anwendung im laufenden Betrieb. Er beantwortet die Frage: „Was tut diese Anwendung tatsächlich im Browser, welche externen Hosts kontaktiert sie, und was sieht ein Benutzer auf dem Bildschirm?“

Typische Befunde sind Aufrufe von Analyse- oder Tracking-Diensten Dritter, ein fehlendes Cookie-Consent, HTTP-Fehler hinter der Oberfläche, die sichtbare Authentifizierungsschnittstelle sowie Formularfelder mit personenbezogenen Daten ohne die erwarteten Browser-Attribute. Diese Befunde fließen in die Souveränitäts- und Datenschutzsicht des Assessments ein (zum Beispiel das Übermittlungsrisiko nach Art. 44 DSGVO).

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Ziel-URL der laufenden Anwendung | Schlüssel `playwright-url-<app>` im SWAO-Credential-Vault | Für einen Live-Crawl erforderlich. Ein Hostname ohne Schema wird akzeptiert; `https://` wird automatisch ergänzt. |
| Benutzername und Passwort für die Anmeldung (optional) | Vault-Schlüssel `playwright-user-<app>` und `playwright-pass-<app>` | Sind beide vorhanden und ist kein `auth_type` gesetzt, verwendet SWAO die Formular-Anmeldung. Dieselben Zugangsdaten werden auch bei HTTP-Basic-Authentifizierung angeboten. |
| TOTP-Seed für MFA (optional) | Vault-Schlüssel `playwright-mfa-<app>` | Füllt bei der Anmeldung ein Einmalpasswort-Feld aus. |
| Chromium und das Playwright-Paket | Installation mit `swao install-playwright` | Ohne diese wird der Live-Crawl übersprungen (siehe unten). |
| Ein LLM-Provider (optional) | `providers.llm` in `.swao.yml` | Nur für den Vision-Schritt erforderlich. |

Hinterlegen Sie Zugangsdaten über die TUI-Einrichtung des Assessments oder mit `swao credential set <name> <value>`. Die älteren Schlüssel `crawl.target_url`, `crawl.username` und `crawl.password` in `.swao.yml` werden aus Gründen der Abwärtskompatibilität noch gelesen, sind im Schema aber als veraltet gekennzeichnet: Schreiben Sie keine Zugangsdaten in `.swao.yml`.

Nicht vertrauliche Crawl-Einstellungen können in der `.swao.yml` der App bleiben:

```yaml
crawl:
  auth_type: form          # none | basic | form
  max_turns: 60            # maximal besuchte Bildschirme (Standard 60)
  screenshot_quality: 80   # JPEG-Qualität 0-100 (Standard 80)
  viewport_width: 1280     # Browserbreite in Pixeln (Standard 1280)
  exclude_patterns: ["/logout", "/admin/delete"]
```

## So funktioniert der Pass

1. **Vorprüfungen.** Im paketierten Binary prüft SWAO, ob das Playwright-Paket und ein Chromium installiert sind. Falls nicht, gibt es eine Warnung aus und überspringt den Live-Crawl; der Vision-Fallback (Schritt 6) kann trotzdem laufen.
2. **Crawl-Konfiguration.** SWAO baut die Crawl-Konfiguration aus den Vault-Schlüsseln und dem Block `crawl:` auf. Ohne Ziel-URL wird der Live-Crawl übersprungen.
3. **Live-Crawl.** Ein Headless-Chromium öffnet die Ziel-URL, füllt die Warteschlange vorab aus `sitemap.xml` (begrenzt auf das Doppelte von `max_turns`), meldet sich an, falls Zugangsdaten vorhanden sind, und folgt Links derselben Herkunft, bis `max_turns` Bildschirme erfasst sind. Für jeden Bildschirm werden ein ganzseitiger JPEG-Screenshot, das DOM, ein Accessibility-Snapshot, das Netzwerkprotokoll und das Browser-Konsolenprotokoll aufgezeichnet.
4. **Parity-Baseline.** Jeder Bildschirm wird nach `apps/<app>/parity-baseline/<NNN-slug>/` geschrieben (`screenshot.jpg`, `dom.html`, `a11y.json`, `meta.json`).
5. **Regelauswertung.** Die Regeln der Phase 1 fassen den Crawl, Accessibility-Indikatoren und Konsolenfehler zusammen. Die Regeln der Phase 2 lesen `parity-baseline/` und werten externe Hosts, API-Endpunkte, HTTP-Fehler, Authentifizierungs-Endpunkte, Formularfelder mit personenbezogenen Daten, Skripte Dritter und Cookie-Consent aus. Alle Regeln sind deterministisch.
6. **Vision-Schritt (optional).** Ist ein LLM konfiguriert, werden bis zu `assessment.vision_max_screens` Screenshots (Standard 5) mit einem festen Prüfer-Prompt an das Modell gesendet. Das Modell liefert eine JSON-Liste von Befunden, je Befund entsteht ein Signal. Cloud-LLM-Konnektoren sind gesperrt, solange `assessment.allow_cloud_vision: true` nicht gesetzt ist, weil Screenshots angemeldeter Bildschirme personenbezogene Daten enthalten können. Ein lokaler Ollama-Konnektor ist immer erlaubt. Lief kein Live-Crawl, existiert aber eine frühere `parity-baseline/`, verwendet SWAO die gespeicherten Screenshots für den Vision-Schritt.
7. **Ergebnisse schreiben.** Die Pass-Datei wird nach `wsp/runs/<ts>/passes/10-dynamic.yaml` geschrieben. Ein fehlgeschlagener Crawl wird als Warnung protokolliert und hält das Assessment nicht an.

## Wie gemessen wird

Alle Signale von Pass 10 tragen `source: dynamic_analysis` und `category: application`.

| Signal | Bedeutung | Schweregrad | Ausgegeben, wenn |
|---|---|---|---|
| `DYN-01` (Crawl-Zusammenfassung) | Anzahl gecrawlter Bildschirme, externe Hosts, Accessibility-Indikatoren und Konsolenfehler | informational | Immer, wenn der Pass läuft |
| `DYN-09` Accessibility-Indikator | Bildschirme mit Accessibility-Problemen (die ersten fünf als Nachweis) | low | Mindestens ein Bildschirm zeigt einen Indikator (siehe Hinweis) |
| `DYN-11` Konsolenfehler | JavaScript-Einträge vom Typ `error` in der Browser-Konsole (die ersten fünf als Nachweis) | low | Mindestens ein Konsolenfehler |
| `DYN-02` Externe Hosts | Unterschiedliche kontaktierte externe Hosts (private und Loopback-Adressen ausgenommen) | high, wenn ein Host mit Ressourcentyp `fetch` aufgerufen wurde, sonst medium | Mindestens ein externer Host |
| `DYN-03` API-Oberfläche | Unterschiedliche zur Laufzeit beobachtete Fetch-Endpunktmuster | informational | Mindestens ein Endpunkt |
| `DYN-04` HTTP-Fehler | URLs mit Fehler-Statuscodes | high bei 5xx, medium bei 404, sonst low | Mindestens eine Fehlerantwort |
| `DYN-05` Formularfelder mit personenbezogenen Daten | Passwortfelder ohne `autocomplete="current-password"` oder `"new-password"`, E-Mail-Felder ohne `autocomplete="email"`, Felder mit Namen wie `dob`, `phone`, `address` oder `surname` ohne jedes `autocomplete` | medium | Mindestens ein Feld |
| `DYN-06` Skripte Dritter | Externe Skript-Hosts, eingeordnet anhand der Analytics-Sperrliste | high, wenn ein Host zu Analytics, Social Pixel, Werbung oder Tag-Manager gehört oder bei geladener Liste unbekannt ist; sonst medium | Mindestens ein externes Skript |
| `DYN-07` Authentifizierungsoberfläche | Aufrufe von Pfaden wie `/auth/`, `/login`, `/session`, `/token`, `/oauth`, `/oidc` und der Anteil der Bildschirme, die sie nutzen | low, wenn keine Auth-Aufrufe gesehen wurden; informational bei 100 % Abdeckung; medium darunter | Mindestens ein Bildschirm verarbeitet |
| `DYN-08` Cookie-Consent fehlt | Kein Consent-Banner (OneTrust, Cookiebot, Usercentrics, CookieYes oder generisches Consent-/Cookie-Markup) auf irgendeinem Bildschirm | medium (Konfidenz low) | Kein Consent-Element gefunden |
| `DYN-VIS-<screen>-<n>` | Ein Befund des Vision-Modells: `pii_exposure`, `missing_label`, `version_leakage`, `missing_consent`, `third_party_widget` oder `other` | Wie vom Modell geliefert | Vision-Schritt lief und lieferte Befunde |

Der Accessibility-Indikator ist eine Heuristik: Er zählt Knoten mit der Rolle `alert` im Accessibility-Snapshot und, falls keine vorhanden sind, Elemente mit `aria-invalid="true"` oder `role="alert"`. Er ist kein WCAG-Audit; der Signaltext empfiehlt für die Behebung ein spezialisiertes Werkzeug.

Zusätzlich schreibt der Pass Kennzahlen unter `assessment:` in die Pass-Datei: `screens_captured`, `crawl_duration_ms`, `external_hosts`, `external_host_count`, `a11y_violations_total`, `console_errors_total`, `api_endpoints_observed`, `http_errors_total`, `pii_form_fields_flagged`, `third_party_scripts_total`, `cookie_consent_present`, `vision_screens_analysed` und `vision_signals_emitted`.

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Playwright (`playwright`, `playwright-core`) | Steuert das Headless-Chromium | Apache-2.0 | Im SWAO-Build gebündelt | Live-Crawl wird mit Warnung übersprungen |
| Chromium-Browser | Rendert die Anwendung | Chromium-Lizenz (BSD-artig) | Optionaler Download über `swao install-playwright` | Live-Crawl übersprungen; Vision-Fallback nur auf gespeicherten Screenshots |
| Analytics-Sperrliste `controls/dynamic-analysis/analytics-domains.yaml` | 22 bekannte Domains für Analytics, Support-Chat, CDN, Fehler-Tracking, Social Pixel, Tag-Manager und Werbung | SWAO | Gebündelt | Alle externen Skripte werden mit medium bewertet |
| LLM-Provider mit Vision-Unterstützung | Prüfung der Screenshots | Abhängig vom Provider | Optional | Vision-Schritt übersprungen |
| Die Zielanwendung | Wird über das Netzwerk gecrawlt | - | Von Ihnen bereitgestellt | Crawl-Fehler wird protokolliert; Assessment läuft weiter |
| `js-yaml`, `zod` | YAML lesen und validieren | MIT | Gebündelt | - |

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/10-dynamic.yaml` | Pass-Kopf, Signale und Kennzahlen |
| `apps/<app>/parity-baseline/<NNN-slug>/screenshot.jpg`, `dom.html`, `a11y.json`, `meta.json` | Crawl-Artefakte je Bildschirm (bei jedem Live-Crawl überschrieben) |
| `apps/<app>/wsp/runs/<ts>/passes/10-dynamic-vision-screen-NN-call-1.yaml` | Prompt, unveränderte Modellantwort und Auswertungszahlen für jeden an das Vision-Modell gesendeten Bildschirm |

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| `--passes ...,dynamic,...` | Nimmt den Pass auf (er ist Teil der Standardliste) |
| `--no-crawl` | Überspringt den Live-Crawl; Vision auf gespeicherten Screenshots kann weiterhin laufen |
| Vault-Schlüssel `playwright-url-<app>`, `playwright-user-<app>`, `playwright-pass-<app>`, `playwright-mfa-<app>` | Ziel und Anmeldedaten |
| `crawl.auth_type`, `crawl.max_turns`, `crawl.screenshot_quality`, `crawl.viewport_width`, `crawl.exclude_patterns` | Crawl-Verhalten |
| `assessment.vision_max_screens` | Maximale Anzahl an das Vision-Modell gesendeter Screenshots (Standard 5) |
| `assessment.allow_cloud_vision: true` | Erlaubt das Senden von Screenshots an einen Cloud-LLM-Konnektor |
| `--skip-llm` | Schaltet den Vision-Schritt ab; Crawl und deterministische Regeln laufen weiterhin |
| `SWAO_DEBUG` | Gibt bei fehlgeschlagenem Crawl einen Stacktrace aus |

Bekannte Einschränkungen:

- Zwischen zwei Crawls gibt es keine visuelle Regressionsprüfung: Jeder Live-Crawl überschreibt `parity-baseline/`, und die ID `DYN-10` ist für einen künftigen Screenshot-Vergleich reserviert und wird nicht erzeugt.
- Läuft kein Live-Crawl, existiert aber eine gespeicherte `parity-baseline/` und ist ein LLM konfiguriert, führt der Fallback auch die Regeln der Phase 2 erneut auf dem gespeicherten DOM und den Netzwerkprotokollen aus. Diese Befunde beschreiben den früheren Crawl, nicht den aktuellen Zustand der Anwendung.
- Der Crawl erfasst höchstens `max_turns` Bildschirme, die von der Startseite und der Sitemap aus erreichbar sind; Abläufe hinter komplexen Interaktionen können fehlen.
- Die Erkennung personenbezogener Formularfelder stützt sich nur auf Feldnamen und `autocomplete`-Attribute.

Siehe auch [Anwendungs-Assessment](/de/assessment/application) und [Pass 11: Compliance-Bewertung](/de/passes/11-comp).
