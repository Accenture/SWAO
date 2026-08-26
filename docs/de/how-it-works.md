=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    So funktioniert SWAO

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Wie SWAO funktioniert

SWAO analysiert eine Cloud-Anwendung und erstellt in einem einzigen Befehl -- oder über
die geführte Terminaloberfläche -- einen audit-konformen Bewertungsbericht. Keine externen
Dienste, keine Datenuploads, kein Call-home.

---

## Die geführte Oberfläche (TUI)

Wenn Sie `swao` ohne Argumente ausführen, öffnet sich die **Terminaloberfläche**.

### Hauptmenü

```
SWAO -- Sovereign Workload Assessment and Onboarding
Community  v0.11.2

  1  Workspace Setup       Init + LLM + Zugangsdaten-Assistent
  2  Health Check          swao health-check
  3  Run Assessment        Anwendung / Landing Zone / LLM + mehr
  4  Generate Report       swao report (Text / PDF)
  5  Publish HTML          swao publish -- eigenständige HTML-Datei
  6  Export BI             Sternschema / PowerBI / Tableau
  7  Portfolio Operations  Multi-App-Aggregation (Enterprise)
  8  Generate TF Modules   swao generate-tf
  9  Tools                 Linsen / Lizenz / Zugangsdaten / Hilfe
  0  Exit
```

> Siehe auch: [Beispielgalerie -- TUI-Hauptmenü](/samples/#sample-10)

### Workspace-Setup-Assistent

Wählen Sie **1. Workspace Setup**. Der Assistent stellt vier Fragen:

1. **Workspace-Name** -- Bezeichner für den Engagement-Ordner.
2. **Anwendungsname** -- der zu bewertende Workload.
3. **Compliance-Rahmenwerke** -- DSGVO ist vorausgewählt. Elf Community-Rahmenwerke verfügbar
   (DSGVO, KI 10 Säulen, BSI C5, BSI IT-Grundschutz 2023, HIPAA / NIST SP 800-66r2,
   LLM-Auswahl, NCA CCC 2024 CSP, NCA CCC 2024 CST, NCA ECC 2024, PCI-DSS v4, SAMA CSF v1).
4. **LLM-Anbieter** -- Anthropic Claude, OpenAI, Ollama oder deterministischer Stub.

### Health Check (Systemprüfung)

| Prüfung | Was geprüft wird |
|---|---|
| Lizenz | Edition erkannt und gültig |
| Playwright | Bereitschaft für dynamische Analyse |
| MCP | Model-Context-Protocol-Konfiguration |
| Compliance-Kataloge | Rahmenwerk-Dateien vorhanden |
| Import-Vorlagen | Einlese-Ordnerstruktur |
| Nachvollziehbarkeit | Audit-konforme Signalfelder aktiviert |
| BI-Exportpaket | Integrität des letzten Exports |

> Siehe auch: [Beispielgalerie -- Health Check](/samples/#sample-12)

### Bewertung durchführen

Wählen Sie **3. Run Assessment**, dann den Bewertungstyp:

| Option | Was es macht |
|---|---|
| Anwendungsbewertung | Analysiert Ihren Quellcode |
| Landing-Zone-Bewertung | Prüft Ihre Cloud-Infrastruktur |
| LLM-Bewertung | Bewertet LLM-Anbieter nach Souveränitätskriterien |

---

## Die Bewertungs-Pipeline {#die-bewertungs-pipeline}

Eine **Anwendungsbewertung** führt bis zu 14 Analysedurchläufe durch.

| Durchlauf | Was er macht |
|---|---|
| 1. Inventar | Sprachen, Frameworks, Abhängigkeiten |
| 2. Zustandsanalyse | Datenbanken, Session-Speicher, Caches |
| 3. Datenklassifizierung | PII-Felder, Residenzmarkierungen |
| 4. Kontexteinlese | CMDB, Workshop-Protokolle, Architekturdokumente |
| 5. SBOM | Software-Stückliste mit Lizenzklassifizierung |
| 6. Twelve-Factor | Cloud-Bereitschaft nach 12-Faktor-Standard |
| 7. Ausgangsanalyse | Ausgehende Verbindungen, Drittanbieter-Transfers |
| 8. Kryptographie | Hashing, TLS, Geheimnisbehandlung |
| 9. Migrationssynthese | 7R-Urteil |
| 10. Compliance-Bewertung | Zuordnung zu aktiven Rahmenwerken |
| 11. Landing-Zone-Bereitschaft | Fit für Cloud-Landing-Zone |
| 12. Sicherheitspostur | Häufige Verwundbarkeitsmuster |
| 13. Dynamische Analyse | Browser-Crawl für UI-Oberfläche |
| 14. Evidenzgalerie | Screenshots und Artefakte |

---

## Die HTML-Veröffentlichung {#die-html-veroeffentlichung}

SWAO erstellt eine **eigenständige HTML-Datei** -- offline nutzbar, per E-Mail versendbar.

Enthält:

- **Führungsansicht** -- 7R-Urteil, Abdeckungspunktzahl, wichtigste Risiken.
- **Fachansicht** -- alle Signale mit Ableitung und Evidenzlinks.
- **Compliance-Ansicht** -- rahmenwerkspezifische Kontrolltabelle.
- **Prüferansicht** -- Prüfprotokoll mit Zeitstempel und Bewerteridentität.
- **Evidenzgalerie** -- Screenshots und Artefakte.
- **Laufprotokoll** -- Dauer, LLM-Kosten, Durchlauf-Aufschlüsselung.

```bash
swao publish --app meine-app
# Öffnet: wsp/publications/latest/index.html
```

---

## MCP-Integration {#mcp-integration}

SWAO verbindet sich über das **Model Context Protocol (MCP)** mit **Claude AI**.

Beispielfragen:

- "Was sind die wichtigsten Compliance-Lücken?"
- "Fassen Sie die Landing-Zone-Erkenntnisse zusammen."
- "Was ist das 7R-Migrationsurteil?"

### Verbindung herstellen

1. `swao health-check` (oder **2. Health Check** im Hauptmenü) -- MCP-Prüfung zeigt den Serverpfad.
2. Claude Desktop: Einstellungen > Entwickler > MCP-Server > Hinzufügen.
3. Claude Desktop neu starten.

| Tool | Was es macht |
|---|---|
| `swao_assess` | Neue Bewertung auslösen |
| `swao_report` | Zusammenfassung der letzten Bewertung |
| `swao_signal_detail` | Signal nach ID nachschlagen |
| `swao_compliance_status` | Compliance-Ergebnisse abfragen |
| `swao_lz_fit` | Landing-Zone-Fit/Gap abrufen |
| `swao_run_history` | Letzte Läufe auflisten |

---

## PowerBI-Dashboards {#powerbi-dashboards}

Vorgefertigte Vorlagen in Ihrem Workspace unter `wsp/templates/powerbi/`:

| Vorlage | Edition | Seiten |
|---|---|---|
| `swao-report.pbit` | Consultant + Enterprise | Übersicht, Compliance, Signale, Risiken, Prüfer, Laufstatistiken |
| `swao-portfolio.pbit` | Enterprise | Portfolio-Übersicht, Heatmap, Compliance, Risiko & 7R, Wellensequenzierung |

Öffnen Sie die `.pbit`-Datei, setzen Sie `SWAOExportPath` auf den `star/`-Ordner, klicken Sie **Laden**.

---

## Was auf Ihrem Rechner bleibt

- Keine Telemetrie. Keine Nutzungsdaten werden gesendet.
- Kein gehosteter Endpunkt. Die Engine läuft lokal.
- Kein Call-home. Das Binary prüft nicht auf Updates.
- LLM-Aufrufe gehen direkt an Ihren konfigurierten Anbieter.
- HTML-Veröffentlichung, BI-Export und PowerBI-Dashboard sind lokale Dateien.
