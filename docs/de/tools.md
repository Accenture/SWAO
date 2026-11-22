# 9. Werkzeuge

Das Werkzeuge-Menü (Option 9 im Hauptmenü) gruppiert Hilfsbefehle zur Verwaltung Ihrer SWAO-Installation, Ihres Workspace und Ihrer Zugangsdaten.

## Verfügbare Werkzeuge

| Werkzeug | CLI-Befehl | Beschreibung |
|---|---|---|
| Linsen | `swao lenses list` / `swao lenses set <ids>` | Zwischen vorkonfigurierten Analyselinsen (Pass-Auswahlprofilen) wechseln |
| Lizenz | `swao license status` / `swao license activate <key>` | Aktuelle Edition anzeigen und Lizenzschlüssel aktivieren |
| Zugangsdaten | `swao credential set` / `swao credential list` | API-Schlüssel und Vault-Referenzen speichern und verwalten |
| Rahmenwerk | `swao framework list` | Die Community-Rahmenwerke im Workspace auflisten (`wsp/inputs/catalogs/community/<ordner>/`); für weitere [von GitHub herunterladen](https://github.com/Accenture/SWAO/tree/main/community-frameworks) und den Ordner dorthin kopieren |
| Katalog aktualisieren | `swao lz catalogue update` | LZ-Dienstekataloge der Anbieter aus deren öffentlichen Quellen aktualisieren, dazu die VM-Preise des Kostenmodells der Service-Bewertung aus den Preis-APIs von Azure und AWS (ab Consultant). Ist eine Live-Landing-Zone registriert, fragt die TUI zuerst nach der Quelle: Internetquellen oder der Live-LZ-Katalog eines Live-Laufs (`--source live --lz <lz-id> [--run <ts>]`, zuerst Probelauf mit Diff, dann Schreiben; oder eine neue Katalogdatei mit `--new <slug>`) |
| Landing-Zone-Verbindungen | `swao lz list` / `swao lz connect <lz-id> ...` / `swao lz probe <lz-id>` / `swao lz remove <lz-id> [--scope <id>]` | In der TUI über das Landing-Zone-Live-Setup und das Landing Zone Live Assessment (Taste `a`): Live-Landing-Zones mit Plattform- und Anwendungs-Scopes in der `.swao.yml` registrieren, ihre Zugangsdaten im SWAO-Vault speichern (verdeckte Eingabe, über stdin mit `--credentials-stdin`, nie angezeigt), Nur-Lese-Prüfung und Abdeckung abfragen, alte AWS- und Azure-Schlüssel einem Scope zuordnen, einen Scope oder eine Landing Zone samt Vault-Schlüsseln entfernen. SWAO liest aus einer Landing Zone nur |
| LLM-Gateway aktualisieren | `swao llm-gateway update` | Die LLM-Gateway-Connectoren des Workspace (`wsp/inputs/llm-gateway/`, die alleinige Quelle) aus den mitgelieferten Vorlagen auffrischen: unveränderte Vorlagen werden aktualisiert, selbst bearbeitete Connectoren bleiben erhalten, neue werden ergänzt. Nach einem Binary-Upgrade ausführen. `--dry-run` zeigt die Änderungen vorab |
| SWAO Chat | `swao chat` | Mehrstufige LLM-Unterhaltung über Ergebnisse des Portfolio-Assessments (Enterprise) |
| Hilfe | `swao --help` / `swao <befehl> --help` | Vollständige CLI-Referenz |

## Linsen

Linsen sind vorkonfigurierte Pass-Auswahlprofile; einige aktivieren zusätzlich passende Rahmenwerke. Drei Linsen werden mitgeliefert (`swao lenses list`):

| Linse | Passes | Automatisch aktivierte Rahmenwerke |
|---|---|---|
| `cloud-migration` (Standard) | INV, STATE, DATA, CTX, SBOM, TF, EGR, CRYPTO, SYNTH, LZR, COMP, SCOPE | keine |
| `security-focus` | SBOM, CRYPTO, EGR, MAL | KRITIS, NIS2 |
| `data-governance` | DATA, CTX | GDPR |

Linse vor einer Bewertung festlegen:

```bash
swao lenses set security-focus
swao assess --app meine-app
```

Siehe auch: [Workspace-Setup](/de/workspace-setup) | [CLI-Referenz](/de/runbooks/cli-reference)
