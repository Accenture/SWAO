# Landing-Zone-Live-Bewertung

Die Landing-Zone-Live-Bewertung liest eine **bereitgestellte** Landing Zone über die
eigenen, nur lesenden APIs des Cloud-Anbieters. Sie zeigt, was die Landing Zone
tatsächlich anbietet und enthält: Regionen, aktivierte Dienste, Guardrails, Ressourcen,
Kontingente und die jüngste Aktivität. Die
[Landing-Zone-Katalog-Bewertung](/de/assessment/landing-zone) beantwortet, ob eine
Anbieterregion eine Anwendung aufnehmen *könnte*. Die Live-Bewertung beantwortet, *was
jetzt da ist* in einem Ihrer Mandanten, und wie sich das seit dem letzten Lauf verändert
hat.

SWAO liest nur. Jede Anfrage passiert vor dem Senden eine Nur-Lese-Sperre, und die
Zugangsdaten bleiben im SWAO-Credential-Vault.

---

## Unterstützte Anbieter

| Anbieter | Treiber-ID | Authentifizierung (`--auth`) | Erfasst |
|---|---|---|---|
| T Cloud Public (ehemals Open Telekom Cloud) | `otc` | `iam-password-token` (Felder `username`, `password`, `domain`) oder `aksk` (Felder `access-key-id`, `secret-access-key`, optional `session-token` für einen temporären Schlüssel) | Regionen, Dienste (Token-Katalog, Ressourcenregister, öffentliche Preisliste), Guardrails (CTS-Tracker), Ressourcen (RMS), Aktivität (CTS-Traces). Kontingente werden noch nicht erfasst |
| Amazon Web Services | `aws` | `session-keys` (Felder `access-key-id`, `secret-access-key`, optional `session-token`, `expires-at`) | Regionen, Dienste (aus dem mitgelieferten AWS-Katalog), Guardrails (Organizations, CloudTrail, Config), Ressourcen (Tagging-API), Kontingente (Service Quotas), Aktivität (CloudTrail) |
| Microsoft Azure | `azure` | `service-principal-secret` (`tenant-id`, `client-id`, `client-secret`) oder `service-principal-certificate` (`tenant-id`, `client-id`, `client-certificate`) | Regionen, Dienste (Ressourcenanbieter, Richtlinieneinschränkungen), Guardrails (Policy), Ressourcen (Resource Graph). Kontingente und Aktivität werden noch nicht erfasst |
| STACKIT | `stackit` | `key-flow` (Feld `service-account-key`, das Schlüssel-JSON) | Regionen, Dienste (Service Enablement), Ressourcen, Kontingente. Guardrails und Aktivität werden noch nicht erfasst |

Azure Managed Identity wird nicht unterstützt. Die minimalen Leserollen je Anbieter stehen
in der `ROLES.md` des Treibers, neben dem Treiberquellcode in
`packages/@swao/module-landing-zone/src/live/<anbieter>/`.

**T-Cloud-Public-Zugriffsschlüssel (`aksk`).** Anfragen werden mit dem Zugriffsschlüssel (AK/SK,
das Verfahren `SDK-HMAC-SHA256` der T-Cloud-Public-SDKs) signiert; der Treiber sendet nur lesende
Anfragen und zeichnet Schlüssel, Signatur und Token nie auf. Verwenden Sie einen
**temporären** Zugriffsschlüssel mit seinem `session-token` (zum Beispiel einen für 15
Minuten aus Ihrer Operator-Anmeldung ausgestellten); legen Sie für SWAO nie einen
dauerhaften Zugriffsschlüssel in einem Mandanten an. Der Benutzer hinter einem temporären
Schlüssel lässt sich nicht nachschlagen, daher ist sein Prüfergebnis `unverifiable`, und
ein Lauf braucht `--accept-unverified-read-only`.
`scripts/lz-credentials-to-vault.mjs --csp otc --auth aksk` speichert nur Zugriffs- und
Geheimschlüssel; hinterlegen Sie das `session-token` mit
`swao lz connect --credentials-file` oder `swao credential set`.

Eine Quelle, die nicht gelesen werden kann, ist kein Fehler des Laufs: Sie wird mit dem
Grund (zum Beispiel dem HTTP-Status) als `not_collected` aufgeführt, und der Rest des
Scopes wird trotzdem erfasst.

### Welche Treiber ein Build anbietet

Ein Treiber wird angeboten, sobald er gegen einen echten Mandanten verifiziert wurde:
`otc`, `aws` und `stackit` sind in jedem Build verfügbar. `azure` ist noch nicht
verifiziert und wird nur angeboten, wenn Sie ihn in der Umgebungsvariable
`SWAO_LZ_UNVERIFIED_DRIVERS` nennen (kommagetrennt, zum Beispiel
`SWAO_LZ_UNVERIFIED_DRIVERS=azure`). Die Variable wird nur aus der Umgebung gelesen, nie
aus `.swao.yml`. Die Verifikation betrifft den Treiber gegen einen echten Mandanten; der
minimale Rollensatz in jeder `ROLES.md` ist weiterhin nicht verifiziert, prüfen Sie daher
das Prüfergebnis Ihrer eigenen Rolle. Wird kein Treiber
angeboten, meldet `swao lz list` `no live driver for this provider in this build`, und die
TUI zeigt dasselbe.

---

## Lizenzstufen

| Funktion | Befehle | Stufe |
|---|---|---|
| Verbinden und prüfen | `swao lz connect`, `swao lz probe`, `swao lz list`, `swao lz remove` | Community und höher |
| Live-Scan, Bewertung und Laufvergleich | `swao lz scan`, `swao assess --type landing-zone-live`, `swao lz diff` | Consultant und höher |
| Publikation | `swao publish --lz-live <lz-id>` | Consultant und höher |
| Katalogaktualisierung aus einem Live-Lauf | `swao lz catalogue update --source live` | Consultant und höher |
| Portfolio-Zusammenführung und -Publikation | `swao assess --portfolio --type landing-zone-live`, `swao publish --portfolio --block-profile lz-live-portfolio` | Enterprise |
| Client LZ Policy Baseline: kopieren, bearbeiten, prüfen | Ordner aus dem [GitHub-Repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) nach `wsp/inputs/catalogs/community/` kopieren, `policy-baseline.yaml` bearbeiten, `swao health-check` | Community und höher |
| Client LZ Policy Baseline: Auswertung und Nachweisreferenzen | `swao assess --type landing-zone-live --frameworks client-lz-policy-baseline`, `swao lz evidence`, `swao lz hierarchy` | Consultant und höher |
| Client LZ Policy Baseline: Vergleich von Landing Zones | `swao publish --portfolio --block-profile lz-live-baseline-comparison` | Enterprise |

---

## Begriffe

- **Landing Zone.** Ein Mandant eines Anbieters, in der `.swao.yml` des Workspace unter
  `landing_zones:` mit einer Kebab-Case-ID registriert, zum Beispiel `otc-prod`.
- **Scope.** Der Teil der Landing Zone, den ein Zugang lesen kann. Ein Scope hat eine Art:
  `platform` (die gemeinsame Grundlage; höchstens einer je Landing Zone) oder `application`
  (das Konto, Projekt oder Abonnement einer Anwendung, optional mit `apps/<app-id>`
  verknüpft). Ein Scope nennt seine Authentifizierungsmethode, seine Regionen und, wo der
  Anbieter es braucht, ein Ziel wie `project`, `subscription`, `account`, `resource_group`
  oder `folder`.
- **Nur-Lese-Prüfung.** Bevor ein Scope gelesen wird, prüft SWAO, was der Zugang darf. Das
  Ergebnis ist `verified`, `unverifiable` oder `refused` (siehe
  [Nur-Lese-Prüfung](#nur-lese-prufung)).

Die Registrierung in `.swao.yml` sieht so aus (sie wird von `swao lz connect` geschrieben;
von Hand bearbeiten Sie sie selten):

```yaml
landing_zones:
  - id: otc-prod
    provider: otc
    display: T Cloud Public production
    scopes:
      - id: platform
        kind: platform
        auth: iam-password-token
        regions: [eu-de, eu-nl]
      - id: crm
        kind: application
        auth: iam-password-token
        regions: [eu-de]
        app: app-crm-01
```

`.swao.yml` enthält nie Zugangsdaten. Ein geheimnisartiger Wert unter `landing_zones:`
wird beim Lesen der Datei abgelehnt, und die unten beschriebenen Bestätigungsflags können
dort ebenfalls nicht gespeichert werden.

---

## Zugangsdaten

Zugangsdaten liegen im SWAO-Credential-Vault unter dem Schlüssel
`lz:<lz-id>:<scope-id>:<feld>`, zum Beispiel `lz:otc-prod:platform:password`. Die
Feldnamen sind die oben je Anbieter genannten. SWAO gibt Werte nie aus, protokolliert sie
nicht und schreibt sie in keine Datei.

Sie können sie auf drei Wegen hinterlegen:

- **Mit `swao lz connect`.** Verwenden Sie `--credentials-file <pfad>` (eine Datei mit
  Zeilen `<feld>=<wert>`) oder `--credentials-stdin` (dieselben Zeilen auf der
  Standardeingabe), damit kein Wert auf der Befehlszeile erscheint. Löschen Sie die Datei
  danach.
- **Aus einer anderen Landing Zone.** Der SWAO-Vault gilt je Benutzer (für alle
  Workspaces) und ist nach Landing Zone und Scope geordnet; eine neue Landing Zone sieht
  die Zugangsdaten einer anderen daher nicht.
  `swao lz connect <lz-id> ... --credentials-from <andere-lz-id>:<scope-id>`
  kopiert einen gespeicherten Satz desselben
  Anbieters und derselben Anmeldeart in den neuen Scope; die Quellschlüssel bleiben. Die
  Landing-Zone-Verbindungen listen diese Sätze (Namen von Landing Zone, Scope und
  Anmeldeart, nie ein Wert) zum Bestätigen oder zur Eingabe neuer Zugangsdaten.
- **Je Feld.** Rufen Sie `swao credential set lz:<lz-id>:<scope-id>:<feld> -` auf und
  geben oder leiten Sie den Wert ein.
- **Als Umgebungsvariable** für Automatisierung. Verwenden Sie `SWAO_CREDENTIAL_`, gefolgt
  vom Schlüssel in Großbuchstaben; `:` wird dabei zu `__` und `-` zu `_`. Zum Beispiel
  `SWAO_CREDENTIAL_LZ__OTC_PROD__PLATFORM__PASSWORD`.

Kurzlebige Zugänge haben ein Feld `expires-at` (ISO 8601, zum Beispiel
`2026-11-02T19:59:25+00:00`). Es wird vor jeder Anfrage geprüft. Ein abgelaufenes Token
stoppt den Scope mit der Meldung `the token for <key> has expired; refresh it`.
`swao lz probe` endet dann mit Code 2, und eine Bewertung vermerkt den Scope als `failed`.
Für AWS IAM Identity Center (SSO) erneuern Sie mit `aws sso login` und hinterlegen die
neuen Sitzungsschlüssel erneut.

Die Landing-Zone-Eignung (Pass 23) nutzte eigene Vault-Schlüssel `aws-*` und `azure-*`.
Verschieben Sie sie einmalig mit `swao lz connect ... --move-legacy-credentials` in einen
Scope. Die alten Schlüssel werden nicht mehr gelesen.

---

## Schritt für Schritt (CLI)

```bash
# 1. Landing Zone und Plattform-Scope registrieren, Zugangsdaten speichern, prüfen
swao lz connect otc-prod --provider otc --scope platform --kind platform \
  --auth iam-password-token --region eu-de --region eu-nl \
  --display "T Cloud Public production" --credentials-file ./otc-prod.creds

# 2. Registrierung und Verbindungsstatus prüfen (nur Feldnamen, nie Werte)
swao lz list

# 3. Jederzeit erneut prüfen: Identität, Nur-Lese-Ergebnis, lesbare Quellen
swao lz probe otc-prod

# 4. Bewertung aller Scopes ausführen (Consultant und höher)
swao assess --type landing-zone-live --lz otc-prod --frameworks bsi-c5,nis2

# 5. Veröffentlichen (Consultant und höher)
swao publish --lz-live otc-prod
```

### Befehlsreferenz

**`swao lz connect <lz-id>`** registriert einen Landing-Zone-Scope, speichert seine
Zugangsdaten und führt die Nur-Lese-Prüfung aus. Pflicht sind `--provider`, `--scope`,
`--kind` (`platform` oder `application`) und `--auth`. Die optionalen Flags sind:

- `--region <region>`, wiederholbar.
- `--target <schlüssel=wert>`, wiederholbar; der Schlüssel ist `project`,
  `subscription`, `account`, `resource_group` oder `folder`.
- `--app <app-id>`.
- `--display <name>`.
- `--credentials-file <pfad>`, `--credentials-stdin` oder `--credentials-from <lz-id>:<scope-id>`, nur eine davon.
- `--move-legacy-credentials`.
- `--no-probe`, um nur zu registrieren und zu speichern.
- `--accept-unverified-read-only` und `--accept-write-capable-credentials`.
- `--identity-label <label>`, die Kennung für Aufzeichnungen, Standard `operator`.

Der Exit-Code ist der der Prüfung (0 mit `--no-probe`).

**`swao lz probe <lz-id> [--scope <scope-id>]`** zeigt je Scope die Identität, das
Nur-Lese-Ergebnis, die lesbaren und nicht lesbaren Quellen und eine etwaige
Endpunktumleitung. Exit-Code 1, wenn ein Scope nicht fortfahren darf.

**`swao lz list`** listet jede registrierte Landing Zone und jeden Scope mit
Verbindungsstatus:

- `credentials stored (N field(s))`
- `credentials missing: ...`
- `token expired, refresh it before a run`
- `the driver has no auth method ...`
- `not checked (no driver)`

**`swao lz remove <lz-id> [--scope <scope-id>]`** entfernt einen Scope (der letzte Scope
entfernt die Landing Zone) und löscht seine Zugangsdaten aus dem Vault. Frühere Laufdaten
unter `landing-zones/<lz-id>/` bleiben erhalten.

**`swao lz scan <lz-id> --mode live --out <ordner>`** (Consultant) liest die Scopes in
einen frei gewählten Ordner. Er schreibt `<lz-id>.<scope-id>.lz-live-scan.json`,
`lz-live-merged.yaml` und `lz-live-catalogue.json`. Die optionalen Flags sind:

- `--scope`.
- `--days <n>`, das Aktivitätsfenster, Standard 7.
- `--stale-days <n>`, Standard 7. Ältere Scans in `--out` erscheinen in der
  Zusammenführung als veraltet.
- Die beiden Bestätigungsflags.

`--out` darf kein Landing-Zone-Katalogordner sein.

**`swao assess --type landing-zone-live --lz <lz-id>`** (Consultant) ist die vollständige
Bewertung. Die optionalen Flags sind:

- `--scope <scope-id>`, wiederholbar. Standardmäßig alle Scopes.
- `--frameworks <ids>`, die zu bewertenden Community-Frameworks. Ohne Angabe gelten
  `assessment.frameworks` oder `assessment.regimes_active` des Workspace. Die Frameworks
  müssen im Workspace installiert sein; SWAO lädt während einer Live-Bewertung nie ein
  Framework nach.
- Die beiden Bestätigungsflags.

Exit-Code 0, wenn jeder Scope vollständig ist; 1, wenn ein Scope teilweise, fehlerhaft
oder abgelehnt ist oder die Eingabe ungültig ist.

### Läufe vergleichen

**`swao lz diff <lz-id>`** (Consultant) vergleicht zwei Live-Läufe einer Landing Zone je
Scope:

- `--from <ts>`: der frühere Lauf (Standard: je Scope der neueste frühere Lauf mit einem
  Scan dieses Scopes).
- `--to <ts>`: der spätere Lauf (Standard: `latest-lz-live.txt`, sonst der neueste Lauf).
- `--scope <scope-id>`: nur einen Scope vergleichen.

Ein Lauf wird über seinen Ordnernamen oder eine ISO-Zeit benannt. Die Ausgabe zeigt je
Scope die neuen und entfernten Regionen, Dienste und Ressourcenzahlen sowie jede Änderung
eines Dienststatus:

```
scope platform: 2026-11-03T08-00-00 -> 2026-11-04T08-00-00
  new: regions none; services cce; resources 3
  removed: regions none; services none; resources 1
  status change: rds in eu-nl: available_not_enabled -> enabled
```

Exit-Code 0, wenn etwas verglichen wurde, und 1, wenn es nichts zu vergleichen gibt (kein
Lauf, ein unbekannter Lauf oder Scope, oder nur Erst-Scans). In der TUI bietet der
Abschlussbildschirm einer Landing-Zone-Live-Bewertung „Diff vs previous run“ an.

Ein von der Lizenzstufe abgelehnter Live-Befehl gibt den `[LICENSE]`-Block mit der
nötigen Lizenz aus und endet mit Exit-Code 2, wie jede Lizenzsperre von SWAO (eine
ungültige Lizenzdatei endet mit 3).

---

## Nur-Lese-Prüfung

| Ergebnis | Bedeutung | Was passiert |
|---|---|---|
| `verified` | Der Zugang kann nur lesen | Der Scope wird gelesen |
| `unverifiable` | SWAO konnte nicht nachweisen, dass der Zugang nur lesen kann (zum Beispiel ist schon die Berechtigungsprüfung nicht erlaubt) | Der Scope stoppt mit Exit-Code 1, außer Sie übergeben für diesen Lauf `--accept-unverified-read-only` |
| `refused` | Der Zugang kann schreiben | Der Scope stoppt mit Exit-Code 1, außer Sie übergeben für diesen Lauf `--accept-write-capable-credentials` |

Ein Bestätigungsflag gilt nur für einen Lauf. Es wird im Scan (`read_only_overrides`) und
im Run-Manifest vermerkt, sodass die Publikation zeigt, dass der Bediener es bestätigt
hat. **Ein Bestätigungsflag ändert nie, was SWAO sendet.** Die HTTP-Schicht erlaubt nur
`GET` und `HEAD` über https sowie die wenigen lesenden `POST`-Aufrufe, die ein Treiber
auflistet (zum Beispiel eine Token-Anfrage). Alles andere wird vor dem Senden mit der
Meldung `request refused before sending ... SWAO only reads from a landing zone.`
abgelehnt.

Verwenden Sie eine eigene Nur-Lese-Identität, wo der Anbieter das erlaubt (siehe die
`ROLES.md` des Treibers). Manche Anbieter können keinen Nur-Lese-Zugang abbilden, der auch
die Prüfung erlaubt; die `ROLES.md` des Treibers nennt das je Rolle erwartete Ergebnis.

---

## Authentifizierungsfehler und Drosselung während eines Laufs

- **Ein während des Laufs abgelehntes Token stoppt den Scope sofort.** Antwortet der
  Anbieter auf eine lesende Anfrage mit `401` (zum Beispiel weil das Token während des
  Laufs abgelaufen ist oder widerrufen wurde), stoppt SWAO den Scope mit
  `authentication failed (HTTP 401): the access token was refused on <route> (expired or revoked during the run)`,
  statt alle übrigen Quellen als nicht erfasst zu vermerken. `swao lz scan` und
  `swao lz probe` enden mit Exit-Code 1; eine Bewertung vermerkt den Scope als `failed`,
  führt die übrigen Scopes aus und endet mit Exit-Code 1. Starten Sie mit einem neuen
  Token erneut. Ein `403` ist kein Authentifizierungsfehler: Die Quelle wird als
  `not_collected` vermerkt, und der Lauf geht weiter.
- **Drosselung wird einige Male wiederholt.** Bei `429` (und bei `503` mit
  `Retry-After`-Header) wartet SWAO so lange, wie der Anbieter verlangt (`Retry-After` in
  Sekunden oder als Datum; ohne Angabe 1, 2 und 4 Sekunden), und wiederholt bis zu 3 Mal,
  höchstens 30 Sekunden je Wartezeit und 60 Sekunden je Anfrage. Lehnt der Anbieter dann
  immer noch ab, wird die Quelle mit HTTP-Status 429 als `not_collected` vermerkt; SWAO
  wartet nie unbegrenzt. Der AWS-Treiber wiederholt die AWS-Drosselungsfehlercodes
  zusätzlich mit eigener Wartestrategie.

---

## Was Sie erhalten

Ein Lauf von `swao assess --type landing-zone-live` schreibt in
`landing-zones/<lz-id>/wsp/runs/<run-id>/` im Workspace:

| Datei | Inhalt |
|---|---|
| `<lz-id>.<scope-id>.lz-live-scan.json` | Ein Scan je Scope: Metadaten (Identität, Nur-Lese-Ergebnis und Bestätigungen, Abdeckung, Quellen), Angebot (Regionen, Dienste mit Status je Region, Framework-Ampeln), Bestand (Ressourcen, Guardrails, Kontingente, Aktivitätsübersicht, Prüfungen) und die Unterschiede zum vorherigen Lauf |
| `lz-live-merged.yaml` | Alle Scopes der Landing Zone in einer Sicht. Jeder Scope ist `merged`, `stale` oder `missing` |
| `lz-live-catalogue.json` | Das beobachtete Angebot im Landing-Zone-Katalogformat, die Quelle für eine Katalogaktualisierung |
| `manifest.json` | Run-Manifest: Frameworks mit Prüfsummen, Nur-Lese-Vermerk je Scope, Abdeckung, Endpunktumleitungen, Simulationskennzeichen |
| `run-status.json` | Gesamtstatus und Status je Scope (`complete`, `refused`, `failed`) |
| `<lz-id>.<scope-id>.lz-baseline.json` | Nur wenn eine [Client LZ Policy Baseline](#client-lz-policy-baseline) gewählt ist: je Richtlinie Angebotsurteil, Bestandsstatus und Beobachtbarkeit, die nicht geprüften und die deaktivierten Richtlinien, das Gesamturteil und der Hash der Baseline |
| `evidence-refs.json` | Die lokale Nachweiskarte: je `ev:`-Referenz native ID, Region, Einstellung und Konsolenlink. Nur Workspace-Daten, nie veröffentlicht (siehe „Nachweisreferenzen“ unter Client LZ Policy Baseline) |
| `lz-organisational.json` | Nur wenn ein gewähltes Framework organisatorische Kontrollen hat: die aus den Dokumenten in `landing-zones/<lz-id>/ingestion/` entschiedenen Kontrollen, mit erwarteten, gefundenen und fehlenden Eingaben und `ev:`-Referenzen, nie mit Dateinamen (siehe [Organisatorische Kontrollen](#organisatorische-kontrollen-ingestion-ordner)) |

`landing-zones/<lz-id>/wsp/latest-lz-live.txt` verweist auf den letzten Lauf, der nicht
fehlgeschlagen ist.

Der Dienststatus je Region ist `enabled`, `available_not_enabled`, `restricted`,
`not_offered` oder `unknown`. Jeder Wert trägt seinen Nachweis (die API oder den Katalog,
aus dem er stammt).

Ressourcen-Tags werden je Landing Zone pseudonymisiert. Das Pseudonym-Salz liegt im Vault
und wird von `swao lz remove` nicht gelöscht, sodass die Pseudonyme über Läufe hinweg
gleich bleiben.

### Publikation

`swao publish --lz-live <lz-id>` (Consultant; in der TUI **HTML veröffentlichen**, Modus 4
„Landing Zone Live View“) stellt den letzten Lauf als HTML-Publikation dar. Die
Publikation enthält:

- die Zusammenfassung, Regionen und Dienste;
- den Bestand, die Prüfungen und die Befunde;
- die Laufhistorie.

Die wichtigsten Blöcke:

| Block | Inhalt |
|---|---|
| Zusammenfassung | Zusammengeführte Scopes, Regionen, aktivierte Dienste, Ressourcen, fehlgeschlagene Prüfungen, hohe Befunde |
| Regionen | Eine Karte je Land mit Status und Verfügbarkeitszonen (verfügbar von gesamt) je Region, danach eine Dienstmatrix je Kategorie mit aktivierten / beobachteten Diensten je Region |
| Dienste | Eine Zeile je Dienst mit Kategorie und Fähigkeits-Tags, Status je Region, Framework-Ampel und optional IaC-Stufe und niedrigstem beobachteten Preis (`from <betrag> <währung> / <einheit> (<region>)`). Die Blockoptionen filtern nach Kategorie und IaC-Stufe und wählen die Spalten |
| Bestand | Ressourcen, Guardrails, Workloads nach Art, Kontingente (Limit, genutzt, verbleibend), Tag-Abdeckung (Anteil getaggter Ressourcen und Zahl der Tag-Schlüssel; Schlüssel und Werte werden nicht veröffentlicht) und was seit dem vorherigen Lauf neu oder entfernt ist, mit Änderungen des Dienststatus |
| Prüfungen und Befunde | Die Landing-Zone-Prüfungen und die Befunde je Scope |

Die Dienstkategorien sind compute, containers, storage, database, cache, messaging,
network, security, analytics, AI and ML, operations, developer, other und unmapped. Ein
Dienst erhält die Kategorie seines ersten Fähigkeits-Tags.

Mit `--out` heißt die Datei `<lz-id>-lz-live.html`. Im HTML-Editor beginnt Export Template
mit der Vorlage des Landing-Zone-Live-Profils, sodass eine exportierte Vorlage dessen
Blöcke behält.

## Organisatorische Kontrollen (Ingestion-Ordner)

Manche Framework-Kontrollen sind organisatorisch: eine Richtlinie, ein Plan, ein Register
oder Protokolle des Leitungsorgans (`layer: governance` in der `controls.yaml` des Frameworks).
Keine Cloud-API kann sie zeigen. Ein Landing-Zone-Lauf entscheidet die Kontrollen, die der
Katalog Landing-Zone-Bewertungen zuordnet, aus Dokumenten, die Sie in den Ingestion-Ordner
der Landing Zone legen:

```
landing-zones/<lz-id>/ingestion/
```

Es ist keine Konfiguration nötig. Legen Sie den Ordner an und die Dokumente hinein. Jeder Lauf
leitet sie weiter wie eine Anwendungsbewertung ihren `ingestion/`-Ordner:

- die Dateien werden nach `landing-zones/<lz-id>/wsp/inputs/<category>/` kopiert;
- aus PDF, DOCX, XLSX und PPTX wird Text extrahiert.

Danach bewertet der Lauf die organisatorischen Kontrollen der gewählten Frameworks. Das sind
die Kontrollen mit `layer: governance` und dem Bewertungstyp `lz`. DORA 2.0.0 hat 35
organisatorische Kontrollen, 8 davon tragen `lz` (DORA_Art_5_1, 5_2, 6, 6_3, 9_7, 11_1, 11_4
und 16_1). Die übrigen 27 sind Anwendungs- und Audit-Bewertungen zugeordnet, die sie aus dem
Inhalt entscheiden. Der Lauf zählt sie als außerhalb des Bewertungsbereichs und entscheidet sie nicht.

**Benennung.** Ein Dokument zählt für ein erwartetes Dokument einer Kontrolle, wenn sein
Dateiname den Namen der erwarteten Eingabe enthält, ohne Rücksicht auf Groß- und
Kleinschreibung und Trennzeichen. `ICT-Risk-Management-Framework_v3.pdf` passt zu
`ict_risk_management_framework`. Ein allgemeiner Name wie `policies.pdf` passt zu keiner. Das
README des Frameworks listet die Namen der erwarteten Eingaben (für DORA:
`community-frameworks/dora/README.md`, Abschnitt „Evidence“).

**Ergebnis je Kontrolle:**

| Ergebnis | Wann |
|---|---|
| Dokumentiert (SATISFIED) | Jedes erwartete Dokument liegt vor und enthält Text |
| Teilweise dokumentiert (PARTIAL) | Einige, nicht alle erwarteten Dokumente liegen vor |
| Nicht bewertet (UNKNOWN) | Kein Dokument im Ordner, keines nach einer erwarteten Eingabe benannt, nur Dokumente ohne Text (ein gescanntes Bild), oder die Kontrolle nennt kein erwartetes Dokument |
| N/A | `applies_when` passt nicht zu `framework_context` in der `.swao.yml` des Workspace (zum Beispiel `dora_tlpt_required: "true"`) |

SWAO prüft Namen und Lesbarkeit der Dokumente, nicht ihren Inhalt. Eine dokumentierte
Kontrolle braucht weiterhin eine Prüferin oder einen Prüfer, die oder der den Inhalt
bestätigt. Ein fehlendes Dokument lässt eine Kontrolle unbewertet, es lässt sie nie
scheitern. Eine Anwendungsbewertung entscheidet dieselben Kontrollen aus dem Inhalt
(Pass 04 und Pass 11).

**Wo die Ergebnisse erscheinen:**

- `lz-organisational.json` im Lauf-Ordner;
- die Fortschrittszeile `organisational controls DORA: ...` des Laufs;
- der Block **Organisational Controls** der Publikation `lz-live`;
- die Governance-Matrix der Portfolio-Sicht;
- die MCP-Werkzeuge `swao_lz_live_posture` und `swao_lz_live_runs`.

Dateinamen von Dokumenten sind Kundeninhalt und erscheinen deshalb in keinem davon.
Stattdessen erhält jedes Dokument eine Referenz `ev:<run>:document:Ref-<hex>`, und
`swao lz evidence <ref>` zeigt die Datei lokal. `swao lz scan` liest den Ordner nicht.

---

## Katalogaktualisierung aus einem Live-Lauf

Ein Live-Lauf kann einen Landing-Zone-Katalog mit dem aktualisieren, was der Mandant
tatsächlich anbietet:

```bash
# Katalog eines Anbieters aus dem letzten Live-Lauf einer Landing Zone aktualisieren
swao lz catalogue update --source live --lz otc-prod --provider otc --dry-run
swao lz catalogue update --source live --lz otc-prod --provider otc

# Einen bestimmten Lauf statt des letzten verwenden
swao lz catalogue update --source live --lz otc-prod --provider otc --run 2026-11-04T08-00-00

# Neuen Katalog für einen Anbieter oder eine Private Cloud ohne Katalog anlegen
swao lz catalogue update --source live --lz my-cloud-prod --new my-cloud
```

Die Aktualisierung ergänzt nur, was der Lauf beobachtet hat. Sie entfernt nie einen
Dienst, der nicht gesehen wurde, und erhöht nie den Konfidenzwert des Katalogs. Prüfen Sie
die Unterschiede zuerst mit `--dry-run`. In der TUI bietet **Tools > Update LZ Catalogue**
die Live-Quelle an, sobald eine Landing Zone registriert ist. Sie wählen die Landing Zone
und den Lauf, prüfen die Unterschiede des Probelaufs und schreiben dann den Katalog.

Ein simulierter Lauf (siehe unten) aktualisiert nie einen Katalog.

---

## Schritt für Schritt (TUI)

- **Landing Zone Connections**, erreichbar über das Setup des Landing Zone Live
  Assessment ([Workspace-Setup](/de/workspace-setup)) und im Landing Zone Live
  Assessment selbst (Eintrag "Add or manage landing zones" im ersten Schritt). Hier können Sie:
  - eine Landing Zone hinzufügen (Anbieter, Anzeigename);
  - einen Scope mit Zugangsdaten hinzufügen (verdeckt eingegeben und über die
    Standardeingabe an SWAO übergeben, nie in eine Datei geschrieben oder angezeigt);
  - einen Scope prüfen;
  - alte Schlüssel der Landing-Zone-Eignung übernehmen;
  - einen Scope oder eine Landing Zone entfernen.

  Der Ergebnisbildschirm der Prüfung erklärt ein Ergebnis `unverifiable` oder `refused`.
  Bestätigungsflags werden hier nie gesetzt.
- **Run Assessment > Landing Zone Live Assessment** (Consultant) fragt nach Landing Zone,
  Scopes und Frameworks. Es zeigt die Prüfung und verlangt eine Bestätigung für diesen
  Lauf, wenn ein Scope ein Bestätigungsflag braucht. Nach dem Lauf zeigt „Diff vs
  previous run“ dafür `swao lz diff`. Ist eine Client LZ Policy Baseline gewählt, zeigt der
  Ergebnisschritt außerdem die Baseline-Übersicht je Scope, „Tenant hierarchy“ und
  „Evidence references (resolve locally)“. Der Framework-Schritt nennt den Ordner
  `landing-zones/<lz-id>/ingestion/` für organisatorische Dokumente. Der Ergebnisschritt
  zeigt die organisatorischen Kontrollen je Framework (dokumentiert, teilweise, nicht
  bewertet, n/a).
- **HTML veröffentlichen > Landing Zone Live View** veröffentlicht den letzten Lauf.

---

## Portfolio-Sicht (Enterprise)

```bash
# Den letzten Live-Lauf jeder registrierten Landing Zone zusammenführen
swao assess --portfolio --type landing-zone-live

# Die Multi-Cloud-Governance-Sicht dieser Zusammenführung veröffentlichen
swao publish --portfolio --block-profile lz-live-portfolio
```

Die Zusammenführung schreibt `wsp/lz-live-portfolio/runs/<run-id>/lz-live-portfolio.yaml`
und aktualisiert `wsp/lz-live-portfolio/latest.txt`. Ihre Landing Zones erscheinen auch in
der Portfolio-Zusammenfassung. Die Publikation (`lz-live-portfolio.html`) enthält:

- die Governance je Landing Zone;
- eine Fähigkeitssuche über alle Landing Zones;
- eine Bestandsübersicht;
- die Abweichungen zwischen Läufen;
- die Laufhistorie.

**Beobachtete Landing-Zone-Eignung verknüpfter Anwendungen.** Ein mit einer Anwendung
verknüpfter Anwendungs-Scope (`--kind application --app <app-id>`, `app:` in
`.swao.yml`) gibt dieser Anwendung in der Zusammenführung eine *beobachtete*
Landing-Zone-Eignung: SWAO nimmt die Dienste, die die letzte Bewertung der Anwendung
braucht, und prüft sie gegen das, was der Scope in seinen Regionen tatsächlich anbietet
(die registrierten Regionen, sonst die als aktiviert gesehenen). Die Zusammenführung gibt
je Eignung eine Zeile aus
(`app <app> (scope <scope>) in <region>: <verdict>, <n> blocker(s), confidence observed`),
schreibt sie nach `app_fits` in der Zusammenführungsdatei und nach `lz_fit` der Anwendung
in der Portfolio-Zusammenfassung (`confidence: observed`), und die Hub-Publikation zeigt
sie als eigene Zeile `<anbieter> / <region> (observed)`, nie mit der Katalog-Eignung
vermischt. Eine Anwendung ohne bewertete Signale, ein nicht zusammengeführter Scope und
eine Region ohne Souveränitätsfakten ergeben keine beobachtete Eignung. Simulierte Scopes
zählen nur mit `--include-simulated` und sind mit `[SIM]` markiert.

In der TUI bietet der Portfolio-Bildschirm dieselben zwei Schritte als „Landing Zone Live
Assessment (all LZs)“ und „Multi-Cloud Governance (HTML)“ an. Simulierte Läufe bleiben
außen vor, außer Sie übergeben `--include-simulated`; dann sind sie mit `[SIM]` markiert.

---

## Client LZ Policy Baseline

Eine Kundenorganisation hat meist eigene Regeln für ihre Landing Zones, zum Beispiel
„Daten dürfen nur in deutschen Rechenzentren gespeichert werden“ oder „verwaltetes
PostgreSQL ist nicht erlaubt“. Die **Client LZ Policy Baseline** ist ein
Community-Framework, das solche Regeln einmal festhält, als normalisierte Richtlinien, die
für jeden Anbieter gelten. SWAO misst dann jede Landing Zone an denselben Regeln und zeigt,
wo ein Anbieter passt und wo nicht. SWAO liest nur: Es setzt nie eine Richtlinie in einem
Mandanten durch.

Das ausgelieferte Framework (Ordner `client-lz-policy-baseline`, ID
`CLIENT_LZ_POLICY_BASELINE`) ist eine vollständig befüllte Vorgabe für eine deutsche
Behörde: 20 Richtlinien in 11 Kategorien, jede mit einer zitierten Quelle oder als Annahme
gekennzeichnet. Die Richtlinien, ihre Parameter und alle angenommenen Vorgabewerte stehen
auf der Framework-Seite [Client LZ Policy Baseline](/de/frameworks/client-lz-policy-baseline).

| Funktion | Stufe |
|---|---|
| Baseline kopieren, bearbeiten und prüfen | Community und höher |
| Anwendungsbewertung gegen die Baseline mit dem statischen LZ-Katalog | Community und höher |
| Baseline-Auswertung in einer Landing-Zone-Live-Bewertung, die `lz-live`-Publikation, Nachweisreferenzen | Consultant und höher |
| Anwendungsbewertung gegen die Baseline mit Live-Ergebnissen | Consultant und höher |
| Vergleich mehrerer Landing Zones, die Publikation `lz-live-baseline-comparison` | Enterprise |

### 1. Baseline holen

Kopieren Sie den Ordner `client-lz-policy-baseline` aus dem
[GitHub-Repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) nach
`wsp/inputs/catalogs/community/client-lz-policy-baseline/` in Ihrem Workspace. Diese Kopie
ist Ihre Baseline: SWAO wertet nur die Kopie im Workspace aus. Sie dürfen den Ordner der
Kopie umbenennen, denn SWAO findet ein Framework über die `framework.id` in seiner
`framework-meta.yaml`. `swao framework list` listet die Frameworks im Workspace.

Für eine zweite Baseline im selben Workspace (zum Beispiel eine je Schutzbedarf) kopieren
Sie den Ordner unter einem anderen Namen (zum Beispiel `client-lz-policy-baseline-high/`)
und geben ihm eine eigene ID: Ändern Sie `framework.id` in `framework-meta.yaml`,
`regime_meta.id` in `controls.yaml` sowie `framework:` in `policy-baseline.yaml` und
`service-controls.yaml`, zum Beispiel auf `CLIENT_LZ_POLICY_BASELINE_HIGH`, und behalten Sie
`baseline_of: CLIENT_LZ_POLICY_BASELINE` bei.

### 2. `policy-baseline.yaml` bearbeiten

Jede Richtlinie hat einen `state` (`enabled` wird ausgewertet, `disabled` wird aufgeführt,
aber nicht ausgewertet, `not_set` ist noch nicht geprüft und wird nicht ausgewertet) und
die `params` ihrer Art. Ein Parameter, den Sie weglassen, übernimmt den ausgelieferten
Vorgabewert. Zwei allgemeine Beispiele:

```yaml
policies:
  # Daten nur in deutschen Rechenzentren (die ausgelieferte Vorgabe)
  - id: CPB-RES-01
    kind: region_residency
    category: data_residency
    control: CPB-RES-01
    state: enabled
    params:
      allowed_countries: [DE]      # [EU] lässt die 27 Mitgliedstaaten zu
    default_source: "..."
  # Verwaltetes PostgreSQL ist nicht erlaubt (ausgeliefert als disabled; einschalten)
  - id: CPB-SVC-03
    kind: service_deny
    category: service_control
    control: CPB-SVC-03
    state: enabled
    params:
      capabilities: [postgresql]
    default_source: assumption
```

Eigene Richtlinien verwenden eine vorhandene Art, eine ID der Form `X-<PREFIX>-<CAT>-NN`
(zum Beispiel `X-ORG-SVC-01`), jeden Parameter der Art und eine Kontrolle mit derselben ID
in `controls.yaml`. Das Präfix `CPB-` ist den ausgelieferten Richtlinien vorbehalten.

Die Einstellungen bearbeiten Sie in der YAML-Datei mit einem Texteditor oder mit einem
KI-Chat oder Agenten (zum Beispiel SWAO Chat). Führen Sie danach den Health Check aus
(nächster Abschnitt).

### 3. Health Check

`swao health-check` prüft `policy-baseline.yaml` in jedem Community-Framework-Ordner, der
eine hat. Ein Schemafehler (zum Beispiel eine unbekannte Art, ein falscher Parametertyp,
eine unbekannte Kontrolle, eine doppelte ID, eine `CPB-`-ID, die SWAO nicht ausliefert,
oder ein Wert, der wie ein Geheimnis aussieht) lässt die Zeile des Frameworks
fehlschlagen. Warnungen gibt es für:

- Richtlinien mit `state: not_set` (nicht ausgewertet, bis sie geprüft sind);
- Fähigkeits-Tags, die kein aufgelöster Landing-Zone-Katalog verwendet;
- eine veraltete Kopie: ihre `catalogue_version` ist niedriger als die ausgelieferte; die
  Warnung nennt die ausgelieferten Richtlinien, die in der Kopie fehlen.

Siehe [Health Check](/de/health-check).

### 4. Neuere ausgelieferte Versionen

SWAO ändert Ihre Kopie nie: Es gibt keine automatische und keine befehlsgesteuerte
Aktualisierung. Der Health Check meldet eine veraltete Kopie und nennt die ausgelieferten
Richtlinien, die ihr fehlen. Wenn Sie eine neuere Version möchten, übernehmen Sie sie von
Hand aus dem [GitHub-Repository](https://github.com/Accenture/SWAO/tree/main/community-frameworks) und übertragen Ihre
Einstellungen; neue ausgelieferte Richtlinien ergänzen Sie mit `state: not_set`, bis Sie
sie geprüft haben.

### 5. Bewerten

**Landing-Zone-Live-Bewertung.** Wählen Sie die Baseline wie jedes Framework:

```bash
swao assess --type landing-zone-live --lz otc-prod --frameworks client-lz-policy-baseline
```

`--frameworks` akzeptiert die ID (`CLIENT_LZ_POLICY_BASELINE`) oder den Ordnernamen; eine
umbenannte Kopie wählen Sie über ihre ID. Eine Baseline je Lauf: Ein Lauf mit zwei
gewählten Baselines oder mit einer ungültigen `policy-baseline.yaml` wird abgelehnt, bevor
eine Anfrage gesendet wird. Jede aktivierte Richtlinie wird je Scope zweimal beantwortet:

- **Angebot:** Kann dieser Anbieter die Richtlinie hier erfüllen? `READY`,
  `READY_WITH_CHANGES` (der Mandant muss es konfigurieren), `BLOCKED`,
  `SOVEREIGNTY_BLOCKED` (die Datenresidenz scheitert in jeder angebotenen Region) oder
  `NEEDS_VERIFICATION`.
- **Bestand:** Ist der Mandant jetzt konform? `pass`, `fail`, `warn`, `na` (nichts, worauf
  die Richtlinie zutrifft) oder `unverified`, jeweils mit der Beobachtbarkeit: `observed`,
  `catalogue`, `not_collected` (die Quelle konnte nicht gelesen werden) oder
  `not_observable` (keine Nur-Lese-API beantwortet es, zum Beispiel ein dokumentierter
  Ausstiegsplan; eine solche Richtlinie ist ein manueller Nachweis).

Die Baseline erhält außerdem eine eigene Ampelspalte je Dienst. Mit der Vorgabe „nur
Deutschland“ ist jeder Dienst, der in einer nicht deutschen Region des Scopes angeboten
wird, in dieser Spalte rot. Der Ergebnisschritt der TUI zeigt eine Zeile je Scope mit dem
Gesamturteil und den Bestandszählern.

**Anwendungsbewertung.** Wählen Sie die Baseline für die Anwendung; die Anwendung wird
gegen den statischen LZ-Katalog bewertet. Live-Daten der Landing Zone nutzt nur die
Landing-Zone-Live-Bewertung (`swao assess --type landing-zone-live`), nie eine
Anwendungsbewertung:

```bash
swao regime-select --app app-crm-01 --regimes CLIENT_LZ_POLICY_BASELINE

# Statischer LZ-Katalog; Ziele als provider:region oder provider/region
swao assess --app app-crm-01 --lz-source catalogue --lz-cat-targets otc:eu-de,stackit/eu01
```

- Ein Anwendungslauf lehnt `--frameworks` ab (Exit 1); die Frameworks der Anwendung kommen
  aus `assessment.regimes_active` in `apps/app-crm-01/.swao.yml`.
- `--lz-cat-targets` akzeptiert `provider:region` und die Form `provider/region`, die SWAO
  ausgibt, sodass ein ausgegebenes Ziel wieder übergeben werden kann. Ein Eintrag, der
  kein Ziel nennt, wird mit Exit 1 abgelehnt.
- `--lz-source live`, `--lz` und `--scope` werden in einem Anwendungslauf vor dem ersten
  Pass mit Exit 1 abgelehnt, mit dem Hinweis auf
  `swao assess --type landing-zone-live --lz <lz-id>`.
- **Verknüpfte Anwendungen.** Eine Anwendung, die in `landing_zones[].scopes[].app`
  genannt ist, wird in jeder Stufe gegen den statischen Katalog bewertet, mit der Warnung
  „live landing-zone data is used only by the Landing Zone Live Assessment; assessed
  against the static LZ catalogue“, der verknüpften Landing Zone mit Scope und dem Befehl
  für Live-Ergebnisse; Exit 0. `run-context.yaml` hält `lz_source: catalogue` und den Grund
  fest (`lz_source_reason`, Grund `lz-live-assessment-only`). Ohne konfigurierte Ziele
  leitet SWAO sie aus den Scope-Regionen der Verknüpfung in `.swao.yml` ab; ein Live-Lauf
  wird nie gelesen. Die Verknüpfung bleibt für die Landing-Zone-Live-Bewertung und ihre
  Publikationen bestehen.

Die Baseline-Kontrollen einer Anwendung werden aus diesem Nachweis nach Regeln
entschieden, nie von einem LLM: `SATISFIED` (Richtlinie erfüllt), `GAP` (nicht erfüllt),
`PARTIAL` (durch Konfiguration erreichbar), `UNKNOWN` (nicht geprüft) oder `N_A` (trifft
nicht zu). Eine deaktivierte Richtlinie ist `N_A`, eine Richtlinie mit `not_set` ist
`UNKNOWN`. Mit dem statischen Katalog lassen sich nur Datenresidenz, die Dienstregeln und
`encryption_at_rest` entscheiden; jede andere Richtlinie ist `UNKNOWN` („static catalogue
has no tenant state“). Eine benötigte Fähigkeit, die ein aktiviertes `service_deny`
verbietet, macht außerdem den Eintrag der LZ-Eignung zu `BLOCKED_BY_POLICY` mit dem
Nachweis `baseline:<policy-id>`, zum Beispiel `baseline:CPB-SVC-03` für eine Anwendung,
die PostgreSQL braucht.

**Schlechtestes Ergebnis mit gereihten Beiträgen.** Wird eine Anwendung an mehreren
Katalogzielen oder Live-Scopes gemessen, erhält eine Kontrolle das schlechteste Ergebnis,
in der Reihenfolge `GAP`, `UNKNOWN`, `PARTIAL`, `SATISFIED`, `N_A`. Die anderen Ziele oder
Scopes bleiben sichtbar: Jede Entscheidung listet ihre Beiträge vom schlechtesten an, so
dass auch das zweit- und drittschlechteste Ergebnis berichtet werden kann. Ein Beitrag ist
mit dem Ziel (`otc/eu-de`) oder mit dem Scope und seinem Anbieter
(`scope crm (T Cloud Public)`) beschriftet. Beiträge gibt es für Datenresidenz und
`encryption_at_rest` beim Katalog und für jede Richtlinie bei der Live-Quelle; die
Dienstregeln entscheiden nach dem Bedarf der Anwendung und haben keine. Sie stehen in
`baseline-decisions.json` im Laufordner der Anwendung und in `11-comp.yaml` und erscheinen
im Ergebnisschritt der TUI. Die Compliance- und Kontrolltabellen der Publikation zeigen sie
im Zeilendetail als `Ranked per target or scope: 1. ...; 2. ...`.

Der Portfolio-Vergleich (unten) entscheidet Governance-Richtlinien (Datenresidenz,
Dienstregeln, Audit-Trail, Log-Aufbewahrung, MFA, Alter von Zugangsdaten, Budgetwarnungen)
am Plattform-Scope der Landing Zone, die Anwendung dagegen nimmt das schlechteste Ergebnis
über jeden Scope, den sie nutzt. Beide können daher abweichen; der Beitrag des
Plattform-Scopes ist der Wert des Portfolios.

### 6. Nachweisreferenzen

Jeder Befund eines Live-Laufs trägt eine Referenz der Form
`ev:<run>:<check or block>:Ref-<10 hex>`. Die Referenz enthält keine native ID und darf
daher in einer geteilten Publikation stehen. Die native ID, die Region, die Einstellung und
ein Konsolenlink bleiben in der lokalen Datei `evidence-refs.json` des Laufs, die nie
veröffentlicht oder synchronisiert wird.

```bash
# Die Referenzen des letzten Laufs auflisten (keine nativen IDs)
swao lz evidence --lz otc-prod

# Eine Referenz auflösen: native ID, Typ, Region, Einstellung und Konsolenlink
swao lz evidence "ev:2026-11-06T08-00-00:CPB-NET-02:Ref-0123456789" --open
```

`--open` öffnet den Konsolenlink im Standardbrowser; über den Zugriff entscheidet die
Anmeldung an der Konsole. Konsolenlinks folgen nur den URL-Mustern, die der Anbieter
dokumentiert. Sie öffnen deshalb eine Dienstseite oder die Startseite der Konsole, und die
ausgegebene native ID führt zum Element. `--run <ts>` listet einen anderen Lauf;
`--run-dir <dir>` löst aus einem Ordner von `swao lz scan --out` auf. Der Exit-Code ist 0,
wenn aufgelöst oder gelistet wurde, 1, wenn weder Referenz noch Landing Zone angegeben ist,
und 2 bei einer fehlerhaften, unbekannten oder laufremden Referenz, einem Lauf ohne
Nachweiskarte oder einer Ablehnung durch die Lizenzstufe. In der TUI bietet der
Ergebnisschritt „Evidence references (resolve locally)“ an: Enter löst auf, `o` öffnet den
Konsolenlink. Der HTML Editor löst eine angeklickte Referenz in seiner lokalen Vorschau auf.

`swao lz hierarchy otc-prod` gibt den Mandantenbaum des letzten Laufs aus, mit
pseudonymisierten Knotennamen und den Baseline-Zählern `fail` und `unverified` je Knoten
(TUI: „Tenant hierarchy“).

### 7. Veröffentlichen

```bash
# Eine Landing Zone: Baseline-Übersicht, Richtlinien, manuelle Nachweise, Herkunft der Anforderungen
swao publish --lz-live otc-prod

# Mehrere Landing Zones gegen eine Baseline (Enterprise)
swao assess --portfolio --type landing-zone-live
swao publish --portfolio --block-profile lz-live-baseline-comparison
```

Die `lz-live`-Publikation zeigt die Baseline-Blöcke nur, wenn der Lauf eine Baseline
gewählt hat. Der Vergleich schreibt `wsp/publications/latest-lz-live-baseline-comparison.html`;
der Portfolio-Bildschirm der TUI bietet ihn als „Client Policy Baseline Comparison (HTML)“
an, und der HTML Editor führt das Profil ebenfalls.

### 8. Den Vergleich lesen

Die Portfolio-Zusammenführung gibt eine Zeile je Landing Zone aus, zum Beispiel
(Werte zur Veranschaulichung):

```
baseline CLIENT_LZ_POLICY_BASELINE 1.0.0 (sha256 3f2a9c0d1e4b): 17 policies compared across 3 landing zone(s)
  stackit-prod (STACKIT): READY_WITH_CHANGES; fit 9/17 READY, 5 with changes, 3 need verification, 0 blocked, rank 1
  otc-prod (T Cloud Public): BLOCKED; fit 8/17 READY, 5 with changes, 3 need verification, 1 blocked, rank 2
  aws-prod (AWS): SOVEREIGNTY_BLOCKED; different baseline (sha256 9b8e7d6c5a41), not ranked
  not met by any landing zone: CPB-PRT-01
```

- **Eignung (fit)** ist die Zahl der aktivierten Richtlinien, die die Landing Zone wie
  angeboten erfüllt (`READY`), von allen aktivierten Richtlinien. `NEEDS_VERIFICATION` wird
  getrennt gezählt, nie als Eignung.
- **Rang (rank)** ordnet die Landing Zones nach Eignung, dann nach weniger blockierten
  Richtlinien. Eine Landing Zone ohne eine einzige `READY`-Richtlinie erhält keinen Rang.
- **Nur gleiche Baseline.** Ein Vergleich gilt nur, wenn jede Landing Zone mit derselben
  `policy-baseline.yaml` (gleicher Hash) bewertet wurde. Eine Landing Zone, die mit anderen
  Einstellungen bewertet wurde, erscheint als „different baseline“, behält ihre Zellen und
  erhält keinen Rang. Führen Sie ihre Live-Bewertung mit der aktuellen Baseline erneut aus,
  um sie zu vergleichen.
- **Not met by any landing zone** listet die Richtlinien, die keine vergleichbare Landing
  Zone wie angeboten erfüllt.
- **Je Landing Zone** übernimmt eine Richtlinie bei Governance-Richtlinien das Ergebnis des
  Plattform-Scopes und sonst das schlechteste Ergebnis über die Scopes; ein `fail` in einem
  Scope ist ein `fail` für die Landing Zone.
- **Herkunft der Anforderungen.** Alle gewählten Frameworks werden als Vereinigung
  zusammengeführt. Ein Framework, das `EU` akzeptiert, lässt daher Regionen in anderen
  EU-Ländern die Datenresidenz bestehen, auch wenn die Baseline nur `DE` vorgibt. Der Block
  zur Herkunft der Anforderungen listet jeden zusammengeführten Wert mit den Frameworks,
  die ihn beigetragen haben, sodass Sie sehen, welches Framework eine Regel erweitert hat.
- **Annahmen.** Die Baseline-Übersicht listet jede Richtlinie, deren Vorgabewert eine
  Annahme ist, die nicht geprüften Richtlinien (`not_set`) mit ihrem ausgelieferten
  Vorgabewert und die deaktivierten.

---

## Health Check

Der Health Check (`swao health-check`) enthält Prüfung 26, **LZ connections**. Sie ruft
den Provider nicht auf: Sie zeigt die letzte Nur-Lese-Prüfung jedes registrierten Scopes
(von `swao lz probe`, vom Schritt Probe des Landing Zone Live Setups, von
`swao lz connect` oder vom letzten Lauf) und den letzten Lauf. Je Scope gibt sie zwei Zeilen aus: das Ergebnis in
Worten (nur lesend verifiziert; schreibfähig, für diesen Lauf akzeptiert; nicht
verifizierbar; Anmeldung fehlgeschlagen; noch nicht geprüft; Zugangsdaten unvollständig;
Token abgelaufen) und die Fakten (Abdeckung, Zeitpunkt der Prüfung, die Namen der
gespeicherten Zugangsdatenfelder sowie die Dienste und Ressourcen, die der letzte Lauf
gelesen hat). Eine Prüfung, die älter als 7 Tage ist, gilt als veraltet; prüfen Sie erneut.
Sie meldet:

- `ok`, wenn jeder Scope eine aktuelle, nur lesend verifizierte Prüfung hat.
- Eine Warnung, die ihre Ursachen nennt, zum Beispiel "1 scope with a write-capable login
  (a run asks for confirmation)", wenn ein Scope schreibfähig, nicht verifizierbar oder
  nicht geprüft ist, Zugangsdaten fehlen, ein Token abgelaufen ist, der Build keinen
  Treiber hat oder die Prüfung veraltet ist.
- Nur eine Information, wenn keine Landing Zone registriert ist.

Die Prüfung lässt den Health Check nie fehlschlagen. Siehe [Health Check](/de/health-check).

---

## Simulierte Umgebungen

SWAO kann für Entwicklung und Tests gegen einen simulierten Cloud-Anbieter laufen. Ein
Lauf gilt als simuliert, wenn seine Antworten den Simulations-Header oder das
Token-Merkmal tragen oder eine Endpunktumleitung verwendet wurde. Die Endpunktumleitung
ist die Umgebungsvariable `SWAO_LZ_MOCK_ENDPOINTS`; sie akzeptiert nur
https-Loopback-Adressen und wird nie aus `.swao.yml` gelesen. Ein simulierter Lauf wird:

- im Scan (`meta.simulated`) und im Run-Manifest gekennzeichnet;
- in der CLI-Ausgabe als `simulated environment (...)` ausgewiesen;
- mit dem Banner **Simulated environment** veröffentlicht, das die Daten als reinen
  Entwicklungs- und Testnachweis ausweist, nie als Kundennachweis;
- als Quelle einer Katalogaktualisierung abgelehnt;
- aus der Portfolio-Zusammenführung herausgehalten, außer mit `--include-simulated`.

### Simulierte Modelle der Cloud-Anbieter

Das SWAO-Team pflegt simulierte Modelle von T Cloud Public, STACKIT, AWS und Azure. Jedes
Modell beantwortet die lesenden API-Aufrufe der Live-Treiber im Wire-Format des Anbieters
und bietet Szenarien wie vollständiger Leser, schreibfähige Identität, fehlende
Berechtigungen, abgelaufenes Token, Drosselung, Teilausfall und fehlende Region. Das
Azure-Modell ist ausschließlich aus der veröffentlichten API-Spezifikation abgeleitet.

Die Modelle und ihre Daten werden nicht mit SWAO ausgeliefert. Für eine Demo, eine
Schulung oder einen Testaufbau mit einem simulierten Modell wenden Sie sich an das
SWAO-Team unter swao-tool@accenture.com.

Mit einem vom SWAO-Team bereitgestellten Modell läuft die Bewertung mit den üblichen
Befehlen. Zum Modell gehören eine Endpunktdatei, ein lokales CA-Zertifikat und eine
Testidentität:

```bash
export SWAO_LZ_MOCK_ENDPOINTS=<Endpunktdatei des Modells>
export NODE_EXTRA_CA_CERTS=<CA-Zertifikat des Modells>

swao lz connect <lz-id> ...        # mit der Testidentität des Modells
swao lz probe <lz-id>
swao assess --type landing-zone-live --lz <lz-id> --frameworks client-lz-policy-baseline
swao publish --lz-live <lz-id>      # mit dem Banner Simulated environment
swao assess --portfolio --type landing-zone-live --include-simulated
```

Entfernen Sie beide Variablen vor einem Lauf gegen einen echten Anbieter. Ein simulierter
Lauf ist nie ein Nachweis über eine Kundenumgebung.

---

## Automatisierung (Cron und CI)

Die Live-Bewertung läuft unbeaufsichtigt, wenn die Zugangsdaten aus dem Vault oder aus
`SWAO_CREDENTIAL_*`-Variablen kommen:

```bash
swao assess --type landing-zone-live --lz otc-prod --frameworks bsi-c5
echo "exit $?"   # 0 vollständig, 1 teilweise, fehlerhaft, abgelehnt oder ungültige Eingabe
```

- Kurzlebige Zugänge (zum Beispiel AWS-Sitzungsschlüssel) müssen vor jedem Lauf erneuert
  werden. Ein abgelaufenes Token lässt den Scope fehlschlagen, und der Lauf endet dann mit
  Exit-Code 1.
- Die Bestätigungsflags sind für eine Person gedacht, die das Prüfergebnis gelesen hat.
  Sie gelten für einen Lauf und können nicht in `.swao.yml` gespeichert werden. Setzen Sie
  sie in einer Pipeline nur bewusst.
- Prüfen Sie immer den Exit-Code. Ein von der Nur-Lese-Sperre gestoppter Scope ist in
  `run-status.json` als `refused` vermerkt.

---

## Live-Läufe aufzeichnen (für Fortgeschrittene)

Um die Antworten des Anbieters zur Analyse festzuhalten, setzen Sie `SWAO_LZ_RECORD` auf
einen absoluten Ordner außerhalb jedes Repositorys, Workspace und `wsp`-Ordners. SWAO
lehnt jeden anderen Ort mit Exit-Code 2 ab, weil Aufzeichnungen Mandantendaten enthalten
können. Eine Aufzeichnung enthält:

- `run.json`;
- eine Zeile je Anfrage in `requests.ndjson`;
- die Antwortinhalte in `bodies/`.

Anfrage-Header, Anfrageinhalte, Zugangsdaten und OAuth-Token werden nie aufgezeichnet.

---

## Einschränkungen

- Noch nicht jede Quelle ist für jeden Anbieter verfügbar (siehe die Tabelle oben).
  Fehlende Quellen erscheinen im Scan als `not_collected`.
- Die Nur-Lese-Prüfung mancher Anbieter kann einen Zugang mit minimalen Rechten nicht
  verifizieren; er braucht dann `--accept-unverified-read-only`.
- Die Live-Bewertung liest Konfiguration und Bestand, nicht die Daten in den Ressourcen.
- Die Ergebnisse beschreiben die Landing Zone zum Zeitpunkt des Laufs. Vergleichen Sie
  Läufe oder nutzen Sie die Abweichungssicht des Portfolios, um Änderungen zu verfolgen.

---

## Weiterführende Informationen

- [Landing-Zone-Katalog-Bewertung](/de/assessment/landing-zone)
- [Framework Client LZ Policy Baseline](/de/frameworks/client-lz-policy-baseline)
- [Überblick über die Bewertungen](/de/assessment/)
- [Health Check](/de/health-check), [Tools](/de/tools) und [Portfolio](/de/portfolio)
- [HTML veröffentlichen](/de/publish-html)
