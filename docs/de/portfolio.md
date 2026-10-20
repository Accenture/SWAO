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

## Kombinierte Portfolio-Sicht (Anwendungs- und Service-Apps)

Ein Engagement-Workspace kann Anwendungsbewertungen (`swao assess --app <id>`) und Apps der Service Portfolio Assessment (`swao service init`) nebeneinander enthalten. `wsp/portfolio-summary.json` ist die kombinierte Sicht über beide: Jede App erscheint einmal, mit `assessment_type: application` oder `assessment_type: service`.

| | Anwendungs-Apps | Service-Apps |
|---|---|---|
| Nachweise | Letzter verwendbarer Anwendungslauf (7R-Urteil, End of Life der Laufzeitumgebung und CVE-Abfrage der Abhängigkeiten aus Pass 01 / 05, negative kritische und hohe Befunde, Compliance-Ergebnisse, Landing-Zone-Urteil) | Intake, Recherche-Stubs, letzter Service-Lauf |
| TIME | Aus dem 7R-Urteil (Retire: Eliminate; Retain: Tolerate; Rehost, Relocate, Replatform, Repurchase: Migrate; Refactor: Invest), siehe [SWAO_APM-Framework](/de/service-assessment/framework#anwendungs-apps-in-der-kombinierten-sicht) | TIME-Regeln von SWAO_APM |
| Nicht bewertet | Kein verwendbarer Anwendungslauf | Kein Service-Assessment-Lauf |

Beide Typen teilen eine TIME-Verteilung, eine Rangliste, einen Migrationswellenplan, einen Integrationsgraphen und eine Herstellerkonsolidierung. Die Kennzahlen umfassen bewertete Apps beider Typen; `by_assessment_type` in der Zusammenfassung zeigt dieselben Kennzahlen je Typ. Die Zusammenfassung wird von `swao service research`, einem Service-Assessment und `swao service export` neu erstellt; führen Sie nach neuen Anwendungsbewertungen einen dieser Befehle aus.

Wo der Typ erscheint:

- MCP: `swao_service_portfolio` (Filter `assessment_type`), `swao_service_app`, `swao_service_waves` und `swao_service_vendors` liefern beide Typen mit dem Feld `assessment_type`.
- Enterprise-Arbeitsmappe und Sternschema (`swao service export`): eine Spalte `Assessment Type` und `dim_service_app.assessment_type`, siehe [BI exportieren](/de/export-bi).
- Migrationswellen-Bericht (`wsp/reports/migration-waves-*.md` / `.csv`) und die Portfolio-Blöcke des Engagement-Hubs: Anwendungs-Apps tragen eine Typspalte oder die Markierung **Anwendung**.

## Edition

Vollständiger Portfolio-Betrieb erfordert **Consultant** oder **Enterprise**. Die Community-Edition kann einzelne Bewertungen im selben Workspace-Ordner ausführen, aggregiert jedoch keine Ergebnisse.

Siehe auch: [BI exportieren](/de/export-bi) | [Funktionen & Editionen](/de/features)
