# Anwendungsbewertung

Die Anwendungsbewertung analysiert Ihren Quellcode auf:

- Compliance-Luecken gegenueber Community-Rahmenwerken (GDPR, BSI C5, ISO 27001 u.a.)
- Sicherheitsrisiken und Datenklassifikation
- Cloud-Readiness und Migrationsstrategie (7R)
- Landing-Zone-Eignung

## Aufruf

```bash
swao assess --app <app-id>
```

Alternativ: TUI-Option 3 -> Anwendungsbewertung.

## Ausgabe

- Signals-Datei (`wsp/signals/<ts>.ndjson`)
- HTML-Publikation (`apps/<id>/wsp/publications/<ts>-<id>.html`)
- BI-Exportpaket (`apps/<id>/wsp/export/`)

Weitere Details zur Konfiguration siehe [Workspace konfigurieren](/de/runbooks/workspace-config).

Hinweis: Landing-Zone-Kataloge koennen fuer die Beurteilung der Zielplattform angepasst werden -- weitere Informationen folgen im Runbook "Landing-Zone-Kataloge anpassen".
