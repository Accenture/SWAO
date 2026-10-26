# Workspace-Konfiguration

Die Datei `.swao.yml` ist die zentrale Konfigurationsschnittstelle eines SWAO-Workspaces. Dieses Runbook beschreibt alle verfügbaren Optionen, einschließlich benutzerdefinierter Pass-Konfiguration, Ausschlüssen, Multi-Repo-Layouts und Umgebungsvariablen-Overrides.

---

## Kommentierte .swao.yml-Referenz

```yaml
# .swao.yml -- full annotated example

workspace:
  name: my-portfolio          # display name used in reports
  schema_version: "1.3"       # must match the version expected by the installed binary

llm:
  provider: anthropic         # anthropic | ollama | openai
  model: claude-3-5-sonnet-20241022   # provider-specific model id (optional; defaults apply)
  base_url: ~                 # override endpoint (used for ollama; ~ = default)

passes:
  enabled:                    # list the passes you want to run
    - static
    - context
    - compliance
    - security
    - llm
    - dynamic                 # requires Playwright; omit if browser not available
  config:
    compliance:
      frameworks:
        - GDPR
        - NIST_SP_800_66R2    # built-in framework slugs from swao/controls/
        - custom/my-framework # path to a custom framework relative to workspace root
    security:
      sast_enabled: true      # run SAST analysis on source references
    llm:
      temperature: 0          # deterministic output; recommended for assessments

apps:
  - id: app-one
    display_name: Application One
    source_path: ./apps/app-one/src   # optional; used by static and SAST passes
    exclusions:
      paths:
        - "vendor/**"
        - "node_modules/**"
        - "dist/**"
      pass_ids:               # skip specific passes for this app
        - dynamic

  - id: app-two
    display_name: Application Two
    source_path: ./apps/app-two/src

output:
  path: ./wsp                 # root for all run directories
  formats:
    - json                    # always emitted
    - pdf                     # requires report pass; Consultant+ for gallery
    - csv                     # star-schema bundle for Power BI
```

---

## Pass-Schlüssel

| Pass-Schlüssel | Funktion |
|---|---|
| `static` | Bestandsaufnahme: Dateitypen, Abhängigkeitslisten, Framework-Erkennung |
| `dynamic` | Browser-gestützte Prüfroutine (erfordert Playwright + Chromium) |
| `context` | Liest CSV-/JSON-Kontextdateien ein (CMDB-Exporte, FinOps-Daten) |
| `compliance` | Ordnet den Bestand den ausgewählten Control-Frameworks zu |
| `security` | SAST-Analyse und Container-Image-Scanning (sofern konfiguriert) |
| `llm` | LLM-gestützter Analysedurchlauf: erstellt narrative Befunde und Migrationsempfehlungen |

Einen Pass global deaktivieren, indem er aus `passes.enabled` entfernt wird, oder pro App über `exclusions.pass_ids`.

---

## Multi-Repo-Layout

Wenn das Portfolio mehrere Git-Repositories umfasst, ein verschachteltes Apps-Layout mit `source_path`-Werten verwenden, die auf den entsprechenden Checkout-Pfad verweisen:

```yaml
apps:
  - id: frontend
    display_name: Frontend Service
    source_path: ../frontend-repo/src

  - id: backend
    display_name: Backend API
    source_path: ../backend-repo/api

  - id: infra
    display_name: Infrastructure
    source_path: ../infra-repo/terraform
```

Pfade werden relativ zum Verzeichnis aufgelöst, das `.swao.yml` enthält. Absolute Pfade werden ebenfalls akzeptiert.

---

## Umgebungsvariablen-Overrides

Jeder skalare Wert in `.swao.yml` kann zur Laufzeit durch eine Umgebungsvariable überschrieben werden. Die Namenskonvention lautet `SWAO_` gefolgt vom YAML-Pfad in Großbuchstaben mit Unterstrichen:

| YAML-Pfad | Umgebungsvariable |
|---|---|
| `llm.provider` | `SWAO_LLM_PROVIDER` |
| `llm.model` | `SWAO_LLM_MODEL` |
| `output.path` | `SWAO_OUTPUT_PATH` |

Umgebungsvariablen werden nach dem Parsen der `.swao.yml` angewendet und haben daher stets Vorrang.

---

## Ausschlüsse

Ausschlüsse verhindern, dass bestimmte Pfade oder Passes in die Analyse einbezogen werden, ohne sie aus dem Quellverzeichnis zu entfernen:

```yaml
apps:
  - id: my-app
    exclusions:
      paths:
        - "test/**"           # glob patterns relative to source_path
        - "**/*.generated.ts"
      pass_ids:
        - dynamic             # skip the dynamic pass for this app only
```

Globale Ausschlüsse (für alle Apps geltend) werden derzeit nicht unterstützt. Per-App-Ausschlussblocks verwenden.

---

## MCP-Tool-Profil

Die Workspace-`.swao.yml` kann festlegen, welche Tools `swao mcp` externen KI-Clients anbietet (#3474):

```yaml
mcp:
  profile: starter        # starter | assess | full (Standard full)
  # tools: [swao, swao_health_check]   # Alternative zum Profil: exakte Tool-Namen
```

`profile` und `tools` schließen sich gegenseitig aus. Das Flag `swao mcp --profile` / `--tools` und die
Umgebungsvariablen `SWAO_MCP_PROFILE` / `SWAO_MCP_TOOLS` haben Vorrang vor diesem Block. Was jedes Profil
enthält, beschreibt das Runbook zur MCP-Integration.

---

## Code Health (Pass 26)

Der optionale Block `assessment.code_health` steuert den Code-Health-Pass (#3487). Alle Schlüssel sind
optional; ohne den Block bleibt ein Lauf unverändert.

```yaml
assessment:
  code_health:
    top_n: 25                     # Länge der Arbeitsliste, 1 bis 500 (Standard 25)
    endpoint_allowlist:           # Hosts, die Pass 26 nicht als fest codiert zählt
      - api.partner.example       # exakter Host
      - .corp.example             # die Domain und alle Subdomains
      - 10.20.30.40               # IPv4- oder IPv6-Literal
    tools: [lizard, jscpd]        # optionale Tool-Anreicherung (Standard: keine)
    tool_timeout_seconds: 300     # Obergrenze je Tool-Lauf, 10 bis 3600 (Standard 300)
```

- **Vorrang:** Jeder Schlüssel wird zuerst aus der App-`.swao.yml` gelesen, danach aus der
  Workspace-`.swao.yml`. Eine Liste wird vollständig aus der Datei übernommen, die sie angibt; ein
  `tools: []` in der App-Datei schaltet die Tools ab.
- **Allowlist:** Einträge sind Hostnamen, `.suffix`-Einträge, IPv4- oder IPv6-Literale; ein Schema, ein
  Port, ein Pfad oder ein Platzhalter wird beim Einlesen abgelehnt. Die Allowlist gilt nur für Pass 26:
  Pass 07 (Egress) und die TF-01-Konfigurationsevidenz melden Hosts auf der Allowlist weiterhin. Der Lauf
  speichert die Liste und die Zahl der ausgenommenen Literale unter
  `assessment.code_health.endpoint_allowlist`.
- **Tools:** lizard (zyklomatische Komplexität je Funktion, unterstützt 1.17.x) und jscpd
  (Klonerkennung, unterstützt 4.x) laufen nur, wenn sie aufgeführt sind. Installation mit
  `pip install "lizard>=1.17,<1.18"` und `npm install -g jscpd@4`. Ihre Ergebnisse stehen unter
  `assessment.code_health.tools` und werden im Signal `QUAL-08` zusammengefasst; die eingebauten Scores,
  KPIs und die Arbeitsliste ändern sich nie. Ein fehlendes Tool, eine nicht unterstützte Version, ein
  Fehler oder eine Zeitüberschreitung wird in `QUAL-08` (informativ) gemeldet, und der Lauf geht weiter.
  `swao health-check` führt beide Tools unter Prerequisites mit Version oder "not found" auf.

---

## Konfiguration validieren

```bash
# Validate .swao.yml without running an assessment
swao health-check

# Check with verbose output to see parsed config
swao health-check --verbose
```

`swao health-check` parst und validiert `.swao.yml` als Teil seines Workspace-Prüfpunkts. Alle Schema-Fehler oder nicht erkannten Schlüssel werden vor dem Assessment-Start gemeldet.
