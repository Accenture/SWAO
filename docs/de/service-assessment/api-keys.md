# Optionale API-Schlüssel

`swao service research` funktioniert ohne API-Schlüssel. Zwei kostenlose Schlüssel machen die Recherche schneller oder schalten eine zusätzliche Prüfung frei. Beide sind optional, und SWAO schreibt Schlüsselwerte nie in den Workspace, in Recherche-Stubs, Protokolle oder Support-Bundles.

## Wie SWAO einen Schlüssel findet

Für jeden Schlüssel prüft SWAO in dieser Reihenfolge:

1. Den SWAO-Credential-Store (verschlüsselt auf diesem Rechner)
2. Die gleichnamige Umgebungsvariable

Schlüssel im Credential-Store ablegen (empfohlen; der Wert wird nicht ausgegeben):

```bash
swao credential set NVD_API_KEY <ihr-schluessel>
swao credential set VT_API_KEY <ihr-schluessel>
swao credential list     # zeigt nur Namen, niemals Werte
```

Oder nur für die aktuelle Shell-Sitzung:

```bash
export NVD_API_KEY=<ihr-schluessel>        # macOS / Linux
$env:NVD_API_KEY = "<ihr-schluessel>"      # Windows PowerShell
```

## NVD-API-Schlüssel (`NVD_API_KEY`)

Die US-amerikanische National Vulnerability Database (NVD) ist die Quelle von SWAO für CVE-Anzahl und Schweregrade pro Hersteller und Produkt.

| | Ohne Schlüssel | Mit Schlüssel |
|---|---|---|
| Anfragebudget | 5 Anfragen pro 30 Sekunden | 10 Anfragen pro 30 Sekunden |
| Wirkung bei einem Portfolio mit 300 Apps | Die Recherche dauert spürbar länger | Etwa doppelt so schnell |

So erhalten Sie einen Schlüssel:

1. Öffnen Sie die NVD-Entwicklerseite unter `https://nvd.nist.gov/developers/request-an-api-key`.
2. Geben Sie die E-Mail-Adresse Ihrer Organisation ein und akzeptieren Sie die Nutzungsbedingungen.
3. Bestätigen Sie den Aktivierungslink, den Sie per E-Mail erhalten; die Seite zeigt dann den Schlüssel an.
4. Legen Sie ihn mit `swao credential set NVD_API_KEY <ihr-schluessel>` ab.

NVD-Ergebnisse werden pro App 7 Tage zwischengespeichert; mit `swao service research --refresh` fragen Sie früher neu ab. Mit oder ohne Schlüssel wird die NVD nur für Apps mit Herstellernamen (`vendor.name`) abgefragt; siehe [Pass 24 RESEARCH](/de/passes/24-research).

## VirusTotal-API-Schlüssel (`VT_API_KEY`)

VirusTotal prüft, ob der SHA-256-Hashwert eines von Ihnen bereitgestellten Installationspakets bei Antiviren-Engines als schädlich bekannt ist. SWAO sendet **nur den Hashwert**, niemals die Datei.

| | Ohne Schlüssel | Mit Schlüssel |
|---|---|---|
| VirusTotal-Abfrage | Übersprungen (`skipped_reason: no_api_key`) | Erkennungsquote, Datum der letzten Analyse und Permalink pro Installationspaket |
| Wirkung auf die Bewertung | Kontrolle APM-SEC-06 bleibt unbewertet | APM-SEC-06 "Installer not flagged as malicious" wird bewertet |

Voraussetzung: ein Installationspaket, das Pass 25 BINARY auswertet (eine PE-Datei wie `.exe` oder `.dll` oder ein `.msi`-Paket), an beliebiger Stelle in `apps/<id>/ingestion/`, in `apps/<id>/wsp/inputs/binary/` oder in einem lokalen Installationspfad, damit Pass 25 einen Hashwert berechnet hat. Apps ohne Hashwert werden mit `skipped_reason: no_binary_hash` übersprungen.

So erhalten Sie einen Schlüssel:

1. Legen Sie unter `https://www.virustotal.com` ein kostenloses Community-Konto an.
2. Öffnen Sie Ihr Benutzermenü und wählen Sie **API key**.
3. Legen Sie ihn mit `swao credential set VT_API_KEY <ihr-schluessel>` ab.

Die kostenlose öffentliche API erlaubt 4 Abfragen pro Minute; SWAO taktet die Anfragen entsprechend. Ergebnisse werden 7 Tage zwischengespeichert. Prüfen Sie vor dem Senden von Hashwerten an einen Drittanbieter die Richtlinien Ihrer Organisation; Hashwerte verraten keinen Dateiinhalt, wohl aber, welche Software Sie betreiben.

## Quellen ohne Schlüssel

endoflife.date (Supportende), CISA KEV (aktiv ausgenutzte Schwachstellen), BSI CERT-Bund (deutsche Warnmeldungen) und OSV.dev (Open-Source-Schwachstellen) werden ohne Registrierung abgefragt. Siehe [Pass 24 RESEARCH](/de/passes/24-research).

Siehe auch: [Befehlsreferenz](/de/service-assessment/commands).
