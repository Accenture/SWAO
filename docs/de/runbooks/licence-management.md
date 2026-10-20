# Lizenzverwaltung

SWAO wird in drei Stufen ausgeliefert (Community, Consultant und Enterprise), die jeweils zusätzliche Funktionen freischalten. Dieses Runbook beschreibt die Lizenzanforderung, Aktivierung, den Offline-Betrieb, die Statusabfrage sowie den Umfang der einzelnen Stufen.

---

## Stufenvergleich

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| Anwendungs-, Landing-Zone-, LLM- und Service-Portfolio-Bewertung (alle Passes, alle LLM-Adapter) | Ja | Ja | Ja |
| Service-Recherche inkl. LLM-Recherche (`swao service research`) | Ja | Ja | Ja |
| Community- und eigene Compliance-Frameworks (YAML) | Ja | Ja | Ja |
| Text-, YAML- und JSON-Berichte (`swao report`) | Ja | Ja | Ja |
| Sternschema-BI-Export: CSV, NDJSON, XLSX (`swao export`) | Ja | Ja | Ja |
| Auditprotokoll (`swao log`) | Ja | Ja | Ja |
| HTML-Veröffentlichung (`swao publish --app`, `swao report --format html`) | Nein | Ja | Ja |
| PDF-Bericht (`swao report --format pdf`) | Nein | Ja | Ja |
| Power-BI-Dashboard-Vorlagen (.pbit, von `swao export` und `swao init --powerbi` abgelegt) | Nein | Ja | Ja |
| LZ-Katalog-Aktualisierung (`swao lz catalogue update`) | Nein | Ja | Ja |
| E-Mail-Support-SLA | Nein | Ja | Ja |
| Portfolio-Bewertung, -Bericht und -BI-Export (`--portfolio`) | Nein | Nein | Ja |
| Service-Portfolio-Export (`swao service export`) | Nein | Nein | Ja |
| Adversarielle Challenge-Review (`swao challenge`) | Nein | Nein | Ja |
| HTML-Editor (interaktiver Evidenz-Editor, `swao publish --edit`) | Nein | Nein | Ja |
| MCP-Server (`swao mcp`) | Nein | Nein | Ja |
| SWAO Chat (`swao chat`) | Nein | Nein | Ja |
| Terraform-Modul-Stubs (`swao generate-tf`) und meshcloud-UniPipe-Integration (`swao unipipe`) | Nein | Nein | Roadmap |

Ein Befehl, der eine höhere Stufe erfordert, gibt einen `[LICENSE]`-Block mit der erforderlichen Lizenz aus und endet mit einem Exit-Code ungleich null. `swao export` schreibt in der Community-Edition das Sternschema und gibt anstelle der Power-BI-Vorlagen einen `[LICENSE]`-Hinweis aus.

Die Community-Edition läuft ohne Lizenzschlüssel. Alle Funktionen sind lokal verfügbar, ohne Registrierung.

---

## 1. Aktuellen Lizenzstatus prüfen

```bash
swao license status
```

Beispielausgabe:

```
Licence tier:    Community
Key:             (none)
Expires:         n/a
Features:        core, llm, report/pdf
```

Der Befehl `swao health-check` gibt den Lizenzstatus ebenfalls als einen seiner Prüfpunkte aus.

---

## 2. Upgrade von Community auf Consultant

### Schritt 1: Lizenztoken anfordern

```bash
swao license request
```

Dieser Befehl gibt einen Token auf stdout aus, der den Rechner-Fingerabdruck verschlüsselt. Den vollständigen Token kopieren.

### Schritt 2: Token an das SWAO-Team senden

Den Token an die auf der SWAO-Releases-Seite oder in der Beschaffungsvereinbarung angegebene Adresse senden. Das Team stellt einen an den Token gebundenen Aktivierungsschlüssel aus.

### Schritt 3: Schlüssel aktivieren

```bash
swao license activate <activation-key>
```

Bei Erfolg zeigt `swao license status` die neue Stufe und das Ablaufdatum an.

---

## 3. Offline-Aktivierung

Für Rechner ohne ausgehenden Internet-Zugang steht ein Export-/Import-Workflow bereit:

```bash
# On the internet-connected machine: generate the request file
swao license request --export /tmp/swao-licence-request.json

# Transfer the JSON file to the machine that can reach the SWAO licensing service
# then on that machine:
swao license import --key <activation-key> --output /tmp/swao-licence-token.json

# Transfer the token file back to the air-gapped machine and apply it
swao license import /tmp/swao-licence-token.json
```

Das Lizenztoken ist ein signiertes JSON-Payload. Es enthält keine personenbezogenen Daten außer dem Rechner-Fingerabdruck, der beim `request`-Aufruf eingebettet wird.

---

## 4. Erneuerung

Lizenzen haben ein Ablaufdatum. Wenn eine Lizenz innerhalb von 30 Tagen abläuft, gibt `swao health-check` eine gelbe Warnung beim Lizenz-Prüfpunkt aus. Nach dem Ablauf wird der Prüfpunkt rot, und Consultant-/Enterprise-Funktionen werden bis zur Erneuerung gesperrt.

```bash
# Check days remaining
swao license status

# Renew: follow the same request -> activate flow as initial activation
swao license request
# email the token, receive new key
swao license activate <new-key>
```

Die Community-Edition läuft unbegrenzt und erfordert keine Erneuerung.

---

## 5. Speicherort der Lizenzdatei

Die aktivierte Lizenz wird lokal gespeichert unter:

- **Linux / macOS:** `~/.swao-license.json`
- **Windows:** `%USERPROFILE%\.swao-license.json`

Diese Datei nicht manuell bearbeiten. Bei Beschädigung löschen und neu aktivieren.

```bash
# Linux/macOS
rm ~/.swao-license.json
swao license activate <key>

# Windows (PowerShell)
Remove-Item "$env:USERPROFILE\.swao-license.json"
swao license activate <key>
```

---

## 6. Enterprise-Lizenzen

Enterprise-Lizenzen werden organisationsweit über einen Lizenzserver bereitgestellt. Für den Enterprise-Onboarding-Leitfaden das SWAO-Team kontaktieren. Die oben beschriebenen `swao license`-Unterbefehle gelten gleichermaßen; der Unterschied besteht darin, dass der Aktivierungsschlüssel pro Organisation statt pro Nutzer ausgestellt wird.
