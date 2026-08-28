# Installation -- Alle Plattformen

SWAO ist als vorkompiliertes Binary fuer Windows, macOS und Linux verfuegbar.
Kein Node.js, kein Buildprozess erforderlich -- Binary herunterladen, fertig.

## Plattform auswaehlen

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
| Community (Open Source) | `swao-community-win.exe` |
| Consultant | `swao-consultant-win-x64.exe` |
| Enterprise | `swao-enterprise-win-x64.exe` |

Fuer macOS und Linux entsprechend `swao-community-darwin-x64`, `swao-community-linux-x64` usw.

## Nach dem Download

```bash
# Ausfuehrbar machen (macOS / Linux)
chmod +x swao-community-linux-x64
./swao-community-linux-x64 --version

# Windows: Binary per Doppelklick oder in PowerShell
.\swao-community-win.exe --version
```

Anschliessend mit [Workspace-Setup](/de/workspace-setup) fortfahren.

## Checksums pruefen

Die Datei `SHA256SUMS` im Release enthaelt kryptografische Pruefwerte fuer alle Binaries:

```bash
# Linux / macOS
sha256sum --check SHA256SUMS

# Windows (PowerShell)
Get-FileHash swao-community-win.exe -Algorithm SHA256
```

## Naechste Schritte

- [Workspace konfigurieren](/de/workspace-setup)
- [Health Check durchfuehren](/de/health-check)
- [Bewertung starten](/assessment/)
