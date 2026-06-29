# Landing-Zone-Bewertung

Die Landing-Zone-Bewertung wertet Ihre Cloud-Infrastrukturkonfiguration gegen die
Souveranitaetsanforderungen aus, die aus Ihren aktiven Compliance-Frameworks abgeleitet
wurden. Sie ruft den Live-Servicekatalog Ihres Cloud-Anbieters ab und erstellt einen
strukturierten Fit-/Gap-Bericht, der zeigt, welche Dienste und Konfigurationen die
souveraenen Anforderungen erfuellen und welche nicht.

**CLI:** `swao assess --type landing-zone`

**TUI:** Hauptmenue > Bewertung durchfuehren > [3] Landing-Zone-Bewertung

---

## Ergebnisse

| Ausgabe | Inhalt |
|---|---|
| Fit-/Gap-Bericht | Jede Landing-Zone-Steuerung mit Status COMPLIANT / GAP / PARTIAL |
| Servicekatalog-Snapshot | Die souveraene Dienstliste des Cloud-Anbieters zum Bewertungszeitpunkt |
| Signalsatz | Strukturierte Befunde, die Compliance-Framework-Steuerungen zugeordnet sind |
| BI-Export | Sternschema-Eintraege fuer das Portfolio-Power-BI-Dashboard |

---

## Unterstuetzte Cloud-Anbieter

Die Landing-Zone-Bewertung verbindet sich mit dem Servicekatalog des Cloud-Anbieters, um
zu validieren, welche Dienste in der souveraenen Region verfuegbar sind. Unterstuetzte
Anbieter:

- **AWS** -- souveraene und eingeschraenkte Regionen
- **Azure** -- Sovereign Cloud und kommerzielle Regionen mit Datenresidenz-Garantien

---

## Erforderliche Eingaben

Legen Sie vor der Durchfuehrung einer Landing-Zone-Bewertung Ihren Landing-Zone-Snapshot
im Workspace ab:

- **IaC-Statusdatei** -- Terraform-Status (`terraform.tfstate`) oder CloudFormation-Vorlage
- **CSP-Konfigurationsexport** -- AWS-Config-Snapshot oder Azure-Resource-Graph-Export
- **Netzwerktopologie** (optional) -- Subnetz-, VPC- oder VNET-Konfiguration fuer die
  Netzwerkflussanalyse

SWAO liest diese aus `wsp/inputs/landing-zone/`. Wenn der Ordner fehlt oder leer ist,
verwendet SWAO allein die aktiven Compliance-Framework-Steuerungen, um einen
Leitfaden-Bericht ohne konfigurationsspezifisches Urteil zu erstellen.

---

## Bewertungssystem

Jede Landing-Zone-Steuerung ist einer oder mehreren Framework-Anforderungen zugeordnet.
SWAO vergleicht die erwartete Konfiguration der Steuerung mit dem, was in Ihrer IaC- oder
Konfigurationsdatei gefunden wird:

- **COMPLIANT** -- die Konfiguration erfuellt die Souveranitaetsanforderung.
- **PARTIAL** -- teilweise konfiguriert; spezifische Luecken sind dokumentiert.
- **GAP** -- die Anforderung ist nicht erfuellt; Behebungsanleitungen sind enthalten.
- **NOT ASSESSED** -- ungenuegend Konfigurationsdaten, um diese Steuerung zu bewerten.

Der Bericht gruppiert Befunde nach Framework-Domaine, sodass ein Compliance-Pruefer die
Luecken systematisch durcharbeiten kann.
