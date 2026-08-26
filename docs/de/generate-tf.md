# 8. TF-Module erstellen

Wählen Sie Option 8 im Hauptmenü (oder führen `swao generate-tf` aus), um Terraform-Modul-Scaffolding für die während der Landing-Zone-Bewertung identifizierte Ziel-Landing-Zone zu generieren.

## Was generiert wird

SWAO liest den Fit/Gap-Bericht aus der Landing-Zone-Bewertung und erstellt:

- Terraform-Modul-Stubs für jeden erforderlichen Service auf dem Ziel-Cloud-Anbieter (z.B. STACKIT SKE, OTC OBS, IONOS Kubernetes)
- Variablendatei, vorab befüllt mit Werten aus den Bewertungssignalen
- README für jedes Modul mit den relevanten LZ-Check-Referenzen

## CLI

```bash
# TF-Module für die zuletzt bewertete App generieren
swao generate-tf --app meine-app

# Ausgabeordner
# wsp/terraform/<run-id>/
```

## Unterstützte Anbieter

Die Terraform-Generierung folgt dem Landing-Zone-Katalog: STACKIT, OTC (T-Systems), IONOS Cloud, OVHcloud, Azure (West Europe), AWS (eu-central-1) und Google Cloud EU-Regionen. Benutzerdefinierte Anbietereinträge im Katalog erzeugen generische Stubs.

Siehe auch: [Landing-Zone-Bewertung](/assessment/landing-zone) | [Funktionen & Editionen](/de/features)
