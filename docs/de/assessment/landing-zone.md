# Landing-Zone-Katalogbewertung

![Banner Landing-Zone-Katalogbewertung: die SWAO-Engine prüft fünf Katalogkarten von Anbietern und führt je Karte ein Urteil PASS, PARTIAL oder FAIL](/visuals/banner-landing-zone.svg)

Die Landing-Zone-Katalogbewertung beantwortet eine Frage: **Kann diese Region eines
Cloud-Anbieters diese Anwendung unter den Souveränitätsanforderungen meiner aktiven
Rahmenwerke betreiben?** SWAO nimmt die Plattformdienste, die Ihre Anwendung benötigt,
schlägt sie im Dienstkatalog des Anbieters für die gewählte Region nach, prüft die
Souveränitätsmerkmale der Region (Rechtsraum des Betreibers, extraterritoriale
Zugriffsrisiken, Datenresidenz, Zertifizierungen) gegen die Anforderungen Ihrer
Rahmenwerke und liefert eine Fit/Gap-Bewertung je Dienst sowie ein Gesamturteil je Ziel.

Die Bewertung ist vollständig deterministisch. Sie ruft kein LLM auf und benötigt keine
Cloud-Zugangsdaten. Sie steht in allen Lizenzstufen zur Verfügung.

---

## Was Sie damit tun können

- **Zielplattformen eingrenzen.** Mehrere Anbieter und Regionen in einem Lauf
  nebeneinanderstellen, zum Beispiel eine deutsche souveräne Cloud, ein souveränes
  Angebot eines Hyperscalers und eine Standardregion eines Hyperscalers.
- **Souveränitätsblocker erklären.** Genau sehen, an welcher Anforderung eine Region
  scheitert, etwa „Betreiber unterliegt dem US CLOUD Act“ oder „Zertifizierung nicht
  vorhanden“, und ob es sich um einen strukturellen Blocker oder eine
  Zertifizierungslücke handelt.
- **Fehlende Dienste finden.** Erkennen, welche benötigten Fähigkeiten in einer Region
  fehlen oder nur in einer anderen Version beziehungsweise ohne erforderliche Fähigkeit
  angeboten werden.
- **Eine bestehende Landing Zone prüfen.** Für AWS, die AWS European Sovereign Cloud und
  Azure können Sie einen Snapshot der betriebenen Landing Zone bereitstellen und sehen,
  welche Dienste verfügbar, aber noch nicht aktiviert sind.
- **Die Migrationsentscheidung unterfüttern.** Die Ergebnisse erscheinen in der
  HTML-Publikation und fließen in die 7R-Synthese der Anwendungsbewertung ein.

---

## Was Sie bereitstellen

| Eingabe | Erforderlich | Hinweise |
|---|---|---|
| Ein oder mehrere Ziele (`anbieter:region`) | Ja | Aus den mitgelieferten Katalogen unten oder aus einer Workspace-Kopie (siehe [Kataloge anpassen und erweitern](#kataloge-anpassen-und-erweitern)). Gültige IDs zeigen `swao lz catalogue list` und `swao lz catalogue show <anbieter>` |
| Eine abgeschlossene Anwendungsbewertung der App | Dringend empfohlen | Die benötigten Dienste werden aus dem jüngsten Lauf der App gelesen (Signale der Form `service_dep:<fähigkeit>`). Fehlen sie, warnt SWAO und meldet nur Katalog- und Souveränitätsverfügbarkeit |
| Aktive Rahmenwerke | Empfohlen | `--lz-frameworks` oder `assessment.frameworks` / `assessment.regimes_active` in der `.swao.yml` der App. Souveränitätsprüfungen greifen nur für Rahmenwerke, die `sovereignty_requirements` deklarieren |
| Snapshot der betriebenen Landing Zone | Optional | `apps/<id>/wsp/inputs/terraform/lz-<anbieter>-snapshot.json`. Snapshot-Leser gibt es für `aws`, `aws-esc` und `azure` |

### Welche Rahmenwerke die Souveränitätsprüfung steuern

Unter den mitgelieferten Community-Rahmenwerken deklarieren derzeit drei
Souveränitätsanforderungen für die Landing-Zone-Bewertung:

| Rahmenwerk | Anforderung an die Region |
|---|---|
| [BSI C5](/de/frameworks/bsi-c5) | Keine Exposition gegenüber `us_cloud_act` oder `fisa_702`; Betreiber muss eine `EU-entity` sein; Zertifizierung `BSI_C5` vorhanden |
| [DSGVO](/de/frameworks/gdpr) | Betreiber muss eine `EU-entity` sein; die Schlüsselverwaltung (`key_vault`) wird immer zu den benötigten Diensten hinzugefügt |
| [HIPAA / NIST SP 800-66r2](/de/frameworks/nist-sp-800-66r2-hipaa) | Zertifizierung `HIPAA` vorhanden |

Sind mehrere Rahmenwerke aktiv, kombiniert SWAO deren Anforderungen. Deklariert keines
der aktiven Rahmenwerke Anforderungen, vermerkt der Bericht, dass keine
Souveränitätsprüfung stattgefunden hat (`sovereignty_active: false`). So wird ein
READY-Urteil nicht als Souveränitätsfreigabe missverstanden.

---

## Mitgelieferte Landing-Zone-Kataloge

SWAO liefert zehn Anbieterkataloge aus (je Anbieter eine `<anbieter>.json` in
`lz-catalogues/`, erzeugt am 2026-09-04). Eine Indexdatei gibt es nicht: Die Liste
entsteht aus dem `meta`-Block jeder Datei (Name, Datum, Quelle, Konfidenz,
Regionsanzahl), sodass eine neu in den Ordner gelegte Katalogdatei ohne weitere
Registrierung erscheint. `ionos` und `ovhcloud` sind in
`lz-catalogues/_coming-soon.json` als „coming soon“ vermerkt, dem einzigen Ort dieser
Liste. Souveränität wird
ausschließlich als Fakten gespeichert; Urteile entstehen immer aus Ihren aktiven
Rahmenwerken.

| Anbieter-ID | Plattform | Regionen | Eindeutige Dienste | Rechtsraum des Betreibers | Extraterritoriale Exposition | Katalogstand | Quelle, Vertrauen |
|---|---|---|---|---|---|---|---|
| `stackit` | STACKIT | 2: `eu01` (Deutschland), `eu02` (Österreich) | 46 (eu01: 46, eu02: 29) | EU-Rechtsträger | keine erfasst | 2026-09-04 | STACKIT-PIM-API, mittel |
| `otc` | Open Telekom Cloud / T Cloud Public | 2: `eu-de` (Deutschland), `eu-nl` (Niederlande) | 56 (eu-de: 56, eu-nl: 34) | EU-Rechtsträger | keine erfasst | 2026-08-11 | kuratiert, mittel |
| `delos` | Delos Cloud (nur Deutschland) | 1: `de` | 43 | EU-Rechtsträger | keine erfasst | 2026-08-11 | kuratiert, niedrig |
| `aws-esc` | AWS European Sovereign Cloud | 1: `eusc-de-east-1` (Deutschland) | 113 | EU-Rechtsträger | keine erfasst | 2026-09-04 | botocore-Endpunkte, hoch |
| `aws-iso-e` | AWS ISOE Europe (eingestuft) | 1: `eu-isoe-west-1` | 83 | US-Rechtsträger (konservativ, nicht belegt) | CLOUD Act, FISA 702 | 2026-09-04 | botocore-Endpunkte, niedrig (Souveränitätsangaben nicht belegt) |
| `azure-local` | Azure Local (On-Premises-HCI) | 2: `connected` (Arc-verbundener Kundenstandort), `disconnected` | 17 (connected: 16, disconnected: 6) | Betreiberstandort | `connected`: US CLOUD Act, FISA 702; `disconnected`: keine | 2026-08-11 | kuratiert, mittel |
| `oci` | Oracle Cloud Infrastructure | 6: `eu-frankfurt-1`, `eu-amsterdam-1`, `eu-frankfurt-2` und `eu-madrid-2` (EU Sovereign Cloud), `me-dubai-1`, `me-jeddah-1` | 54 | US-Rechtsträger; EU-Rechtsträger für die beiden Regionen der EU Sovereign Cloud | US CLOUD Act und FISA 702; Regionen der EU Sovereign Cloud: US CLOUD Act | 2026-09-20 | kuratiert, mittel |
| `aws` | Amazon Web Services | 34 (zum Beispiel `eu-central-1` Frankfurt, `eu-west-1` Irland, `eu-north-1` Stockholm) | 288 | US-Rechtsträger | US CLOUD Act, FISA 702 | 2026-09-04 | botocore-Endpunkte, hoch |
| `azure` | Microsoft Azure | 87 (zum Beispiel `germanywestcentral`, `westeurope`, `francecentral`) | 143 | US-Rechtsträger | US CLOUD Act, FISA 702 | 2026-09-04 | Azure-Retail-Prices-API, hoch |
| `gcp` | Google Cloud Platform | 42 (zum Beispiel `europe-west3` Frankfurt, `europe-west10` Berlin, `europe-west4` Niederlande) | 110 | US-Rechtsträger | US CLOUD Act, FISA 702 | 2026-09-04 | Produktliste des Region-Pickers, mittel |

Je Region erfasste Zertifizierungen (Beispiele):

| Anbieter | Region | Zertifizierungen im Katalog |
|---|---|---|
| `stackit` | `eu01` / `eu02` | `BSI_C5`, `ISO_27001` / `ISO_27001` |
| `otc` | `eu-de`, `eu-nl` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `oci` | `eu-frankfurt-1`, `eu-frankfurt-2` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `aws-esc` | `eusc-de-east-1` | `BSI_C5`, `ISO_27001` |
| `aws` | `eu-central-1` | `BSI_C5`, `ISO_27001`, `SOC_2`, `PCI_DSS` |
| `azure` | `germanywestcentral` | `BSI_C5`, `ISO_27001`, `SOC_2` |
| `gcp` | `europe-west3` | `BSI_C5`, `ISO_27001`, `SOC_2`, `PCI_DSS` |
| `delos`, `azure-local` | alle | keine erfasst |

Zertifizierungsnamen werden unabhängig von Groß- und Kleinschreibung und Trennzeichen
verglichen, und `C5` und `BSI_C5` gelten als dasselbe BSI-C5-Testat. Ein
Workspace-Katalog, der `C5` führt, erfüllt daher ein Rahmenwerk, das `BSI_C5` verlangt.

Jeder Diensteintrag enthält Code und Namen, Status, die abstrakten Fähigkeiten, die er
abdeckt (zum Beispiel `kubernetes`, `block_storage`, `ml_inference`), die unterstützten
Modelle der Schlüsselhoheit (`provider-managed`, `byok`, ...) und das Datum der letzten
Prüfung.

`swao health-check` meldet, wie viele Kataloge gefunden wurden und ob jeder aus dem
Lieferumfang oder aus Ihrem Workspace stammt.

### Bereitschaftsprüfungen für `--lzr`

Der Pass für die Landing-Zone-Bereitschaft ([Pass 23, LZR](/de/passes/23-lzr)) nutzt
einen eigenen Prüfkatalog, `controls/landing-zone-checks-catalogue.yaml` (Version
2026-04). Er enthält 10 Prüfungen: 5 speziell für das souveräne STACKIT-Profil und 5,
die für alle Anbieter gelten. 5 davon sind Blocker, 5 Warnungen, verteilt auf die
Kategorien Dienst (4), Netzwerk (2), Kontingent (2), Compliance (1) und Richtlinie (1).

### Katalog der Anbieterfähigkeiten

`controls/cloud-provider-catalogue.yaml` (Version 2026-04, zuletzt aktualisiert am
2026-04-28) beschreibt 16 Cloud- und Hosting-Anbieter auf Unternehmensebene (Typ,
Zertifizierungsstatus, Abdeckung von Compliance-Regimen, Kostenstufe, Souveränitäts-Score,
Herstellerbindung). Er wird vom Synthese-Pass der Anwendungsbewertung für die
Landing-Zone-Zuordnung genutzt, nicht von der hier beschriebenen Katalogbewertung.
`controls/sovereign-service-catalogue.yaml` (31 SaaS- und PaaS-Dienste, davon 9 in
souveräner EU-Form verfügbar, 17 teilweise und 5 nicht verfügbar) unterstützt die
Prüfung der souveränen Verfügbarkeit für die ausgehenden Abhängigkeiten der Anwendung.

---

## Ziele auswählen

SWAO ermittelt die Ziele in dieser Reihenfolge; die erste Quelle, die ein Ziel liefert,
gilt:

1. `--lz-cat-targets "anbieter:region,anbieter:region"`
2. `--lz-provider` zusammen mit `--lz-region` (für die integrierte Bewertung:
   `--lz-cat-provider` und `--lz-cat-region`); eine fehlende Hälfte kommt aus `.swao.yml`
3. `assessment.landing_zone.targets` in der `.swao.yml` der App (wird von der TUI
   geschrieben, wenn Sie Ziele bestätigen)
4. `assessment.lz_cat_targets` in der `.swao.yml` der App (veraltete, kommagetrennte
   Form, wird weiterhin gelesen)
5. `assessment.landing_zone.provider` und `assessment.landing_zone.region` in der
   `.swao.yml` der App
6. dieselben drei Schlüssel in der `.swao.yml` des Workspace, sodass eine Liste für alle
   Apps gelten kann

Die Kommandozeile hat immer Vorrang vor der Konfiguration, und die `.swao.yml` der App hat
Vorrang vor der `.swao.yml` des Workspace. Eine zusätzliche Konfigurationsdatei gibt es
nicht.

Die Rahmenwerke werden aus `--lz-frameworks`, dann `assessment.frameworks`, dann
`assessment.regimes_active` ermittelt.

```yaml
# apps/app-crm-01/.swao.yml
assessment:
  regimes_active: [GDPR, BSI_C5]
  landing_zone:
    targets:
      - stackit:eu01
      - aws-esc:eusc-de-east-1
      - azure:germanywestcentral
```

Jeder Eintrag hat die Form `<anbieter>:<region>`. Die Prüfung der `.swao.yml` weist einen
Eintrag ohne Doppelpunkt zurück:
`[error] .swao.yml validation failed: ... must have the form <provider>:<region>`.
Das einzelne Paar `provider` + `region` bleibt unterstützt;
`provider` allein benennt nur den Anbieter für Pass 23 (LZR).

### Geografien

Ein Ziel darf statt einer Regions-ID eine Geografie nennen, zum Beispiel `azure:Europe`.
SWAO verwendet ein Geografiemodell für alle Kataloge (mitgeliefert und im Workspace):

| Geografie | Akzeptierte Schreibweisen | Länder der Datenresidenz |
|---|---|---|
| `germany` | Germany, DE, Deutschland | DE |
| `eu` | EU, European Union | die 27 EU-Mitgliedstaaten sowie `EU` (EU-weite Residenz) |
| `europe` | Europe | die Länder von `eu` sowie IS, LI, NO, CH, GB |
| `north-america` | North America | US, CA, MX |
| `south-america` | South America, LATAM, Latin America | BR, CL, AR, CO, PE, UY |
| `asia-pacific` | Asia Pacific, APAC | AU, NZ, JP, KR, CN, HK, TW, SG, MY, ID, IN, TH, PH, VN |
| `middle-east` | Middle East | AE, BH, IL, QA, SA, KW, OM, JO |
| `africa` | Africa | ZA, EG, KE, NG, MA |

Die Regeln sind für jeden Anbieter gleich:

- Eine Region gehört zu einer Geografie, wenn ihr `sovereignty.residency_country` (falls
  dieses fehlt: ihr `country`) in der Liste oben steht. Regionen mit `UNKNOWN` als
  Residenzland und die Betreiberstandort-Regionen von `azure-local` (`OPERATOR_SITE`: der
  Kunde wählt den Standort) gehören zu keiner Geografie.
- Eine Regions-ID hat immer Vorrang: `delos:de` ist die Delos-Region `de`, nicht die
  Geografie.
- Standardregion: Unter den Regionen des Anbieters in der Geografie bevorzugt SWAO das
  Residenzland DE (der deutsche Souveränitätskontext von SWAO), dann die Region mit den
  meisten Katalogdiensten, dann die kleinste Regions-ID. Mit den mitgelieferten Katalogen
  wird `Europe` aufgelöst zu `aws:eu-central-1`, `aws-esc:eusc-de-east-1`,
  `aws-iso-e:eu-isoe-west-1`, `azure:germanywestcentral`, `gcp:europe-west3`,
  `stackit:eu01`, `delos:de`, `otc:eu-de` und `oci:eu-frankfurt-1`.
- Die Auflösung wird als `[info] LZ target azure:Europe names a geography; using the
  default region azure:germanywestcentral` ausgegeben und als
  `lz.assessment.target.resolved` protokolliert. Der Lauf hält sie in `run-status.json`
  fest (`resolved_targets`), und die Berichte führen sie auf. Setzen Sie die Regions-ID
  ausdrücklich, wenn Sie selbst wählen wollen.
- Ein Wert, der weder Regions-ID noch Geografie mit passender Region ist (zum Beispiel
  `azure:Atlantis` oder `azure-local:Europe`), wird mit einem Hinweis auf gültige
  Regions-IDs übersprungen; siehe [Teilläufe](#teillaufe).

`swao health-check` prüft konfigurierte Ziele auf dieselbe Weise: Eine Geografie wird als
Info mit der aufgelösten Region gemeldet (`target-geography`), ein unbekannter Wert als
Warnung mit dem Hinweis (`target-invalid`). Die Katalogregel `geography-coverage` schlägt
fehl, wenn ein Katalog ein Residenzland außerhalb des Modells verwendet.

---

## Schritt für Schritt (CLI)

1. **Zuerst die Anwendungsbewertung ausführen**, damit die benötigten Dienste bekannt
   sind:

   ```bash
   swao assess --app app-crm-01
   ```

2. **Ziel-IDs nachschlagen:**

   ```bash
   swao lz catalogue list
   swao lz catalogue show stackit
   ```

3. **Katalogbewertung gegen ein oder mehrere Ziele ausführen:**

   ```bash
   # Ein Ziel
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-provider stackit --lz-region eu01

   # Mehrere Ziele in einem Lauf
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-cat-targets "stackit:eu01,otc:eu-de,aws-esc:eusc-de-east-1,azure:germanywestcentral"

   # Rahmenwerke für die Souveränitätsprüfung ausdrücklich angeben
   swao assess --type landing-zone-catalog --app app-crm-01 \
     --lz-cat-targets "stackit:eu01,aws:eu-central-1" --lz-frameworks "GDPR,BSI_C5"
   ```

4. **Ergebnis als HTML-Bericht publizieren** (in allen Lizenzstufen verfügbar):

   ```bash
   swao publish --app app-crm-01 --lz
   ```

### Integriert in die Anwendungsbewertung

Ergänzen Sie eine normale Bewertung um die Zieloptionen; die Landing-Zone-Bewertung
läuft dann am Ende desselben Laufs mit dessen Signalen:

```bash
swao assess --app app-crm-01 --lz-cat-provider stackit --lz-cat-region eu01
swao assess --app app-crm-01 --lz-cat-targets "stackit:eu01,aws-esc:eusc-de-east-1"
```

Die integrierte Bewertung läuft auch automatisch, wenn in `.swao.yml` Ziele konfiguriert
sind (`assessment.landing_zone.targets` oder `provider` und `region`), in der Datei der
App oder des Workspace, ermittelt wie unter [Ziele auswählen](#ziele-auswahlen)
beschrieben.

---

## Schritt für Schritt (TUI)

1. Starten Sie `swao`, wählen Sie **3 Run Assessment** und dann
   **[3] Landing Zone Catalog Assessment**.
2. Wählen Sie die Anwendung.
3. Wählen Sie den **Cloud Service Provider**.
4. Nutzen Sie bei vielen Regionen **Filter regions** und markieren Sie eine oder mehrere
   **Target Regions**.
5. Bestätigen Sie. SWAO schreibt die gewählten Ziele nach `assessment.landing_zone.targets`
   in der `.swao.yml` der App (der Schlüssel, den die CLI liest) und führt die Bewertung
   aus; der Abschlussbildschirm zeigt das Urteil je Ziel. Sind bereits Ziele konfiguriert
   (`.swao.yml` der App oder des Workspace), sind sie in der Anbieter- und
   Regionsauswahl vorausgewählt.

Der Bildschirm der Anwendungsbewertung bietet dieselbe Auswahl von Anbieter und Region
als optionalen Schritt **Target Landing Zone** für die integrierte Bewertung.

---

## Was Sie erhalten

Ein eigenständiger Lauf legt einen normalen Lauf-Ordner der App an:

```
apps/<id>/wsp/
+-- latest-landing-zone-catalog.txt         Verweis auf den jüngsten LZ-Lauf
+-- runs/<zeitstempel>/
    +-- passes/lz-fit.yaml                  ein Ziel
    +-- passes/lz-fit-<anbieter>-<region>.yaml          je Ziel (mehrere Ziele)
    +-- lz-catalogue-fit.yaml               Fit-Bericht (ein Ziel)
    +-- lz-catalogue-fit-<anbieter>-<region>.yaml       je Ziel (mehrere Ziele)
    +-- lz-narratives.json                  Zusammenfassung in Klartext je Ziel
    +-- run-manifest.json                   mit Katalogherkunft und SHA-256 je Anbieter
    +-- run-context.yaml
    +-- run-status.json                     started, complete, partial, failed oder aborted
```

### Teilläufe

Ein Ziel, das nicht bewertet werden kann (eine unbekannte Region oder eine fehlschlagende
Bewertung), hält den Lauf nicht an. SWAO gibt eine `[warning]` mit bis zu zehn gültigen
Regions-IDs aus, protokolliert `lz.assessment.provider.error` und fährt mit den übrigen
Zielen fort. `run-status.json` im Lauf-Ordner hält das Ergebnis fest:

| Status | Bedeutung |
|---|---|
| `started` | Der Lauf ist aktiv oder endete, ohne abzuschließen (zum Beispiel ein beendeter Prozess) |
| `complete` | Alle Ziele wurden bewertet |
| `partial` | Mindestens ein Ziel wurde bewertet und mindestens eines übersprungen; `failed_targets` nennt jedes übersprungene Ziel mit dem Grund |
| `failed` | Alle Ziele schlugen fehl (Exit-Code 1); weder `run-manifest.json` noch ein `latest-*`-Verweis werden geschrieben |
| `aborted` | Der Lauf wurde unterbrochen (SIGINT oder SIGTERM) |

Der LZ-Textbericht (`swao report --app <id> --type landing-zone-catalog`), die
HTML-Publikation und der Engagement Hub zeigen die übersprungenen Ziele eines
`partial`-Laufs mit dem Grund, damit ein Ergebnis nie für einen vollständigen Vergleich
gehalten wird.

### Urteile je Dienst

| Urteil | Bedeutung |
|---|---|
| `SUPPORTED` | Die Region bietet die Fähigkeit an (ohne Snapshot zählt die Verfügbarkeit als Treffer) |
| `AVAILABLE_NOT_ENABLED` | In der Region verfügbar, im Snapshot der betriebenen Landing Zone aber nicht aktiviert |
| `MISCONFIGURED` | Aktiviert, aber der Snapshot zeigt ein Konfigurationsproblem |
| `NOT_AVAILABLE_IN_REGION` | In dieser Region nicht angeboten |
| `VERSION_MISMATCH` | Angeboten, aber nicht in der benötigten Version |
| `CAPABILITY_MISSING` | Angeboten, aber ohne eine benötigte Fähigkeit |
| `SOVEREIGNTY_GAP` | Die Region erfüllt eine Souveränitätsanforderung der aktiven Rahmenwerke nicht |

Jeder nicht unterstützte Eintrag wird zusätzlich zu einem `LZ-NN`-Signal. Schweregrad:
`SOVEREIGNTY_GAP` kritisch; `NOT_AVAILABLE_IN_REGION` und `MISCONFIGURED` hoch;
`AVAILABLE_NOT_ENABLED` mittel.

### Gesamturteil je Ziel

| Gesamturteil | Wann |
|---|---|
| `SOVEREIGNTY_BLOCKED` <span class="swao-badge fail">FAIL</span> | Jede Souveränitätsverletzung. `blocker_category` gibt an, ob sie strukturell ist (Rechtsraum, Exposition), eine Zertifizierungslücke oder gemischt |
| `BLOCKED` <span class="swao-badge fail">FAIL</span> | Ein benötigter Dienst fehlt oder ist nur in falscher Version beziehungsweise ohne benötigte Fähigkeit verfügbar |
| `READY_WITH_CHANGES` <span class="swao-badge partial">PARTIAL</span> | Alles ist verfügbar, aber Dienste müssen in der betriebenen Landing Zone aktiviert oder korrigiert werden |
| `NEEDS_VERIFICATION` <span class="swao-badge partial">PARTIAL</span> | Wäre READY, aber es wurden keine benötigten Dienste gefunden oder eine Basiskategorie (Compute, Netzwerk, Schlüsselverwaltung, Speicher) wurde nicht abgedeckt |
| `READY` <span class="swao-badge pass">PASS</span> | Alle benötigten Dienste werden unterstützt, und alle Souveränitätsprüfungen sind bestanden |

Ist in einem Lauf mit mehreren Zielen mindestens ein Ziel READY, nennt der
Behebungshinweis jedes souveränitätsblockierten Ziels dieses als souveräne Alternative.

---

## Landing-Zone-Bereitschaft aus Terraform (`--lzr`)

`--lzr <landingZoneId>` ist eine andere Prüfung. Statt eines Anbieterkatalogs liest sie
die Terraform-State- oder -Plan-Dateien einer bestehenden Landing Zone aus
`apps/<id>/wsp/inputs/terraform/` und wertet den Prüfkatalog dagegen aus. Das Ergebnis
landet in `passes/23-lzr.yaml` mit dem Gesamturteil `ready` oder `blocked` und fließt in
die 7R-Anpassung des Synthese-Passes ein.

```bash
swao assess --app app-crm-01 --lzr lz-prod
swao assess --app app-crm-01 --lzr lz-prod --lzr-fail-on-blocked   # Exit-Code 4 bei Blockade
```

Mit `--portfolio --lzr <id>` (Enterprise) führt SWAO die Bereitschaftsprüfung für jede
Anwendung im Workspace aus und schreibt `wsp/runs/<zeitstempel>/lzr-summary.json` auf
Workspace-Ebene. Im Portfoliomodus wird im Ordner `wsp/inputs/terraform/` jeder App in
dieser Rangfolge nach `lz-meshstack-snapshot.json`, `lz-aws-snapshot.json`,
`lz-azure-snapshot.json` oder Terraform-Dateien gesucht; so kann auch ein Export der
meshStack-Plattform als Eingabe dienen.

---

## Kataloge anpassen und erweitern

Die mitgelieferten Kataloge sind Momentaufnahmen. Sie können sie aktualisieren, in den
Workspace kopieren und bearbeiten oder einen Katalog für eine private Cloud anlegen:

```bash
# Aus den öffentlichen Quellen der Anbieter aktualisieren (ab Consultant; ohne Zugangsdaten)
swao lz catalogue update --provider all          # aws, aws-esc, aws-iso-e, stackit, gcp, azure

# Mitgelieferten Katalog zur Bearbeitung in den Workspace kopieren
swao lz catalogue copy stackit
# -> wsp/inputs/catalogs/lz-catalogues/stackit/index.json

# Leeren Katalog für eine private oder regionale Cloud anlegen
swao lz catalogue new meine-private-cloud

# Herkunft jedes Katalogs anzeigen (Workspace oder Lieferumfang)
swao lz catalogue list --origin
swao lz catalogue show stackit                   # gibt "origin workspace: <datei>" oder "origin bundled: <datei>" aus
```

`swao lz catalogue copy <anbieter>` und `swao lz catalogue new <anbieter>` legen beide
im Workspace die Datei `wsp/inputs/catalogs/lz-catalogues/<anbieter>/index.json` an.
Sobald diese Datei vorhanden ist, verwendet die Katalogbewertung (eigenständig und
integriert) sie für diesen Anbieter anstelle des mitgelieferten Katalogs; alle anderen
Anbieter nutzen weiterhin den mitgelieferten Katalog. Welcher Katalog verwendet wurde,
hält das Lauf-Manifest fest. Ist eine Workspace-Kopie kein gültiges JSON oder verletzt
sie das Katalogschema, bricht die Bewertung mit einer Fehlermeldung ab, statt auf den
mitgelieferten Katalog auszuweichen. Ein mit `new` angelegter Katalog enthält nur eine
Platzhalterregion (`example-region`) ohne Dienste und ohne Souveränitätsmerkmale;
ergänzen Sie daher echte Regionen, bevor Sie ihn als Ziel verwenden.

Die Katalogdateien und die Vorlage `_lz-catalogue-template.json` sind im öffentlichen
Repository veröffentlicht; dort können Sie sie kopieren:
[github.com/Accenture/SWAO/tree/main/lz-catalogues](https://github.com/Accenture/SWAO/tree/main/lz-catalogues).
Die Community-Rahmenwerke, die die Souveränitätsprüfung steuern, finden Sie unter
[github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks](https://github.com/Accenture/SWAO/tree/main/packages/@swao/community-frameworks/frameworks).

Den vollständigen Ablauf (Regionen ergänzen, Fakten korrigieren, Einträge für private
Clouds anlegen) beschreibt das Runbook
[Landing-Zone-Kataloge anpassen](/de/runbooks/adapting-lz-catalogues).

---

## Grenzen

- Katalogfakten sind Momentaufnahmen. Prüfen Sie Katalogstand und `confidence`-Wert und
  aktualisieren Sie die Kataloge vor einem Projekt. `delos` ist mit niedrigem Vertrauen
  gekennzeichnet.
- Ohne Snapshot der betriebenen Landing Zone zeigt die Bewertung die Verfügbarkeit,
  nicht die tatsächliche Bereitstellung. Snapshot-Leser gibt es nur für `aws`, `aws-esc`
  und `azure`.
- Zertifizierungen werden über den Namen abgeglichen (abgesehen von Groß- und
  Kleinschreibung, Trennzeichen und der Gleichsetzung von `C5` und `BSI_C5`). Eine
  Zertifizierung, die ein Workspace-Katalog unter einem anderen Namen führt, wird nicht
  erkannt. Prüfen Sie einen reinen Zertifizierungsblocker daher am Katalogeintrag, bevor
  Sie ihn berichten.
- `--lzr` wertet die Prüfungen derzeit nur für das souveräne STACKIT-Profil aus.
- Die Bewertung ist nur so vollständig wie die von der Anwendungsbewertung erkannten
  Dienste. Achten Sie auf `NEEDS_VERIFICATION` und Abdeckungswarnungen.
- Souveränitätsfakten sind keine Rechtsberatung. Prüfen Sie die Verträge und
  Auftragsverarbeitungsbedingungen des Anbieters.

---

## Live-Beispielbericht

Eine Publikation der Landing-Zone-Katalogbewertung für den Demo-Workspace
Sovereign Health:

[Live-Bericht öffnen](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-24T11-36-12-sovereign-health-lz.html)

Er zeigt die Fit/Gap-Analyse über europäische souveräne Anbieter und Hyperscaler hinweg,
mit einem Urteil je Anbieter.

---

## Weiterführende Seiten

- [Überblick über die Bewertungstypen](/de/assessment/)
- [Anwendungsbewertung](/de/assessment/application), die die benötigten Dienste erkennt
- [Pass 23, Landing-Zone-Bereitschaft](/de/passes/23-lzr)
- [CLI-Referenz](/de/runbooks/cli-reference)
