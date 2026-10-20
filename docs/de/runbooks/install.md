# Installation: Alle Plattformen

SWAO ist als vorkompiliertes Binary für Windows, macOS und Linux verfügbar.
Kein Node.js, kein Buildprozess erforderlich: Binary herunterladen, fertig.

## Plattform auswählen

| Plattform | Anleitung |
|---|---|
| Windows (x64) | [Windows-Anleitung](/de/runbooks/windows-binary-allowlisting) |
| macOS (Intel / Apple Silicon) | [macOS-Anleitung](/de/runbooks/macos-install) |
| Linux (x64) | [Linux-Anleitung](/de/runbooks/linux-install) |
| Docker / Kubernetes | [Docker-Anleitung](/de/runbooks/docker-deployment) |

## Binary herunterladen

Alle Releases unter:
[https://github.com/Accenture/SWAO/releases](https://github.com/Accenture/SWAO/releases)

Dateinamen der Windows-Binaries:

| Edition | Dateiname |
|---|---|
| Community (Open Source) | `swao-community-win-x64.exe` |
| Consultant | `swao-consultant-win-x64.exe` |
| Enterprise | `swao-enterprise-win-x64.exe` |

Für macOS und Linux entsprechend `swao-community-macos-x64`, `swao-community-linux-x64` usw.

## Nach dem Download

```bash
# Ausfuehrbar machen (macOS / Linux)
chmod +x swao-community-linux-x64
./swao-community-linux-x64 --version

# Windows: Binary per Doppelklick oder in PowerShell
.\swao-community-win-x64.exe --version
```

Anschließend mit [Workspace-Setup](/de/workspace-setup) fortfahren.

## Checksums prüfen

Die Datei `SHA256SUMS` im Release enthält kryptografische Prüfwerte für alle Binaries:

```bash
# Linux / macOS
sha256sum --check SHA256SUMS

# Windows (PowerShell)
Get-FileHash swao-community-win-x64.exe -Algorithm SHA256
```

## Nächste Schritte

- [Workspace konfigurieren](/de/workspace-setup)
- [Health Check durchführen](/de/health-check)
- [Bewertung starten](/de/assessment/)
