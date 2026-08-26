# 9. Werkzeuge

Das Werkzeuge-Menü (Option 9 im Hauptmenü) gruppiert Hilfsbefehle zur Verwaltung Ihrer SWAO-Installation, Ihres Workspace und Ihrer Zugangsdaten.

## Verfügbare Werkzeuge

| Werkzeug | CLI-Befehl | Beschreibung |
|---|---|---|
| Linsen | `swao lens list` / `swao lens apply` | Zwischen vorkonfigurierten Analyselinsen wechseln |
| Lizenz | `swao licence show` / `swao licence activate` | Aktuelle Edition anzeigen und Lizenzschlüssel aktivieren |
| Zugangsdaten | `swao credential set` / `swao credential list` | API-Schlüssel und Vault-Referenzen speichern und verwalten |
| Rahmenwerk installieren | `swao framework install <name>` | Zusätzliche Community-Rahmenwerke installieren |
| Katalog aktualisieren | `swao catalogue update` | Neuesten LZ-Anbieter-Katalog und Rahmenwerk-Updates abrufen |
| Hilfe | `swao --help` / `swao <befehl> --help` | Vollständige CLI-Referenz |

## Linsen

Linsen sind vorkonfigurierte Sets aus aktivierten Analysedurchläufen, Signal-Gewichtungen und Rahmenwerk-Filtern. Drei Community-Linsen werden mit jeder Edition ausgeliefert:

| Linse | Fokus |
|---|---|
| `cloud-migration` | 7R-Migrationsurteil, Abhängigkeitskartierung, Wellenplanung |
| `security-focus` | Sicherheitspostur, Geheimnisentdeckung, Kryptographie, SAST |
| `data-governance` | PII-Klassifizierung, Datenresidenz, Ausgangsanalyse, DSGVO-Kontrollen |

Linse vor einer Bewertung anwenden:

```bash
swao lens apply security-focus
swao assess --app meine-app
```

Siehe auch: [Workspace-Setup](/de/workspace-setup) | [CLI-Referenz](/de/runbooks/cli-reference)
