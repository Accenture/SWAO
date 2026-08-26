# Linux: SWAO installieren

Dieses Runbook beschreibt die Installation der SWAO-Binary unter Linux, die PATH-Konfiguration für Root- und Nicht-Root-Nutzer sowie die Einrichtung einer optionalen systemd-Service-Unit für Server-Deployments.

---

## Voraussetzungen

- Eine 64-Bit-Linux-Distribution (x86_64 oder arm64)
- `curl` oder `wget` zum Herunterladen der Binary
- `sudo`-Zugriff für systemweite Installationspfade (optional)

---

## 1. Binary herunterladen

```bash
# Replace <version> with the target release tag (e.g. v0.5.1)
VERSION="<version>"

# x86_64 (most common)
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-linux-x64"

# arm64
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-linux-arm64"
```

Prüfsumme vor der Installation verifizieren:

```bash
# Download the SHA-256 manifest
curl -Lo /tmp/sha256sums.txt \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/sha256sums.txt"

# Verify
sha256sum /tmp/swao
grep "swao-linux-x64" /tmp/sha256sums.txt
# The first column of each output must match
```

---

## 2. Systemweite Installation (erfordert sudo)

```bash
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao

# Confirm it is on PATH
which swao
swao --version
```

`/usr/local/bin` ist auf den meisten Linux-Distributionen standardmässig im `$PATH` enthalten. Fehlt es, siehe Abschnitt 4.

---

## 3. Installation ohne Root-Rechte nach ~/.local/bin

Für gemeinsam genutzte Server oder Umgebungen ohne `sudo`-Zugriff:

```bash
mkdir -p ~/.local/bin
chmod +x /tmp/swao
mv /tmp/swao ~/.local/bin/swao
```

Anschliessend sicherstellen, dass `~/.local/bin` im PATH enthalten ist (siehe Abschnitt 4).

---

## 4. PATH konfigurieren

Prüfen, ob das Installationsverzeichnis im PATH vorhanden ist:

```bash
echo $PATH | tr ':' '\n'
```

Fehlt `/usr/local/bin` oder `~/.local/bin`, kann es zum Shell-Profil hinzugefügt werden:

```bash
# For bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# For zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 5. Optionale systemd-Service-Unit

Für Server-Deployments, auf denen SWAO als daürhaft laufender MCP-Server oder geplanter Assessment-Runner betrieben wird, kann eine systemd-Unit angelegt werden:

```ini
# /etc/systemd/system/swao-mcp.service
[Unit]
Description=SWAO MCP HTTP server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/swao mcp --http
Restart=on-failure
RestartSec=5
User=swao
Group=swao
WorkingDirectory=/opt/swao/workspace
Environment=ANTHROPIC_API_KEY=<key>
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Service aktivieren und starten:

```bash
# Create a dedicated system user (optional but recommended)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin swao

# Reload systemd and enable the service
sudo systemctl daemon-reload
sudo systemctl enable swao-mcp
sudo systemctl start swao-mcp

# Check status
sudo systemctl status swao-mcp
journalctl -u swao-mcp -f
```

Den Wert für `ANTHROPIC_API_KEY` über eine separate Umgebungsdatei statt direkt in der Unit-Datei speichern:

```bash
# /etc/systemd/system/swao-mcp.service.d/env.conf
[Service]
EnvironmentFile=/etc/swao/env
```

```bash
# /etc/swao/env  (mode 0600, owned by root)
ANTHROPIC_API_KEY=sk-...
```

---

## 6. Installation verifizieren

```bash
swao --version
swao doctor
```

Alle `swao doctor`-Prüfpunkte sollten grün sein. Ein gelbes Ergebnis beim Playwright-Prüfpunkt ist auf Servern ohne installierten Browser erwartet; es betrifft ausschliesslich den Befehl `swao publish`.

---

## 7. Aktualisierung

Die neü Binary nach `/tmp/swao` herunterladen, die Prüfsumme verifizieren und dann die alte Binary ersetzen:

```bash
# Stop the service if running
sudo systemctl stop swao-mcp

chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao

# Restart and verify
sudo systemctl start swao-mcp
swao --version
swao doctor
```
