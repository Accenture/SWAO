# Client LZ Policy Baseline (CLIENT_LZ_POLICY_BASELINE)

Diese Seite beschreibt das Community-Rahmenwerk `CLIENT_LZ_POLICY_BASELINE`, wie es mit SWAO ausgeliefert wird: was es ist, welche Richtlinien es mit welchen Vorgabewerten mitbringt und wie ein Kunde daraus seine eigenen Landing-Zone-Regeln macht. Der Ablauf (kopieren, bearbeiten, Health Check, bewerten, Nachweisreferenzen, veröffentlichen, den Vergleich lesen) steht im Leitfaden [Landing-Zone-Live-Bewertung](/de/assessment/landing-zone-live#client-lz-policy-baseline).

## Übersicht

| Eigenschaft | Wert |
|---|---|
| Rahmenwerk-ID | `CLIENT_LZ_POLICY_BASELINE` |
| Anzeigename | Client LZ Policy Baseline (German public agency default) |
| Herausgeber | SWAO-Vorgabe für eine deutsche Behörde; keine offizielle Veröffentlichung |
| SWAO-Katalogversion | 1.0.0 |
| Richtlinien und Kontrollen | 20 Richtlinien, je eine Kontrolle, in 11 Kategorien |
| Bewertungsarten | `app` (Anwendungsbewertung) und `lz` (Landing-Zone-Live-Bewertung) |
| Entschieden durch | Regeln auf dem Nachweis der Landing Zone; nie an ein LLM gesendet |
| Stufe | Community (kopieren, bearbeiten, prüfen); die Stufen der Auswertung stehen im Leitfaden |
| Ordner | `client-lz-policy-baseline` |

## Was es ist

Eine Kundenorganisation hat eigene Regeln für ihre Landing Zones, zum Beispiel „Daten dürfen nur in deutschen Rechenzentren gespeichert werden“ oder „verwaltetes PostgreSQL ist nicht erlaubt“. Die Baseline hält solche Regeln einmal fest, als normalisierte Richtlinien, die für jeden Anbieter gelten (T Cloud Public, AWS, Azure, STACKIT). SWAO misst jede Landing Zone an denselben Regeln und zeigt, wo ein Anbieter passt und wo nicht. SWAO liest nur; es setzt nie eine Richtlinie in einem Mandanten durch.

Die ausgelieferte Vorgabe ist ein Standardregelwerk für eine deutsche Behörde: Datenresidenz in Deutschland, an BSI C5 und IT-Grundschutz ausgerichtete Kontrollen, kundenverwaltete Schlüssel, standardmäßig keine öffentliche Erreichbarkeit, Protokollierung und Aufbewahrung sowie eine eingeschränkte Dienstliste, wo die Souveränität es verlangt. Sie ist vollständig befüllt und funktioniert so, wie sie ausgeliefert wird. Keine Behörde wird genannt, die Werte sind allgemein. Jeder Vorgabewert nennt entweder die SWAO-Kontrolle, aus der er abgeleitet ist, oder ist als **Annahme** (`assumption`) gekennzeichnet.

## Dateien

Was dieses Rahmenwerk unterscheidet, ist `policy-baseline.yaml`, die Datei mit den Richtlinien, die der Kunde bearbeitet. Der Ordner enthält:

| Datei | Inhalt |
|---|---|
| `framework-meta.yaml` | Identität und Geltungsbereich des Rahmenwerks |
| `controls.yaml` | Eine Kontrolle je Richtlinie: Text, Schweregrad, `maps_to` auf die Quellkontrollen, Behebung |
| `policy-baseline.yaml` | Die Richtlinien: Art, Kategorie, Kontrolle, `state`, `params`, `default_source`. **Diese Datei bearbeitet der Kunde** in seiner Kopie im Workspace |
| `service-controls.yaml` | Fähigkeits-Tags auf `CPB-*`-Kontrollen, für die Ampelspalte je Dienst |
| `policy-guidance.yaml` | Je Richtlinie die entscheidende Frage und die Optionen mit Vor- und Nachteilen und einer Quelle, für die geführte Beratung (gelesen aus der Kopie, die SWAO ausliefert, nie aus der Kundenkopie) |
| `README.md` | Kopieren, bearbeiten und prüfen; alle angenommenen Vorgabewerte |

## Richtlinienarten

Jede Richtlinie hat eine Art mit eigenen Parametern. Ein Kunde ergänzt nur Richtlinien dieser Arten; eine neue Art braucht ein SWAO-Release.

| Kategorie | Art | Parameter |
|---|---|---|
| `data_residency` | `region_residency` | `allowed_countries` (ISO 3166-1 alpha-2 oder `EU`), `allowed_operator_jurisdictions`, `forbid_exposure`, `required_certifications` |
| `service_control` | `service_deny`, `service_allow_list` | `capabilities` (SWAO-Fähigkeits-Tags) |
| `encryption` | `encryption_at_rest` | `min_key_custody` (`provider-managed`, `customer-managed`, `byok`, `hyok`), `applies_to` |
| `encryption` | `encryption_in_transit` | `min_tls_version` (`"1.2"` oder `"1.3"`, in Anführungszeichen), `applies_to` |
| `network_exposure` | `no_public_exposure` | `allow_capabilities` |
| `network_exposure` | `no_open_admin_ingress` | `ports`, `forbidden_sources` (CIDR) |
| `identity` | `privileged_mfa` | keine |
| `identity` | `credential_age` | `max_age_days` |
| `logging` | `audit_trail` | `all_regions` |
| `logging` | `log_retention` | `min_days` |
| `tagging` | `required_tags` | `keys` |
| `availability` | `min_availability_zones` | `min` |
| `resilience` | `backup_configured` | `applies_to` |
| `cost` | `budget_alerts` | `required` |
| `portability` | `documented_exit` | keine |

## Ausgelieferte Richtlinien

| Richtlinie | Art | Vorgabestatus | Vorgabeparameter | Quelle der Vorgabe |
|---|---|---|---|---|
| CPB-RES-01 | `region_residency` | enabled | `allowed_countries: [DE]` | BSI_C5_DAT-02, BSI_OPS22_A3; teilweise Annahme |
| CPB-RES-02 | `region_residency` | enabled | `allowed_operator_jurisdictions: [EU-entity]`, `forbid_exposure: [us_cloud_act, fisa_702]` | SWAO-Souveränitätsprüfung nach BSI C5; teilweise Annahme |
| CPB-RES-03 | `region_residency` | enabled | `required_certifications: [BSI_C5]` | BSI_C5_COM-03; teilweise Annahme |
| CPB-SVC-01 | `service_deny` | disabled | `capabilities: [managed_llm, ml_inference, ml_training, ml_speech, ml_translation, ml_vision, ml_nlp]` | Annahme |
| CPB-SVC-02 | `service_allow_list` | disabled | Beispiel-Positivliste mit 26 Fähigkeiten (in der README aufgeführt) | Annahme |
| CPB-SVC-03 | `service_deny` | disabled | `capabilities: [postgresql]` | Annahme |
| CPB-ENC-01 | `encryption_at_rest` | enabled | `min_key_custody: customer-managed`, `applies_to: [object_storage, block_storage, file_storage, postgresql, mysql, nosql_database]` | BSI_C5_CRY-01, BSI_C5_CRY-02, BSI_CON1_A2, BSI_CON1_A4; teilweise Annahme |
| CPB-ENC-02 | `encryption_in_transit` | enabled | `min_tls_version: "1.2"`, `applies_to: [load_balancer, api_gateway, cdn]` | BSI_C5_PI-03; teilweise Annahme |
| CPB-NET-01 | `no_public_exposure` | enabled | `allow_capabilities: [load_balancer, waf, api_gateway]` | BSI_C5_COS-01, BSI_NET11_A2 |
| CPB-NET-02 | `no_open_admin_ingress` | enabled | `ports: [22, 3389]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` | BSI_C5_COS-02, BSI_C5_COS-03, BSI_NET32_A1; teilweise Annahme |
| CPB-NET-03 | `no_open_admin_ingress` | enabled | `ports: [1433, 3306, 5432, 6379, 27017]`, `forbidden_sources: ["0.0.0.0/0", "::/0"]` | Quellen von CPB-NET-02, BSI_APP43_A1; teilweise Annahme |
| CPB-IAM-01 | `privileged_mfa` | enabled | keine | BSI_C5_IDM-02 |
| CPB-IAM-02 | `credential_age` | enabled | `max_age_days: 90` | BSI_C5_IDM-05, BSI_C5_CRY-03; teilweise Annahme |
| CPB-LOG-01 | `audit_trail` | enabled | `all_regions: true` | BSI_C5_OPS-06, BSI_C5_SIM-01, BSI_DER1_A2 |
| CPB-LOG-02 | `log_retention` | enabled | `min_days: 180` | Quellen von CPB-LOG-01; teilweise Annahme |
| CPB-TAG-01 | `required_tags` | enabled | `keys: [owner, data-classification]` | BSI_C5_OPS-04, BSI_C5_DAT-01; teilweise Annahme |
| CPB-AVL-01 | `min_availability_zones` | enabled | `min: 2` | BSI_C5_AVL-03; teilweise Annahme |
| CPB-BCK-01 | `backup_configured` | enabled | `applies_to: [block_storage, postgresql, mysql, nosql_database, file_storage]` | BSI_C5_AVL-04, BSI_CON3_A2 |
| CPB-COST-01 | `budget_alerts` | enabled | `required: true` | Annahme |
| CPB-PRT-01 | `documented_exit` | enabled | keine (immer ein manueller Nachweis) | BSI_C5_PSS-01, BSI_C5_BCP-02 |

Die Kontroll-IDs in der Quellenspalte sind SWAO-Paraphrasen von BSI C5:2020 und BSI IT-Grundschutz 2023; Prüfer vergleichen mit dem offiziellen Text. „Teilweise Annahme“ heißt, dass ein Wert der Zeile keine Quelle im Repository hat (zum Beispiel die Portliste, 90 Tage, 180 Tage oder die TLS-Untergrenze 1.2). Die README des Rahmenwerks listet jeden angenommenen Wert; die Baseline-Übersicht der Publikation listet jede Richtlinie, deren Vorgabewert eine Annahme ist. Annahmen sind akzeptierte Vorgabewerte, keine offiziellen Anforderungen: Prüfen Sie sie für Ihre Organisation.

CPB-SVC-01 bis CPB-SVC-03 werden deaktiviert ausgeliefert. Es sind Beispielmengen: Schalten Sie CPB-SVC-03 für das Beispiel „verwaltetes PostgreSQL ist nicht erlaubt“ ein.

## Allgemeine Beispiele

**Daten nur in deutschen Rechenzentren.** Das ist die ausgelieferte Vorgabe von CPB-RES-01 (`allowed_countries: [DE]`). In einer Landing-Zone-Live-Bewertung lässt eine genutzte Region außerhalb Deutschlands die Richtlinie scheitern, und jeder Dienst, der in einer nicht deutschen Region angeboten wird, ist in der Ampelspalte der Baseline rot. Mit dem Wert `[EU]` sind die 27 EU-Mitgliedstaaten zulässig.

**Verwaltetes PostgreSQL verboten.** Setzen Sie `state: enabled` bei CPB-SVC-03 (`capabilities: [postgresql]`). Das Angebotsurteil ist `READY`, wenn PostgreSQL in der Landing Zone eingeschränkt oder nicht angeboten ist, und `READY_WITH_CHANGES`, wenn es aktiviert ist; die Bestandsprüfung scheitert, wenn eine PostgreSQL-Instanz bereitgestellt ist. Eine Anwendung, die PostgreSQL braucht, erhält `BLOCKED_BY_POLICY` mit dem Nachweis `baseline:CPB-SVC-03` und ein `GAP` auf der Kontrolle.

**Eine eigene Regel.** Eine Richtlinie einer vorhandenen Art mit einer ID der Form `X-<PREFIX>-<CAT>-NN`, jedem Parameter ihrer Art und einer passenden Kontrolle in `controls.yaml`:

```yaml
  - id: X-ORG-TAG-01
    kind: required_tags
    category: tagging
    control: X-ORG-TAG-01
    state: enabled
    params:
      keys: [kostenstelle]
    default_source: "Interner Tagging-Standard"
```

## Wie SWAO die Kontrollen entscheidet

Die Kontrollen dieses Rahmenwerks werden nie an ein LLM gesendet. In einer Landing-Zone-Live-Bewertung erhält jede aktivierte Richtlinie je Scope ein Angebotsurteil und einen Bestandsstatus. In einer Anwendungsbewertung entscheidet Pass 11 (Compliance-Bewertung) jede Kontrolle nach Regeln aus dem Nachweis der Landing Zone, den der Nutzer gewählt hat (statischer Katalog oder Live-Ergebnisse): `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` oder `N_A`, das schlechteste Ergebnis über die Ziele oder Scopes, wobei die gereihten Beiträge erhalten bleiben. Der [Leitfaden](/de/assessment/landing-zone-live#client-lz-policy-baseline) erklärt beides.

## So aktivieren Sie es

Kopieren Sie den Ordner `client-lz-policy-baseline` aus dem [GitHub-Repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) nach `wsp/inputs/catalogs/community/client-lz-policy-baseline/` im Workspace. Bearbeiten Sie `policy-baseline.yaml` in dieser Kopie mit einem Texteditor oder mit einem KI-Chat oder Agenten (zum Beispiel SWAO Chat). Für eine zweite Baseline kopieren Sie den Ordner unter einem anderen Namen und geben ihm eine eigene ID (`framework.id` in `framework-meta.yaml`, `regime_meta.id` in `controls.yaml`, `framework:` in `policy-baseline.yaml` und `service-controls.yaml`); `baseline_of` bleibt. Danach:

```bash
swao framework list
swao health-check
# Landing-Zone-Live-Bewertung
swao assess --type landing-zone-live --lz otc-prod --frameworks client-lz-policy-baseline
# Anwendungsbewertung
swao regime-select --app app-crm-01 --regimes CLIENT_LZ_POLICY_BASELINE
swao assess --app app-crm-01 --lz-cat-targets otc:eu-de
```

## Geführte Beratung über MCP (Enterprise)

Ein MCP-Client (SWAO Chat, Claude Desktop, Claude Code, Kilo, Cursor oder VS Code) führt den Kunden und seine Stakeholder mit dem Prompt `swao_baseline_consult` durch die Baseline, auf Wunsch je Kategorie (zum Beispiel `logging`). Je Richtlinie erklärt er, was sie bedeutet, stellt die entscheidende Frage, zeigt die Optionen mit Vor- und Nachteilen und Quellen und auf Wunsch die Wirkung eines Kandidatenwerts auf die gespeicherten Ergebnisse der Landing-Zone-Live-Bewertung (Zähler je Landing Zone, neu ausgewertet aus dem letzten Lauf, kein neuer Live-Abruf). Danach schlägt er die Änderung als Diff von `policy-baseline.yaml` vor.

Nichts wird geschrieben, bevor der Benutzer bestätigt. Der Client fragt in seinem eigenen Dialog, wenn er MCP-Elicitation unterstützt; ein Client ohne diese Funktion schreibt nur, wenn der Workspace mit `mcp.baseline_write: client-approval` in `.swao.yml` zustimmt (`disabled` schaltet das Schreiben ab). SWAO legt eine Sicherung der vorherigen Datei unter `wsp/backups/policy-baseline/` ab, prüft das Ergebnis mit den Regeln des Health Checks und protokolliert das Schreiben nur mit Zählern. Eine optionale kurze Begründung je Wert steht als Entscheidungsdatensatz in der Datei (`policy-baseline.yaml` Schema 0.2). Der Beratungstext ist ein Entwurf, der noch geprüft wird; er ist keine rechtliche oder offizielle Beratung.

## Wichtige Hinweise

- Die ausgelieferte Baseline ist eine allgemeine Vorgabe, keine offizielle Veröffentlichung einer Behörde. Sie ersetzt weder ein Audit noch eine Rechtsberatung.
- Eine Kunden-Baseline sind Workspace-Daten: Sie liegt in der Kopie im Workspace des Kunden und wird nie gebündelt oder veröffentlicht.
- SWAO aktualisiert die Kopie des Kunden nie (Entscheidung des Owners vom 8.11.2026): Es gibt keine automatische und keine befehlsgesteuerte Aktualisierung. Der Health Check meldet eine veraltete Kopie; eine neuere Version wird von Hand aus dem GitHub-Repository übernommen.
- Ergebnisse von Richtlinien enthalten Zähler, pseudonymisierte Bezeichnungen und Nachweisreferenzen; native Ressourcen-IDs und Tag-Werte erreichen nie eine Publikation.
- Sind mehrere Rahmenwerke gewählt, werden ihre Anforderungen an die Datenresidenz als Vereinigung zusammengeführt; ein Rahmenwerk, das `EU` akzeptiert, erweitert daher eine Regel „nur Deutschland“. Der Block zur Herkunft der Anforderungen in der Publikation zeigt, welches Rahmenwerk welchen Wert beigetragen hat.
