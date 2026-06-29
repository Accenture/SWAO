# TF-Module generieren

"TF-Module generieren" erstellt direkt anwendbare Terraform-Module aus den
Bewertungsergebnissen. Wenn die Bewertung feststellt, dass eine Steuerung nicht erfuellt
ist, kann SWAO den Terraform-Code generieren, der die Umgebung in den Compliance-Zustand
bringen wuerde -- und damit Befunde in einem Schritt in Infrastructure as Code umwandelt.

Oeffnen Sie den Schritt ueber das TUI-Hauptmenue durch Drucken von **8**.

---

## Funktion

Nach einer Anwendungs- oder Landing-Zone-Bewertung ordnet SWAO jede nicht erfuellte
Steuerung einer kuratierten Bibliothek von Terraform-Modulen zu. Fuer jedes passende Modul
wird generiert:

- Eine konfigurierte `.tf`-Datei mit Werten, die aus dem Anwendungskontext vorbefuellt
  wurden (App-ID, Cloud-Region, Ressourcennamen, Tags).
- Ein `variables.tf`-Block fuer alle Werte, die zum Anwendungszeitpunkt angegeben werden
  muessen.
- Eine `README.md` pro Modul, die beschreibt, was es behebt und wie es angewendet wird.

Die Ausgabe landet in `apps/<id>/wsp/tf/<timestamp>/` und ist so strukturiert, dass sie
direkt angewendet oder in ein bestehendes Terraform-Root-Modul importiert werden kann.

---

## Unterstuetzte Anbieter

| Anbieter | Abdeckung |
|---|---|
| AWS | IAM, S3, KMS, CloudTrail, Config, Security Hub, WAF, VPC-Datenflussprotokolle |
| Azure | RBAC, Key Vault, Speicherkonto-Richtlinien, Defender for Cloud, NSG, Monitor |
| GCP | IAM, Cloud-Audit-Protokolle, VPC-Dienststeuerungen, Security Command Center |

Die Abdeckung waechst mit jeder Version. Steuerungen ohne passendes Modul werden in einer
`remediation-gaps.md`-Datei aufgelistet, sodass Sie wissen, welche Befunde noch manuelle
Arbeit erfordern.

---

## Module anwenden

```bash
cd apps/<id>/wsp/tf/<timestamp>
terraform init
terraform plan
terraform apply
```

Pruefen Sie die Plan-Ausgabe sorgfaeltig vor der Anwendung. Die generierten Module
verwenden sinnvolle Standardwerte, aber Ihre Umgebung kann Einschraenkungen haben --
Namenskonventionen, Tag-Anforderungen oder bestehende Ressourcen -- die eine Anpassung
vor der Anwendung erfordern.

---

## Nach der Anwendung erneut bewerten

Sobald Sie die generierten Module angewendet haben, fuehren Sie die Bewertung erneut durch.
Compliance-Steuerungen, die zuvor als GAP galten, sollten nun SATISFIED anzeigen, wenn
die Terraform-Konfiguration korrekt ist und die Umgebung konvergiert hat.

Damit schliesst sich der Kreislauf zwischen Bewertungsbefunden und
Infrastruktur-Behebung ohne manuelles Tracking.

---

::: tip Enterprise-Funktion
Die Modulgenerierung aus LLM- und Hybridbewertungen, einschliesslich der Generierung aus
audit-abgeleiteten Befunden, ist eine Enterprise-Editions-Funktion.
:::
