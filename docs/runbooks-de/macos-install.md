# macOS: SWAO installieren

macOS Gatekeeper blockiert standardmässig unsignierte oder neu verteilte Binaries. Dieses Runbook beschreibt das Herunterladen der SWAO-Binary, das Entfernen des Quarantäne-Attributs und das Hinzufügen von SWAO zum Shell-PATH.

---

## Voraussetzungen

- macOS 12 (Monterey) oder neür
- Terminal-Zugriff (zsh oder bash)
- `curl` oder ein Browser zum Herunterladen der Binary

---

## 1. Binary herunterladen

```bash
# Download the latest release (replace <version> with the target version)
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/<version>/swao-darwin-arm64"

# For Intel Macs use swao-darwin-x64
curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/<version>/swao-darwin-x64"
```

Den SHA-256-Prüfsumme gegen die veröffentlichte `sha256sums.txt` verifizieren:

```bash
shasum -a 256 /tmp/swao
```

Die Ausgabe mit dem entsprechenden Eintrag in der `sha256sums.txt` des Releases vergleichen, bevor fortgefahren wird.

---

## 2. Nach /usr/local/bin installieren

```bash
# Make the binary executable and move to a directory on PATH
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao
```

Wenn `/usr/local/bin` auf dem Rechner nicht vorhanden ist:

```bash
sudo mkdir -p /usr/local/bin
sudo mv /tmp/swao /usr/local/bin/swao
```

---

## 3. Gatekeeper-Quarantäneattribut entfernen

macOS weist Dateien, die aus dem Internet heruntergeladen werden, das erweiterte Attribut `com.apple.quarantine` zu. Durch dessen Entfernung wird die Binary zur Ausführung freigegeben, ohne dass ein Gatekeeper-Dialog erscheint.

```bash
# Remove the quarantine attribute
xattr -dr com.apple.quarantine /usr/local/bin/swao

# Confirm the attribute is gone (no output = success)
xattr -l /usr/local/bin/swao
```

Wird dieser Schritt übersprungen und `swao` dennoch ausgeführt, zeigt macOS an: "swao kann nicht geöffnet werden, weil der Entwickler nicht verifiziert werden kann." Nach dem Entfernen des Quarantäneattributs erscheint kein solcher Dialog mehr.

---

## 4. Daürhafte Freigabe über Systemeinstellungen

Als Alternative zur Kommandozeilenmethode oder wenn `xattr` die Blockierung nicht daürhaft aufhebt:

1. `swao --version` im Terminal ausführen. Der Gatekeeper-Dialog erscheint.
2. **Systemeinstellungen** (macOS 13+) oder **Systemeinstellungen** (macOS 12) öffnen.
3. Zu **Datenschutz und Sicherheit** navigieren.
4. Im Abschnitt "Sicherheit" die Meldung suchen: "swao wurde blockiert, weil es nicht von einem identifizierten Entwickler stammt."
5. Auf **Trotzdem erlauben** klicken.
6. `swao --version` erneut ausführen. Ein abschliessender Bestäitigungsdialog erscheint; auf **Öffnen** klicken.

Diese Vertraünsentscheidung wird pro Binary-Pfad gespeichert. Das Entfernen per `xattr` ist der schnellere Weg für skriptbasierte Bereitstellungen.

---

## 5. PATH in ~/.zshrc eintragen

Wenn `/usr/local/bin` bereits im PATH vorhanden ist -- auf den meisten macOS-Systemen der Fall -- sind keine weiteren Schritte erforderlich. Prüfung:

```bash
echo $PATH | tr ':' '\n' | grep /usr/local/bin
```

Fehlt das Verzeichnis im PATH, kann es hinzugefügt werden:

```bash
# Append to ~/.zshrc
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc

# Apply immediately in the current session
source ~/.zshrc
```

Für bash-Nutzer `~/.zshrc` entsprechend durch `~/.bash_profile` oder `~/.bashrc` ersetzen.

---

## 6. Hinweis für Versions-Upgrades

Das Quarantäneattribut muss bei jedem Ersetzen der Binary durch eine neü Version neu entfernt werden, da das Herunterladen eine neü Datei mit einem frischen Quarantäneattribut anlegt. Die Upgrade-Schritte können in einer Shell-Funktion oder einem Skript zusammengefasst werden:

```bash
#!/usr/bin/env bash
# save as ~/bin/upgrade-swao.sh
set -euo pipefail
VERSION="${1:?usage: upgrade-swao.sh <version>}"
ARCH=$(uname -m)
SUFFIX="darwin-arm64"
if [ "$ARCH" = "x86_64" ]; then SUFFIX="darwin-x64"; fi

curl -Lo /tmp/swao \
  "https://github.com/Accenture/SWAO/releases/download/${VERSION}/swao-${SUFFIX}"
chmod +x /tmp/swao
sudo mv /tmp/swao /usr/local/bin/swao
xattr -dr com.apple.quarantine /usr/local/bin/swao
swao --version
```

---

## 7. Installation verifizieren

```bash
swao --version
swao health-check
```

Ein sauberes `swao health-check`-Ergebnis mit allen grünen Prüfpunkten bestätigt, dass die Installation abgeschlossen ist.
