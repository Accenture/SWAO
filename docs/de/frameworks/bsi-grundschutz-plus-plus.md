# BSI Grundschutz++ (BSI_GRUNDSCHUTZ_PP)

Diese Seite beschreibt das Community-Rahmenwerk `BSI_GRUNDSCHUTZ_PP` in der mit SWAO ausgelieferten Fassung: was es abdeckt, wann man es einsetzt, was SWAO prüft und wie man es aktiviert.

## Überblick

| Eigenschaft | Wert |
|---|---|
| Rahmenwerk-ID (für `regimes_active`) | `BSI_GRUNDSCHUTZ_PP` |
| Herausgeber | Bundesamt für Sicherheit in der Informationstechnik (BSI) |
| Version | Anwenderkatalog 2026-10-29 (fortlaufende Veröffentlichung, Commit `c3f37859` des BSI-Repositorys); Methodik BSI-Standard 300-1 Version 1.0 (20.10.2026) |
| Status | Early-Adopter-Phase; laut BSI-Meilensteinplan ab 01.01.2027 zertifizierbar |
| SWAO-Katalogversion | 0.1.0 |
| Kontrollen | 1000 |
| Sprache | Deutsch (BSI-Originaltext) |
| Bewertungsmodus | `binary` |
| Assessment-Typen (Metadaten) | `app`, `aud` |
| Lizenz | BSI-Inhalte unter CC BY-SA 4.0 (BSI Stand-der-Technik-Bibliothek); der Rahmenwerk-Ordner enthält Lizenztext und Namensnennung. Keine Rechtsberatung. |
| Ordner | `bsi-grundschutz-plus-plus` |

## Worum es geht

Grundschutz++ ist der Nachfolger des IT-Grundschutz-Kompendiums (letzte Edition 2023). Das BSI veröffentlicht die Anforderungen als maschinenlesbaren OSCAL-Katalog, den "Anwenderkatalog Grundschutz++". Statt Bausteinen gibt es 20 Praktiken mit 140 Themen:

- Sechs Methodik-Praktiken: GC, STM, UMS, VRB, PERF und RISK.
- Vierzehn Praktiken bilden den "Stand der Technik Kernel": ASST, PERS, BES, DLS, TEST, GEB, SENS, ARCH, BER, NOT, DET, REA, KONF und DEV.

Anforderungen gelten für Zielobjektkategorien. Es gibt zwei Sicherheitsniveaus: `normal-SdT` und `erhöht`. Die Vorgehensweise beschreibt BSI-Standard 300-1.

Der SWAO-Katalog enthält alle 1000 Anforderungen des fixierten Katalogstands (652 auf oberster Ebene, 348 verschachtelt). Die Schwere folgt dem Modalverb:

| Modalverb | Schwere | Anforderungen |
|---|---|---|
| MUSS | `high` | 149 |
| SOLLTE | `medium` | 627 |
| KANN | `low` | 224 |

## Wer es in SWAO einsetzt und wann

- Institutionen, die ein ISMS auf Basis von Grundschutz++ planen oder beginnen (Early Adopter), insbesondere öffentliche Verwaltung, regulierte Branchen und KRITIS.
- Engagements, die zeigen müssen, wie ein Workload zu den neuen Anforderungen passt, zusätzlich zu oder anstelle von `BSI_GRUNDSCHUTZ_2023`.
- Die klassische IT-Grundschutz-Zertifizierung bleibt bis 30.11.2031 möglich; beide Rahmenwerke können gemeinsam aktiv sein.

## Was SWAO prüft

Die Kontrollen werden in [Pass 11 (Compliance-Bewertung)](/de/passes/11-comp) bewertet, wie bei jedem Community-Rahmenwerk. Das LLM bewertet jede Kontrolle anhand der Signale des Laufs mit `SATISFIED`, `PARTIAL`, `GAP`, `UNKNOWN` oder `N_A`. Ohne konfigurierten LLM-Anbieter lautet das Ergebnis jeder Kontrolle `UNKNOWN`.

### Welche Nachweise die Controls erwarten

| Nachweisart | Kontrollen |
|---|---|
| Nachweisdokument der Praktik (`context_input: evidence/<praktik>.md`) | 1000 |
| Zusätzlich Code- und Konfigurationssignale, übernommen von einer gleichwertigen 2023-Kontrolle | 25 |

Übernommene Signalpräfixe sind `SBOM` (9), `EGR` (9), `OBS` (4), `IAM` (2) und `DATA` (1). Eine Kontrolle übernimmt sie nur, wenn das BSI-Mapping die 2023-Anforderung als gleich, gleichwertig oder umfassender als die Grundschutz++-Anforderung ausweist.

Füllen Sie die 20 Nachweisvorlagen unter `evidence/` aus und legen Sie sie unter `apps/<app-id>/wsp/inputs/` ab, damit [Pass 04 (CTX)](/de/passes/04-ctx) sie liest. Ohne Nachweise ist für die meisten Kontrollen `UNKNOWN` zu erwarten.

### Filtern mit Tags

Jede Kontrolle trägt Tags, zum Beispiel:

- `praktik:KONF`, `thema:KONF.2`
- `sec-level:normal-SdT` oder `sec-level:erhöht`
- `modal:SOLLTE`, `effort:3`
- `schutzziel:integrity`
- `zielobjekt:<Kategorie>`, `gefaehrdung:G 0.18`
- `parent:<ID>` bei verschachtelten Anforderungen

Damit lässt sich eine Workspace-Kopie für einen Informationsverbund zuschneiden, etwa nur die 773 Anforderungen mit `normal-SdT`.

## Aufbau der Controls

| Praktik | Titel | Kontrollen |
|---|---|---|
| GC | Governance und Compliance | 35 |
| STM | Strukturmodellierung | 15 |
| UMS | Umsetzung | 11 |
| VRB | Verbesserung | 10 |
| PERF | Monitoring-Evaluation | 24 |
| RISK | Risikomanagement | 4 |
| ASST | Informationen und Assets | 58 |
| PERS | Personal | 30 |
| BES | Beschaffungsmanagement | 109 |
| DLS | Dienstleistersteuerung | 18 |
| TEST | Änderungen und Tests | 36 |
| GEB | Gebäudemanagement | 75 |
| SENS | Sensibilisierung | 87 |
| ARCH | Architektur | 63 |
| BER | Berechtigung | 92 |
| NOT | Notfallplanung | 37 |
| DET | Detektion | 82 |
| REA | Sicherheitsvorfallsbehandlung | 23 |
| KONF | Konfiguration | 157 |
| DEV | Entwicklung | 34 |
| **Summe** | | **1000** |

Kontroll-IDs folgen der BSI-ID (`KONF.2.1` wird `GSPP_KONF_2_1`); die Original-ID steht in `official_control_id`.

## Cross-Mapping

338 der 1000 Kontrollen tragen `maps_to`-Verweise, abgeleitet aus den zwei Mapping-Dateien des BSI:

| Ziel-Rahmenwerk | Verweise | Quelle |
|---|---|---|
| `ISO_27001` | 343 | BSI-Mapping ISO/IEC 27001:2022 Anhang A auf Grundschutz++ (Status complete) |
| `BSI_GRUNDSCHUTZ_2023` | 129 | BSI-Mapping Kompendium 2023 auf Grundschutz++ (Status draft) |

Das 2023-Mapping ist ein Entwurf des BSI. Es umfasst 510 Kompendium-Anforderungen; 44 der 105 SWAO-Kontrollen von `BSI_GRUNDSCHUTZ_2023` haben darin eine Entsprechung in Grundschutz++. Die vollständige Gegenüberstellung mit Beziehungsarten in beide Richtungen liegt im Rahmenwerk-Ordner unter `crosswalk/`.

## Rahmenwerk beziehen oder anpassen

- Quelle: [github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-plus-plus](https://github.com/Accenture/SWAO/tree/main/community-frameworks/bsi-grundschutz-plus-plus)
- Upstream-Katalog: [github.com/BSI-Bund/Stand-der-Technik-Bibliothek](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek)

Für ein einzelnes Engagement kopieren Sie den Ordner nach `wsp/inputs/catalogs/community/bsi-grundschutz-plus-plus/` im Workspace und bearbeiten die Kopie. Lassen Sie die `id` in `regime_meta` unverändert und prüfen Sie die Kopie mit dem [Health Check](/de/health-check).

## Aktivieren

1. Kopieren Sie den Ordner `bsi-grundschutz-plus-plus` nach `wsp/inputs/catalogs/community/` im Workspace.
2. Tragen Sie die Rahmenwerk-ID in die `.swao.yml` der App ein:

   ```yaml
   assessment:
     regimes_active: [BSI_GRUNDSCHUTZ_PP]
   ```

3. Führen Sie das [Application Assessment](/de/assessment/application) mit konfiguriertem LLM aus.

## Grenzen und Hinweise

- Der BSI-Katalog wird fortlaufend veröffentlicht; Anforderungs-IDs können sich noch ändern. SWAO fixiert einen Commit des Repositorys und aktualisiert bewusst.
- Mit 1000 Kontrollen erzeugt eine vollständige Bewertung viele LLM-Aufrufe. Für fokussierte Assessments eine Workspace-Kopie über Tags filtern.
- Die Kontrolltexte sind deutscher BSI-Originaltext. Das BSI plant die Internationalisierung ab 2027.
- Drei Anforderungen der Stufe `erhöht` tragen SOLLTE statt KANN (BES.1.4, DET.4.12.1, REA.2.5); sie bleiben wie veröffentlicht.
- Ergebnisse stammen von einem LLM, das Signale und Dokumente interpretiert. Sie unterstützen die fachliche Prüfung und ersetzen weder Audit noch Zertifizierung.
- Diese Seite und die SWAO-Ergebnisse sind keine Rechtsberatung.

## Verwandte Seiten

- [Übersicht der Rahmenwerke](/de/frameworks/)
- [BSI IT-Grundschutz-Kompendium 2023](/de/frameworks/bsi-grundschutz-2023)
- [Pass 11: Compliance-Bewertung](/de/passes/11-comp)
