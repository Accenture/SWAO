# Pass 02: Zustandsanalyse (STATE)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 02 |
| Schlüssel | `state` |
| Pass-Name in der Ausgabe | `state_analysis` |
| Signal-Präfix | `STATE` |
| Typ | Deterministisch (Regel-Engine), kein LLM |
| Standard | Aktiv |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs). Bei `service` übersprungen (ohne Quellcode keine Zustandsanalyse). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Zustandslose Komponenten lassen sich durch erneutes Deployment umziehen. Zustandsbehaftete Komponenten (Datenbanken, Queues, Session-Speicher) erfordern eine Datenmigration, einen Umstellungsplan und Aufmerksamkeit für Wiederherstellungsziele. Pass 02 beantwortet die Frage: **„Welchen Zustand hält diese Anwendung, und wo liegt der Single Point of Failure?“**

Er ermittelt die primäre Datenbank, die Nutzung von Redis als Cache und Job-Queue, das Session-Modell (zustandslose Tokens oder serverseitige Sessions) und ob die Bereitstellungstopologie ein Einzelknoten-Setup ist, das Anforderungen an die operative Resilienz wie DORA widerspricht.

## Was Sie bereitstellen müssen

- Den Quellcode der Anwendung (`source.path`, `source.vcs.url` oder `--source-path`).
- Der Pass liest ausschließlich: `package.json` und `prisma/schema.prisma` im Wurzelverzeichnis, `docker-compose.yml` im Wurzelverzeichnis oder in `docker/` sowie die Verzeichnisse `k8s/` und `helm/` im Wurzelverzeichnis.

Es werden weder Zugangsdaten noch ein LLM benötigt.

## Wie der Pass arbeitet

1. **Primäre Datenbank.** Existiert `prisma/schema.prisma`, wird der Wert von `provider` als Datenbank-Engine übernommen und die Prisma-Version aus `package.json` gelesen. Ist nur der Prisma-Client als Abhängigkeit vorhanden, meldet der Pass, dass der Datenbanktyp nicht bestätigt werden kann.
2. **Cache und Queue.** Redis wird über `@keyv/redis`, `ioredis` oder `redis` erkannt, eine Job-Queue über `bull`, `@nestjs/bull` oder `bullmq`. Läuft eine Queue auf Redis, wird Redis-Persistenz (AOF plus RDB) als erforderlich markiert.
3. **Session-Modell.** `@nestjs/jwt`, `jsonwebtoken` oder `jose` ohne Session-Bibliothek bedeutet zustandslose JWT-Authentifizierung. `express-session` oder `koa-session` bedeutet serverseitige Sessions, die als zustandsbehaftete Komponente migriert werden müssen.
4. **Topologie.** `k8s/` oder `helm/` im Wurzelverzeichnis bedeutet Kubernetes mit horizontaler Skalierung. Eine `docker-compose.yml` im Wurzelverzeichnis oder in `docker/` ohne Kubernetes-Manifeste gilt als Einzelknoten-Compose-Bereitstellung und damit als Single Point of Failure.

## Wie gemessen wird

| Signal | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| `STATE-01` | Prisma-Schema vorhanden oder Prisma-Client in den Abhängigkeiten | informational | Primärer zustandsbehafteter Speicher und ORM (Konfidenz hoch mit Schema, mittel ohne) |
| `STATE-02` | Redis- oder Bull/BullMQ-Abhängigkeit gefunden | medium (Queue auf Redis), low (nur Cache) | Queue-Jobs gehen bei einem Redis-Neustart verloren, sofern keine AOF-plus-RDB-Persistenz aktiv ist; ein Risiko für das Recovery Point Objective (RPO) |
| `STATE-03` | Immer | informational | Session-Modell: `jwt_stateless`, `server_session` oder `unknown` |
| `STATE-04` | Immer | high (Einzelknoten-Compose), informational (Kubernetes oder unbekannt) | Bewertung des Single Point of Failure im Hinblick auf Resilienzanforderungen |

Die Outcomes folgen dem Schweregrad: `informational`-Signale sind `neutral`, Signale von `low` bis `high` sind `negative`.

**Wie die Ergebnisse in spätere Passes einfließen.** [Pass 01 (INV)](/de/passes/01-inv) verweist über seine `implies`-Tags auf `STATE-02` und `STATE-04`. `STATE-04` mit hohem Schweregrad ist ein typischer Input für Resilienz-Controls, die Pass 11 (COMP) bewertet, wenn Frameworks wie DORA in `assessment.regimes_active` aktiv sind, sowie für die 7R-Bewertung in [Pass 09 (SYNTH)](/de/passes/09-synth). Signale mit hohem Schweregrad werden außerdem zu Einträgen in den abgeleiteten Findings und im Risikoregister.

Der `assessment`-Block enthält `primary_db`, `orm`, `cache_engine`, `queue_engine`, `redis_persistence_configured` (immer `false`, da der Pass keine Laufzeitkonfiguration sieht), `session_type`, `deployment_type` (`kubernetes`, `single_node_compose`, `unknown`), `spof_risk` und eine Liste `stateful_components`.

## Drittanbieter-Module und Werkzeuge

Keine. Der Pass nutzt eingebautes Dateilesen, JSON-Parsing und reguläre Ausdrücke.

## Ausgaben

- `wsp/runs/<ts>/passes/02-state.yaml` mit Kopf (`id: 2`, `name: state_analysis`, `signal_prefix: STATE`), Signalen und dem `assessment`-Block.

## Konfiguration und Einschränkungen

**Konfiguration**

- Schlüssel für den Quellcode-Ort wie bei [Pass 01](/de/passes/01-inv); `--passes state` führt den Pass allein aus.

**Einschränkungen und bekannte Lücken**

- Die Erkennung beschränkt sich auf das Node.js-Ökosystem (`package.json`) und Prisma. Zustandsbehaftete Komponenten in anderen Sprachen oder ORMs werden nicht erkannt.
- `STATE-04` prüft nur zwei feste Compose-Pfade (`docker-compose.yml` und `docker/docker-compose.yml`). [Pass 01](/de/passes/01-inv) sucht drei Verzeichnisebenen tief und nach mehr Dateinamensmustern; die beiden Passes können daher zu unterschiedlichen Ergebnissen kommen, ob Compose vorhanden ist.
- Redis-Persistenzeinstellungen werden nicht gelesen; `redis_persistence_configured` ist immer `false`.
- Objektspeicher, Dateifreigaben und andere zustandsbehaftete Infrastruktur deckt die Diensterkennung von Pass 01 ab, nicht dieser Pass.
