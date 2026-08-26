# 7. Portfolio-Betrieb

Portfolio-Betrieb (Option 7 im Hauptmenü) aggregiert Bewertungsergebnisse über mehrere Anwendungen in einem einzelnen Workspace. Verfügbar in **Consultant** und **Enterprise** Editionen.

## Was der Portfolio-Modus bietet

| Funktion | Beschreibung |
|---|---|
| Multi-App-Bewertung | Bewertungen über alle Apps im Workspace sequenziell oder parallel |
| Aggregiertes Risikoregister | Appübergreifende Erkenntnisliste, dedupliziert und priorisiert |
| Portfolio-Compliance-Matrix | Rahmenwerk-Abdeckung über alle bewerteten Apps |
| Migrationsplanung | Abhängigkeitsbewusste Sequenzierung für phasenweise Cloud-Migration |
| Portfolio-PowerBI-Dashboard | `swao-portfolio.pbit` mit Heatmap- und Wellenansichten (Enterprise) |

## CLI

```bash
# Alle Apps im Workspace bewerten
swao assess --portfolio

# Aggregiertes BI-Paket exportieren
swao export --portfolio --formats csv,xlsx
```

## Edition

Vollständiger Portfolio-Betrieb erfordert **Consultant** oder **Enterprise**. Die Community-Edition kann einzelne Bewertungen im selben Workspace-Ordner ausführen, aggregiert jedoch keine Ergebnisse.

Siehe auch: [BI exportieren](/de/export-bi) | [Funktionen & Editionen](/de/features)
