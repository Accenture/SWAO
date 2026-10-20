# Landing-Zone-Kataloge anpassen

SWAO wird mit vorgefertigten Dienstekatalogen für 10 Cloud-Anbieter ausgeliefert. Jeder Katalog listet die Regionen des Anbieters, ihre Souveränitätsmerkmale (Datenresidenz, Zertifizierungen) und die je Region verfügbaren Dienste. Die Landing-Zone-Katalog-Bewertung und der integrierte Katalog-Fit einer Anwendungsbewertung gleichen eine App mit diesen Katalogen ab.

## Enthaltene Kataloge

| Anbieter-ID | Katalog |
|---|---|
| `aws` | AWS |
| `aws-esc` | AWS European Sovereign Cloud |
| `aws-iso-e` | AWS ISOE Europe (klassifiziert) |
| `azure` | Microsoft Azure |
| `azure-local` | Azure Local |
| `delos` | Delos Cloud |
| `gcp` | Google Cloud |
| `oci` | Oracle Cloud Infrastructure |
| `otc` | Open Telekom Cloud / T Cloud Public |
| `stackit` | STACKIT |

`swao lz catalogue list` gibt dieselbe Liste mit der Zahl der Regionen und Dienste aus; `swao lz catalogue show <provider>` zeigt Regionen, Souveränitätsmerkmale und Dienste eines Anbieters.

## Katalogformat

Jeder Katalog ist eine JSON-Datei. Der mitgelieferte Satz liegt im Ordner `lz-catalogues/` der SWAO-Distribution, je Anbieter eine Datei `<provider>.json`. Eine Indexdatei gibt es nicht: SWAO listet jeden Katalog aus seinem eigenen `meta`-Block (Name, `last_updated`, `source.mode`, Konfidenz, `regions_count`), sodass eine neue Katalogdatei ohne Registrierung erkannt wird. Dateien, die mit `_` beginnen (`_lz-catalogue-template.json`, `_coming-soon.json`), `*-service-meta.json` und der Ordner `prices/` sind Hilfsdateien, keine Kataloge; `_coming-soon.json` ist der einzige Ort, an dem die als „coming soon“ angekündigten Anbieter stehen. Eine `index.json` in einem älteren Workspace-Ordner wird ignoriert und kann gelöscht werden. Ein Workspace-Katalog liegt unter `wsp/inputs/catalogs/lz-catalogues/<provider>/index.json`. `swao init` legt die mitgelieferten Katalogdateien in einem neuen Workspace unter `wsp/inputs/catalogs/lz-catalogues/` ab, sodass Sie sie direkt bearbeiten können.

## Einen Katalog anpassen

1. Kopieren Sie den mitgelieferten Katalog des Anbieters, den Sie anpassen möchten, in den Workspace:
   ```bash
   swao lz catalogue copy stackit
   ```
   Das schreibt `wsp/inputs/catalogs/lz-catalogues/stackit/index.json`. Mit `--force` überschreiben Sie eine vorhandene Kopie.

   Für einen Anbieter, den SWAO nicht mitliefert (Privatcloud, verwaltetes Hosting, interne Plattform), legen Sie stattdessen ein leeres Gerüst an:
   ```bash
   swao lz catalogue new my-private-cloud
   ```

2. Bearbeiten Sie die JSON-Datei: Passen Sie `meta` (Name, `last_updated`, Quellenhinweis) und die Einträge unter `regions[]` mit ihren Diensten an.

3. Prüfen Sie, welche Kopie SWAO verwendet:
   ```bash
   swao lz catalogue show stackit
   ```
   Die Ausgabe nennt die Herkunft (`workspace` oder `bundled`) und die gelesene Datei.

4. Führen Sie zur Überprüfung eine Landing-Zone-Katalog-Bewertung aus:
   ```bash
   swao assess --type landing-zone-catalog --app <app-id> --lz-provider stackit --lz-region <region-id>
   ```

## Kataloge aktualisieren

SWAO aktualisiert die mitgelieferten Kataloge mit jedem neuen Release. Workspace-Kopien werden von einem neuen Release nie überschrieben.

Um die Dienstelisten aus den öffentlichen Quellen der Anbieter zu aktualisieren, ohne das Binary zu aktualisieren, führen Sie Folgendes aus (ab Consultant-Stufe; keine Zugangsdaten erforderlich):

```bash
swao lz catalogue update --provider all
```

`--provider` akzeptiert `aws`, `aws-esc`, `aws-iso-e`, `stackit`, `gcp`, `azure` oder `all`. Die aktualisierten Kataloge werden in `wsp/inputs/catalogs/lz-catalogues/` des Workspace geschrieben (oder nach `--catalogues-dir`). `--dry-run` gibt die Statistik aus, ohne Dateien zu schreiben; die Optionen `--endpoints-path`, `--products-path` und `--azure-prices-path` lesen lokale Quelldateien für den Air-Gap-Betrieb.

Derselbe Lauf aktualisiert die VM-Preise des Kostenmodells der Service-Bewertung (siehe [Konfiguration der Service-Bewertung](/de/service-assessment/configuration#kostenpreise)): Mit `--provider azure`, `aws` oder `all` liest er die On-Demand-Preise für Linux und Windows der Größen, die das Kostenmodell verwendet, aus der Azure Retail Prices API (`germanywestcentral`) und der AWS Price List Bulk API (`eu-central-1`, eine große Datei, die gestreamt wird). Beide sind öffentlich; SWAO sendet nur GET-Anfragen. Das Ergebnis wird in `prices/vm-prices.json` im selben Ordner geschrieben, mit API, URL, Region, Währung und Abrufdatum jeder Quelle, und das Kostenmodell bevorzugt es gegenüber der mitgelieferten Tabelle. Preise eines Providers, der nicht aktualisiert wurde oder dessen Preis-API fehlschlug, bleiben aus der vorherigen Tabelle erhalten; eine fehlgeschlagene Preis-API ist eine Warnung und bricht die Katalogaktualisierung nicht ab. `--skip-prices` überspringt die Preisaktualisierung; `--azure-price-api <url>` und `--aws-price-list <url>` verweisen auf einen Spiegel oder Proxy der beiden APIs.
