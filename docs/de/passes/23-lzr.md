# Pass 23: Landing-Zone-Bereitschaft (LZR)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 23 |
| Schlüssel | Aufruf mit `--lzr <landingZoneId>` (nicht über `--passes` auswählbar) |
| Signal-Präfix | `LZR` |
| Typ | Deterministisch (Regel-Engine auf Terraform-State oder JSON-Plänen; kein LLM) |
| Standard | Optional: läuft nur mit `--lzr` |
| Assessment-Typen | `application` |
| Tier | Alle Tiers für eine einzelne App; die Portfolio-Variante (`--portfolio --lzr`) ist eine Enterprise-Funktion |
| Quelle | `packages/@swao/module-app-assessment/src/passes/pass-23-lzr.ts`, Prüfkatalog `controls/landing-zone-checks-catalogue.yaml` |

## Wofür dieser Pass gedacht ist

Pass 23 beantwortet die Frage: „Ist die Ziel-Landing-Zone tatsächlich bereit, diese Anwendung aufzunehmen, oder fehlt etwas, das die Migration blockieren würde?“

Er liest Terraform-State-Dateien oder JSON-Pläne und prüft, ob die verwalteten Dienste und Einstellungen vorhanden sind, die die Anwendung benötigt (zum Beispiel ein Kubernetes-Cluster, eine verwaltete PostgreSQL-Instanz oder Verschlüsselung im Ruhezustand). Das Ergebnis ist ein Urteil `ready`, `advisory` oder `blocked` mit Listen der Blocker und Warnungen sowie Hinweisen zur Behebung.

Pass 23 unterscheidet sich vom **Landing-Zone-Katalogabgleich**, der die von einer Anwendung benötigten Dienste mit dem veröffentlichten Dienstkatalog eines Cloud-Providers für eine Region vergleicht. Der Katalogabgleich läuft innerhalb eines Anwendungs-Assessments, wenn `assessment.landing_zone.provider` und `region` gesetzt sind, oder mit `--lz-cat-provider`, `--lz-cat-region` bzw. `--lz-cat-targets`. Siehe [Landing-Zone-Assessment](/de/assessment/landing-zone).

## Was Sie bereitstellen müssen

| Eingabe | Ort | Hinweise |
|---|---|---|
| Terraform-State- oder Plan-Dateien | `apps/<app>/wsp/inputs/terraform/*.tfstate` oder `*.tfplan` | Mindestens eine Datei ist erforderlich, sonst endet der Befehl mit einem Fehler. Eine `.tfplan`-Datei muss den Plan im JSON-Format enthalten (`terraform show -json <plan> > <name>.tfplan`); die Binärdatei, die `terraform plan -out` schreibt, kann nicht gelesen werden. |
| Landing-Zone-ID | `--lzr <landingZoneId>` | Wird im Ergebnis vermerkt und zur Ableitung des Ziel-Providers verwendet, zum Beispiel `lz-stackit-prod` oder `lz-aws-eu-central-1` |
| Ziel-Provider (optional) | `assessment.landing_zone.provider` in der `.swao.yml` oder `--lz-cat-provider` | Wird verwendet, wenn die Landing-Zone-ID keinen Provider nennt |

Nummerierte Kopien aus der Ingestion (zum Beispiel `12 terraform-prod.tfstate`) werden zusammengeführt; die Datei ohne Nummernpräfix hat Vorrang.

## So funktioniert der Pass

1. **Eingaben finden und lesen.** Dateien `.tfstate` und `.tfplan` in `wsp/inputs/terraform/` auflisten. State-Dateien werden als Terraform-State gelesen. Plan-Dateien werden im JSON-Planformat gelesen (`planned_values.root_module` einschließlich verschachtelter Child-Module; nur verwaltete Ressourcen); eine Plan-Datei, die bereits ein State-Dokument enthält, wird als State gelesen. Nicht lesbare Dateien, etwa ein binärer Plan, erscheinen mit Begründung in `input_files_unparsed` (bei einem binären Plan mit dem Hinweis, ihn mit `terraform show -json` zu exportieren).
2. **Ressourcen indizieren.** Alle Ressourcentypen und Instanzen aus den gelesenen Dateien sammeln.
3. **Ziel-Provider ableiten.** Der Provider wird in dieser Reihenfolge bestimmt: aus der Landing-Zone-ID (eine exakte Provider-ID aus dem SWAO-Cloud-Anbieterkatalog oder ein Herstellerkürzel wie `stackit`, `aws`, `azure`, `gcp`, `otc`, `ionos` oder `hetzner` in einer ID wie `lz-aws-eu-central-1`; `aws` zusammen mit `esc`, `eusc` oder `sovereign` steht für die AWS European Sovereign Cloud), aus `--lz-cat-provider` oder `assessment.landing_zone.provider` und aus dem Provider-Präfix, das die meisten Ressourcen der Terraform-Eingabe tragen (zum Beispiel `aws_`, `azurerm_`, `google_`, `stackit_`). Nennt keine dieser Quellen einen Provider, verwendet SWAO `stackit_de_sovereign` und gibt eine Warnung aus. Die Quelle wird als `provider_id_source` vermerkt (`landing_zone_id`, `configuration`, `terraform_resources` oder `default`).
4. **Prüfungen auswählen.** Den Prüfkatalog laden (Version `2026-04`, 10 Prüfungen) und die Prüfungen für den abgeleiteten Provider sowie die generischen Prüfungen übernehmen.
5. **Modus wählen.**
   - **Zielmodus:** Die Eingabe enthält Ressourcen des Ziel-Providers (Ressourcentypen mit dem Präfix des Providers, zum Beispiel `stackit_`). Jede Prüfung sucht nach ihren Terraform-Ressourcentypen.
   - **Quellmodus:** Die Eingabe enthält keine Ressourcen des Ziel-Providers, aber Ressourcen der Quellumgebung, etwa `docker_container`. SWAO leitet die genutzten Dienste ab (zum Beispiel PostgreSQL aus dem Image-Namen oder aus Umgebungsvariablen `POSTGRES_*`) und gleicht sie mit den Dienstcodes jeder Prüfung ab.
6. **Auswerten.** Jede Prüfung endet mit `pass`, `fail`, `not_applicable` oder `not_evaluated` (siehe unten). Eine Prüfung, die sich aus der Terraform-Eingabe nicht entscheiden lässt, wird nie stillschweigend verworfen: Sie erscheint mit Begründung in `checks_not_evaluated`.
7. **Urteil.** Jede fehlgeschlagene Blocker-Prüfung macht das Gesamturteil zu `blocked`. Andernfalls macht jede fehlgeschlagene Warnprüfung es zu `advisory`. Andernfalls lautet es `ready`.

## Wie gemessen wird

### Der Prüfkatalog

| Prüf-ID | Name | Kategorie | Schweregrad | Provider | Terraform-Ressourcentypen | Dienstcodes der Quelle |
|---|---|---|---|---|---|---|
| `LZC-STACKIT-01` | SKE (Sovereign Kubernetes Engine) provisioned | service | blocker | `stackit_de_sovereign` | `stackit_ske_cluster` | `kubernetes`, `container_runtime` |
| `LZC-STACKIT-02` | PostgreSQL Flex provisioned | service | blocker | `stackit_de_sovereign` | `stackit_postgresflex_instance`, `stackit_postgresql_instance` | `postgresql` |
| `LZC-STACKIT-03` | Redis (Object Cache) provisioned | service | warning | `stackit_de_sovereign` | `stackit_redis_instance`, `stackit_objectcache_instance` | `redis` |
| `LZC-STACKIT-04` | BSI C5 encryption-at-rest enabled on managed storage | compliance | blocker | `stackit_de_sovereign` | `stackit_objectstorage_bucket`, `stackit_postgresflex_instance` | - |
| `LZC-STACKIT-05` | Object Storage provisioned | service | warning | `stackit_de_sovereign` | `stackit_objectstorage_bucket` | `object_storage`, `s3` |
| `LZC-GEN-01` | Egress to required external endpoints allowed | network | blocker | all | `azurerm_network_security_rule`, `aws_security_group_rule`, `google_compute_firewall` | - |
| `LZC-GEN-02` | TLS termination for ingress traffic | policy | warning | all | - | - |
| `LZC-GEN-03` | Private network (no public IP on data tier) | network | blocker | all | - | - |
| `LZC-GEN-04` | vCPU / compute quota sufficient for workload | quota | warning | all | - | - |
| `LZC-GEN-05` | Object storage quota sufficient | quota | warning | all | - | - |

Die Namen der Prüfungen stammen unverändert aus dem Katalog.

### Ergebnisse der Prüfungen

| Modus | Regel |
|---|---|
| Ziel | `pass`, wenn mindestens einer der Ressourcentypen der Prüfung (gefiltert auf das Provider-Präfix) in der Eingabe vorkommt. Für `LZC-STACKIT-04` muss zusätzlich jeder Object-Storage-Bucket `server_side_encryption.enabled` haben, sonst `fail`. Wird nichts gefunden, ist die Prüfung `fail`, für Blocker- und Warnprüfungen gleichermaßen. `LZC-GEN-03` wird anhand der Attribute verwalteter Datenbankressourcen entschieden: `fail`, wenn eine davon einen öffentlichen Endpunkt hat (zum Beispiel `publicly_accessible = true` bei AWS, `public_network_access_enabled = true` bei Azure, `ipv4_enabled` bei Cloud SQL oder eine ACL mit `0.0.0.0/0` bei STACKIT-Datenbankinstanzen), `pass`, wenn alle gefundenen privat sind. Eine Prüfung ohne Ressourcentypen für diesen Provider, eine Prüfung, die einen IaC-Policy-Scan benötigt (`LZC-GEN-02`), die Kontingentprüfungen (`LZC-GEN-04`, `LZC-GEN-05`) und `LZC-GEN-03` ohne jede Datenbankressource sind `not_evaluated`, jeweils mit Begründung. |
| Quelle | `fail` für eine Blocker- oder Warnprüfung, deren Dienstcode in der Quellumgebung erkannt wurde (der Dienst muss im Ziel bereitgestellt werden); `not_applicable`, wenn keiner ihrer Dienstcodes erkannt wurde; `not_evaluated` für Prüfungen ohne Dienstcodes, weil sie Ressourcen der Ziel-Landing-Zone benötigen. |

### Signale

Signale werden in der Reihenfolge ihrer Entstehung mit `LZR-01`, `LZR-02` usw. nummeriert.

| Inhalt des Signals | Schweregrad | Ausgegeben, wenn |
|---|---|---|
| Dienst der Quellumgebung erkannt (mit `implies: service_dep:<code>`) | informational | Quellmodus, je erkanntem Dienst |
| Prüfung bestanden, mit den gefundenen Ressourcen | positive | Eine Prüfung besteht |
| Erforderliche Ressource nicht gefunden, mit der Beschreibung der Prüfung | high | Eine Blocker-Prüfung schlägt fehl |
| „advisory, requirement not met“, mit der Beschreibung der Prüfung | medium | Eine Warnprüfung schlägt fehl |

Fehlgeschlagene Blocker-Prüfungen erscheinen außerdem in `lzrResult.blockers` und fehlgeschlagene Warnprüfungen in `lzrResult.warnings`, beide mit Behebungstext. Dienstprüfungen stehen in `lzrResult.service_checks` mit dem Status `ready`, `blocked` oder `warning`; Policy- und Netzwerkprüfungen in `policy_checks` und `network_checks` mit dem Status `pass`, `fail` oder `skipped` (nicht ausgewertet, mit der Begründung als Notiz). `quota_checks` bleibt leer, weil Kontingente nicht im Terraform-State stehen.

## Module, Werkzeuge und externe Dienste von Drittanbietern

| Name | Zweck | Lizenz | Gebündelt oder optional | Verhalten bei Fehlen oder offline |
|---|---|---|---|---|
| Terraform-State-Parser (`@swao/module-iac-scan`) | Liest das JSON von `.tfstate` | SWAO | Gebündelt | - |
| JSON-Plan-Leser (in Pass 23) | Liest `.tfplan`-Dateien im Format von `terraform show -json` | SWAO | Gebündelt | - |
| Prüfkatalog für Landing Zones | Definition der Prüfungen | SWAO | Gebündelt | Pass kann nicht laufen |
| `js-yaml`, `zod` | Katalog lesen und validieren | MIT | Gebündelt | - |

Pass 23 ruft weder Terraform noch eine Cloud-API noch das Netzwerk auf. Die State-Datei erzeugen Sie selbst (zum Beispiel mit `terraform state pull`).

Im Portfolio-Modus (`swao assess --portfolio --lzr <id>`, Enterprise) wählt SWAO je App einen Adapter: Snapshot-Dateien `lz-meshstack-snapshot.json`, `lz-aws-snapshot.json` oder `lz-azure-snapshot.json` in `wsp/inputs/terraform/` werden von den Adaptern für meshStack, AWS bzw. Azure ausgewertet; andernfalls wird der oben beschriebene Terraform-Weg genutzt. Die Zusammenfassung wird als `lzr-summary.json` in das Portfolio-Laufverzeichnis geschrieben.

## Ausgaben

| Datei | Inhalt |
|---|---|
| `apps/<app>/wsp/runs/<ts>/passes/23-lzr.yaml` | Pass-Kopf, Signale `LZR-NN`, Zusammenfassung unter `assessment` (`provider_id`, `provider_id_source`, Modus, Anzahl der Eingabedateien, `input_files_unparsed`, gefundene Ressourcentypen, `checks_run`, `checks_not_evaluated` mit Begründungen, `blockers_count`, `warnings_count`, Urteil) und das vollständige `lzrResult` |
| `lzr-summary.json` (nur Portfolio-Lauf) | Anzahl der Urteile und ein Eintrag je App |

Das Run-Manifest vermerkt den verwendeten Eingabetyp (`terraform`, `snapshot`, `live_api` oder `catalogue`).

## Konfiguration und Einschränkungen

| Einstellung | Wirkung |
|---|---|
| `--lzr <landingZoneId>` | Führt Pass 23 innerhalb der Pass-Schleife aus, nach den statischen Passes, DYNAMIC, SCOPE und MALWARE und vor COMP und SYNTH, damit [Pass 09 SYNTH](/de/passes/09-synth) das Urteil desselben Laufs verwendet |
| `--lz-cat-provider`, `assessment.landing_zone.provider` | Nennen den Ziel-Provider, wenn die Landing-Zone-ID ihn nicht enthält |
| `--lzr-fail-on-blocked` | Beendet mit Exit-Code 4, wenn das Urteil `blocked` lautet (nachdem alle Passes gelaufen sind) |
| `--portfolio --lzr <id>` | Bereitschaft über das gesamte Portfolio (Enterprise) |

`lzr` in `--passes` oder in einer Linse führt diesen Pass nicht aus; ohne `--lzr` gibt SWAO einen Hinweis aus, dass Pass 23 `--lzr <landingZoneId>` benötigt.

Bekannte Einschränkungen:

- Anbieterspezifische Prüfungen gibt es nur für STACKIT (`LZC-STACKIT-01` bis `-05`). Für andere Provider gelten nur die generischen Prüfungen, und davon lassen sich nur `LZC-GEN-01` (Security-Group- und Firewall-Regeln für AWS, Azure und Google Cloud) und `LZC-GEN-03` (Datenschicht) aus der Terraform-Eingabe entscheiden.
- `LZC-GEN-02` benötigt einen IaC-Policy-Scan, `LZC-GEN-04` und `LZC-GEN-05` benötigen Kontingentdaten; sie sind in diesem Pass immer `not_evaluated`.
- Binäre Plan-Dateien aus `terraform plan -out` werden nicht gelesen; exportieren Sie sie vorher als JSON.
- Snapshot-Dateien (`lz-*-snapshot.json`) werden nur im Portfolio-Modus gelesen.

Siehe auch [Landing-Zone-Assessment](/de/assessment/landing-zone) und [Portfolio](/de/portfolio).
