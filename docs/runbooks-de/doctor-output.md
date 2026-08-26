# Doctor-Ausgabe verstehen

`swao doctor` führt vor einem Assessment eine Reihe von Umgebungsprüfungen durch und meldet für jeden Prüfpunkt einen Status (Bestanden/Nicht bestanden/Warnung). Dieses Runbook erläutert, was jeder Prüfpunkt prüft, was die farbcodierten Status bedeuten und wie häufige Fehler behoben werden können.

---

## Doctor ausführen

```bash
swao doctor

# Expanded output with sub-check details
swao doctor --verbose
```

Beispielausgabe:

```
SWAO v0.5.1 -- environment check

  LLM connectivity       green   Anthropic reachable; model: claude-3-5-sonnet-20241022
  Playwright             yellow  Chromium not found; dynamic pass will be skipped
  Licence                green   Consultant; expires 2027-01-15 (197 days)
  Schema version         green   workspace: 1.3  binary: 1.3
  Workspace layout       green   3 apps found in .swao.yml
  Output directory       green   ./wsp (writable)

Summary: 5 green, 1 yellow, 0 red
```

---

## Prüfpunkt-Referenz

| Prüfpunkt | Grün-Bedingung | Gelb-Bedingung | Rot-Bedingung |
|---|---|---|---|
| LLM connectivity | Provider erreichbar und antwortet innerhalb des Timeouts | Antwortlatenz >5 s | Keine Antwort, Authentifizierungsfehler oder Key nicht gesetzt |
| Playwright | Chromium gefunden und startet korrekt | Browser nicht gefunden (Dynamic Pass deaktiviert) | Browser gefunden, aber Start schlägt fehl |
| Licence | Gültige Lizenz, >30 Tage bis zum Ablauf | Gültige Lizenz, <=30 Tage bis zum Ablauf | Lizenz abgelaufen oder Schlüsseldatei fehlt/beschädigt |
| Schema version | Workspace-Schema stimmt mit Binary-Erwartung überein | Geringfügige Schema-Version-Diskrepanz (additive Felder) | Grosse Schema-Diskrepanz (Breaking Change) |
| Workspace layout | `.swao.yml` gefunden und parseabr; mindestens eine App definiert | `source_path`-Verzeichnisse von Apps fehlen | `.swao.yml` fehlt oder schlägt Schema-Validierung fehl |
| Output directory | Konfigurierter Ausgabepfad vorhanden und beschreibbar | -- | Ausgabepfad nicht vorhanden oder schreibgeschützt |

---

## LLM-Konnektivitäts-Prüfpunkt

**Grün** -- der konfigurierte Provider gibt eine erfolgreiche Antwort auf einen einfachen Test-Prompt zurück.

**Gelb** -- die Anfrage war erfolgreich, daürte aber länger als fünf Sekunden. Das Assessment läuft, kann aber bei einzelnen Passes eine Zeitüberschreitung erleiden, wenn der Provider ausgelastet ist.

**Rot** -- die Anfrage ist fehlgeschlagen. Häufige Ursachen:

- `ANTHROPIC_API_KEY` ist nicht gesetzt oder falsch.
- Die Variable `SWAO_LLM_PROVIDER` verweist auf einen nicht laufenden Provider (z. B. Ollama gestoppt).
- Ein Netzwerk-Proxy oder eine Firewall blockiert die ausgehende Anfrage.

Behebung:

```bash
# Verify the key is set
echo $ANTHROPIC_API_KEY

# Test connectivity manually
curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" | jq '.models[0].id'
```

---

## Playwright-Prüfpunkt

**Grün** -- Chromium ist installiert und startet fehlerfrei.

**Gelb** -- Chromium wurde nicht gefunden. Der `dynamic`-Pass wird automatisch deaktiviert; alle anderen Passes laufen normal. Dies ist für Server-Umgebungen und CI-Pipelines akzeptabel, die kein browser-gestütztes Probing benötigen.

**Rot** -- Chromium wurde gefunden, schlägt aber beim Starten fehl (z. B. fehlende Shared Libraries unter Linux).

Behebung bei Gelb:

```bash
# Install Chromium via Playwright
npx playwright install chromium

# Verify
npx playwright --version
```

Behebung bei Rot (Linux):

```bash
# Install required shared libraries
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libasound2
```

---

## Lizenz-Prüfpunkt

**Grün** -- eine gültige Lizenz ist vorhanden und läuft in mehr als 30 Tagen ab.

**Gelb** -- die Lizenz läuft innerhalb von 30 Tagen ab. Das Assessment läuft normal; vor dem Ablauf erneürn, um Unterbrechungen zu vermeiden.

**Rot** -- die Lizenz ist abgelaufen oder die Lizenzdatei fehlt. Consultant-/Enterprise-Funktionen sind gesperrt. Community-Funktionen bleiben verfügbar.

Behebung:

```bash
# Check expiry date
swao license status

# Renew
swao license request
# email the token, receive new key
swao license activate <new-key>
```

---

## Schema-Version-Prüfpunkt

**Grün** -- das Feld `schema_version` in `.swao.yml` stimmt mit der Version überein, die die installierte Binary erwartet.

**Gelb** -- eine geringfügige Versions-Diskrepanz (z. B. Workspace ist `1.2`, Binary erwartet `1.3`). Das Assessment läuft, neü Felder können jedoch auf null/null defaulten.

**Rot** -- eine grosse Versions-Diskrepanz. Die Binary kann die Workspace-Konfiguration nicht sicher parsen. Entweder die Binary aktualisieren oder `swao migrate-config` ausführen, um das Workspace-Schema zu aktualisieren.

```bash
# Migrate workspace config to current schema
swao migrate-config

# Then re-run doctor
swao doctor
```

---

## Workspace-Layout-Prüfpunkt

**Grün** -- `.swao.yml` ist vorhanden, parst fehlerfrei und definiert mindestens eine App.

**Gelb** -- ein oder mehrere in `.swao.yml` referenzierte `source_path`-Verzeichnisse existieren nicht auf dem Datenträger. Static- und SAST-Passes werden für diese Apps übersprungen.

**Rot** -- `.swao.yml` fehlt, ist nicht parsebar (YAML-Syntaxfehler) oder schlägt die Schema-Validierung fehl.

```bash
# Validate YAML syntax
swao doctor --verbose 2>&1 | grep -A5 "Workspace layout"

# Or parse manually
cat .swao.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)"
```

---

## Schnellreferenz häufiger Fehler

| Symptom | Prüfpunkt | Behebung |
|---|---|---|
| `LLM connectivity: red` | LLM | `ANTHROPIC_API_KEY` setzen; Netzwerk prüfen |
| `Playwright: yellow` | Playwright | `npx playwright install chromium` ausführen |
| `Licence: red` | Lizenz | Per `swao license activate` erneürn |
| `Schema version: red` | Schema | `swao migrate-config` ausführen |
| `Workspace layout: red` | Workspace | `.swao.yml`-Syntax korrigieren oder Datei erstellen |
| `Output directory: red` | Ausgabe | Ausgabeverzeichnis erstellen oder Berechtigungen korrigieren |
