# Health Check

Health Check stellt sicher, dass jede Komponente Ihrer SWAO-Umgebung korrekt funktioniert,
bevor Sie eine Bewertung durchfuehren. Fuehren Sie ihn nach der Einrichtung, nach jeder
Konfigurationsaenderung und vor einer Sitzung aus, um die Einsatzbereitschaft der Umgebung
zu bestaetigen.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **2**, oder ueber die
Befehlszeile:

```
swao health-check
```

![SWAO Health Check results](/samples/12-tui-health-check.png)

---

## Die 11 Pruefungen

Health Check fuehrt 11 automatisierte Pruefungen durch und meldet fuer jede einen von drei
Statuswerten:

| Status | Bedeutung |
|---|---|
| **OK** | Komponente ist konfiguriert und funktioniert korrekt. |
| **WARN** | Etwas erfordert Aufmerksamkeit, bevor die Bewertung wie erwartet funktioniert. |
| **INFO** | Eine optionale Komponente ist nicht konfiguriert -- die Bewertung wird ohne sie fortgesetzt. |

| Pruefung | Was wird geprueft |
|---|---|
| **[1/11] Lizenz** | Lizenzstufe (Community / Consultant / Enterprise), Nutzungsanzahl und Ablaufdatum. |
| **[2/11] Playwright / Chromium** | Ob Playwright installiert ist. Erforderlich fuer die PDF-Berichterstellung und den HTML-Editor. |
| **[3/11] SWAO-MCP** | Ob der SWAO-MCP-Server registriert und erreichbar ist. Erforderlich fuer die Claude-Desktop-Integration. |
| **[4/11] Compliance-Kataloge** | Integritaet aller installierten Framework-YAML-Dateien. Meldet den Framework-Namen, den Mitwirkenden und die Steuerungsanzahl fuer jeden. |
| **[5/11] Importvorlagen** | Ob Power-BI-`.pbit`-Vorlagendateien in `wsp/templates/powerbi/` vorhanden sind. |
| **[6/11] Nachvollziehbarkeit** | Ob bewertete Anwendungen die Nachvollziehbarkeits-Ziele erfuellen (Signalanzahl-Schwellenwerte, die bestaetigen, dass die Bewertung substanziell ist). |
| **[7/11] BI-Export** | Ob das Sternschema-Exportpaket vorhanden und intern konsistent ist (Zeilenanzahl und Hashes). |
| **[8/11] Umfang** | Ob Durchlauf 13 (Abdeckungsumfang) fuer jede Anwendung ausgefuehrt wurde. Die Umfangsabdeckung wird ab v0.4.5+ standardmaessig ausgegeben. |
| **[9/11] Voraussetzungen** | Ob optionale Befehlszeilentools im PATH vorhanden sind (z. B. `ssh` fuer schluesselbasiertes Repository-Klonen). |
| **[10/11] VCS-Authentifizierung** | Ob SWAO sich bei den fuer Ihre Anwendungen konfigurierten Versionskontroll-Hosts authentifizieren kann. |
| **[11/11] Audit-Import** | Ob ein Audit-Workspace-Importordner konfiguriert ist. Nur relevant fuer die Audit-Bewertung. |

---

## Maschineller Fingerabdruck

Am Ende jeder Health-Check-Ausgabe zeigt SWAO einen **maschinellen Fingerabdruck** an --
eine kurze Kennung, die an die SWAO-ausfuehrende Hardware gebunden ist. Dieser Fingerabdruck
wird benoetigt, wenn Sie ein Lizenzschlussel-Upgrade anfordern. Notieren Sie ihn fuer Ihre
Unterlagen.

---

## Reaktion auf WARN und INFO

Jede Pruefung, die nicht OK zurueckgibt, zeigt Anleitungstext an, der erklaert, was getan
werden muss. Sie koennen **Ctrl+G** in der TUI-Ansicht druecken, um das Anleitungsfeld fuer
die ausgewaehlte Pruefung zu erweitern.

Haeufige Loesungen:

- **Playwright WARN** -- fuehren Sie `npx playwright install chromium` aus oder verwenden
  Sie den Workspace-Setup-Assistenten (Schritt 6).
- **VCS-Authentifizierung WARN** -- fuehren Sie den Workspace-Setup-Schritt 3 (Anmeldeinformationen)
  erneut aus, um Repository-Anmeldeinformationen zu aktualisieren.
- **Umfang INFO** -- fuehren Sie `swao assess --app <id>` aus, um die Umfangsabdeckung fuer
  die aufgefuehrten Anwendungen zu generieren.
- **Audit-Import INFO** -- nur relevant, wenn Sie eine Audit-Bewertung durchfuehren moechten;
  ansonsten sicher zu ignorieren.

"Alle Pruefungen bestanden" bestaetigt, dass der Workspace fuer die Bewertung bereit ist.
