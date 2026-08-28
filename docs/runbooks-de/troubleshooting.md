# Fehlerbehebung

Referenz für die häufigsten SWAO-Fehler. Jeder Eintrag enthält die Fehlermeldung oder das Symptom, die wahrscheinliche Ursache und die Behebungsschritte.

---

## MODULE_NOT_FOUND pdfkit

**Symptom:** SWAO beendet sich mit `Error: Cannot find module 'pdfkit'` oder einem ähnlichen Fehler zu nativen Modulen.

**Ursache:** Die im Binary gebündelte native Abhängigkeit (pdfkit oder ein plattformspezifischer Begleiter) wurde beim Start nicht korrekt extrahiert. Dies kann passieren, wenn die Binary unvollständig heruntergeladen wurde, an einen schreibgeschützten Ort verschoben wurde oder der Extraktionscache (`~/.swao/cache/`) beschädigt ist.

**Behebung:**

```bash
# Clear the extraction cache and let SWAO re-extract on next run
rm -rf ~/.swao/cache/

# Then re-run the command that failed
swao --version
```

Bleibt der Fehler bestehen, eine frische Kopie der Binary von der Releases-Seite herunterladen und deren SHA-256-Prüfsumme vor der Installation verifizieren.

---

## EACCES permission denied

**Symptom:** `Error: EACCES: permission denied` beim Ausführen von `swao` unter Linux oder macOS.

**Ursache:** Das Ausführungsrechte-Bit der Binary ist nicht gesetzt.

**Behebung:**

```bash
chmod +x /usr/local/bin/swao

# Or wherever the binary lives
which swao
chmod +x "$(which swao)"
```

---

## API-Key nicht gesetzt

**Symptom:** `Error: ANTHROPIC_API_KEY is not set` oder `LLM connectivity: red` in `swao health-check`.

**Ursache:** Die Anthropic-API-Key-Umgebungsvariable fehlt in der aktüllen Shell-Sitzung.

**Behebung:**

```bash
# Set for the current session
export ANTHROPIC_API_KEY="sk-ant-..."

# Set permanently in your shell profile
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc

# Verify
swao health-check
```

Für CI-Umgebungen den Schlüssel als Repository-Secret speichern und per Workflow einbinden (siehe [CI/CD-Pipeline-Integration](./cicd-pipeline.md)).

---

## WSP-Schema-Diskrepanz

**Symptom:** `swao health-check` meldet `Schema version: red`; das Assessment schlägt mit einem Schema-Validierungsfehler fehl.

**Ursache:** Die `.swao.yml` des Workspaces deklariert eine ältere Schema-Version als die installierte Binary erwartet, oder umgekehrt.

**Behebung:**

```bash
# Preview the migration
swao migrate-config --dry-run

# Apply
swao migrate-config

# Verify
swao health-check
```

Bei einem bewussten Rollback auf eine ältere Binary sicherstellen, dass die Binary-Version mit der in `.swao.yml` deklarierten Schema-Version übereinstimmt.

---

## Playwright nicht gefunden

**Symptom:** `Playwright: yellow` in `swao health-check`; der `dynamic`-Pass wird übersprungen.

**Ursache:** Playwright und/oder Chromium sind nicht installiert. Der gelbe Status bedeutet, dass der Dynamic Pass automatisch deaktiviert wird -- andere Passes laufen normal.

**Behebung:**

```bash
npx playwright install chromium

# On Linux, also install system dependencies
npx playwright install-deps chromium
```

Nach der Installation `swao health-check` erneut ausführen, um zu bestätigen, dass der Prüfpunkt grün wird.

---

## MCP-Verbindung verweigert

**Symptom:** Claude Code (oder ein anderer MCP-Client) meldet `Connection refused` beim Versuch, SWAO-Tools zu nutzen.

**Ursache:** Der SWAO-MCP-Server läuft nicht.

**Behebung:**

```bash
# Start the MCP server
swao mcp --http

# Verify it is listening
curl http://localhost:3737/health
```

Optionen für einen persistenten Server-Betrieb findet sich unter [MCP-Server-Integration](./mcp-integration.md).

---

## Lizenz abgelaufen

**Symptom:** `swao health-check` meldet `Licence: red`; Consultant-/Enterprise-Funktionen sind nicht verfügbar.

**Ursache:** Der Aktivierungsschlüssel hat sein Ablaufdatum überschritten.

**Behebung:**

```bash
swao license request
# Send the token to the SWAO team to receive a renewal key
swao license activate <new-key>
swao license status
```

Community-Edition-Funktionen bleiben ohne Lizenzschlüssel verfügbar.

---

## Binary wird als Virus gemeldet

**Symptom:** Windows Defender oder ein Drittanbieter-AV-Produkt stellt `swao-enterprise-win.exe` unter Quarantäne oder löscht die Datei.

**Ursache:** Heuristischer Fehlalarm. Gepackte Node.js-Binaries werden von reputationsbasierten AV-Engines manchmal markiert.

**Behebung:** Die vollständige Freigabeprozedur findet sich unter [Windows: SWAO-Binary freigeben](./windows-binary-allowlisting.md). Den SHA-256-Hash der heruntergeladenen Binary vor der Freigabe gegen die veröffentlichte `sha256sums.txt` verifizieren, um eine echte Bedrohung auszuschliessen.

---

## swao health-check: LLM-Timeout

**Symptom:** `LLM connectivity: red` oder `yellow` mit Timeout-Fehler; Assessment-Passes hängen sich auf.

**Ursache:** Der LLM-Provider-Endpunkt ist nicht erreichbar oder zu langsam. Häufige Ursachen sind eine Proxy-Fehlkonfiguration, eine Firewall-Regel, die ausgehendes HTTPS blockiert, oder eine eingeschränkte Verfügbarkeit der Anthropic-/OpenAI-API.

**Behebung:**

```bash
# Test direct connectivity
curl -v https://api.anthropic.com/v1/models \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01"

# Temporarily bypass using --skip-llm
swao assess --app my-app --skip-llm
```

Wenn die Umgebung den Datenverkehr über einen HTTP-Proxy leitet, `HTTPS_PROXY` vor dem Ausführen von SWAO setzen:

```bash
export HTTPS_PROXY="http://proxy.example.com:8080"
swao health-check
```

---

## publish: Browser nicht gefunden

**Symptom:** `swao publish` bricht mit einem Fehler ab, dass kein Browser gefunden wurde.

**Ursache:** `swao publish` verwendet den Standard-Systembrowser (oder Playwrights Chromium), um die Berichtsgalerie zu öffnen. Ist keiner konfiguriert, schlägt der Befehl fehl.

**Behebung:**

```bash
# Option A: export the gallery to HTML instead of opening a browser
swao publish --export ./dist/gallery

# Option B: set the BROWSER environment variable
export BROWSER=/usr/bin/chromium-browser
swao publish

# Option C: install Playwright Chromium
npx playwright install chromium
```

---

## pbit-Vorlage lädt nicht

**Symptom:** Power BI Desktop verweigert das Öffnen der `.pbit`-Vorlage oder zeigt einen "beschädigte Datei"-Fehler.

**Ursache:** Die `.pbit`-Vorlagendatei wurde programmatisch verändert (z. B. per Zip-Rewrite-Skript). Das OPC-Paketformat von Power BI übersteht keine generischen Zip-Roundtrips.

**Behebung:** Die `.pbit`-Datei nativ aus Power BI Desktop re-exportieren:

1. Die `.pbix`-Qülldatei in Power BI Desktop öffnen.
2. **Datei > Exportieren > Power BI-Vorlage** auswählen.
3. Die neü `.pbit`-Datei speichern.

Keine `jszip`- oder ähnlichen Bibliotheken zum Patchen von `.pbit`-Dateien verwenden. Die Begründung findet sich im Audit-Gate `pbit-template-native`.

---

## Speichermangel

**Symptom:** Der SWAO-Prozess wird während eines grossen Assessment-Laufs aufgrund von Speichermangel beendet.

**Ursache:** Der LLM-Pass verarbeitet App-Qülldateien oder Kontexteingaben im Arbeitsspeicher. Sehr grosse Repositories oder hohe `--max-apps`-Werte können den verfügbaren RAM erschöpfen.

**Behebung:**

```bash
# Reduce the number of apps assessed in a single run
swao assess --app my-app --max-apps 5

# Run apps sequentially instead of in parallel
swao assess --app app-one
swao assess --app app-two

# Limit Node.js heap size
NODE_OPTIONS="--max-old-space-size=4096" swao assess --app my-app
```

Tritt das Problem bei einer bestimmten App weiterhin auf, grosse Kontextimportdateien (`imports/*.csv`) vor dem Assessment-Lauf auf ihre Grösse prüfen und bei Bedarf reduzieren.
