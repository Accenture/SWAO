=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Runbook: Lizenzverwaltung

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Lizenzverwaltung

SWAO wird in drei Stufen ausgeliefert -- Community, Consultant und Enterprise -- die jeweils zusätzliche Funktionen freischalten. Dieses Runbook beschreibt die Lizenzanforderung, Aktivierung, den Offline-Betrieb, die Statusabfrage sowie den Umfang der einzelnen Stufen.

---

## Stufenvergleich

| Funktion | Community | Consultant | Enterprise |
|---|---|---|---|
| Kernassessment (Static-, Compliance-, Context-Pass) | Ja | Ja | Ja |
| LLM-Pass (dynamische Analyse) | Ja | Ja | Ja |
| PDF-Berichtgenerierung | Ja | Ja | Ja |
| Berichtsgalerie + Veröffentlichung | Nein | Ja | Ja |
| Power BI-Exportpaket | Nein | Ja | Ja |
| Benutzerdefinierte Compliance-Frameworks | Nein | Ja | Ja |
| Portfolio-Assessments mit mehreren Apps | Nein | Ja | Ja |
| Enterprise-SSO + Auditprotokoll | Nein | Nein | Ja |
| Priority-Support-SLA | Nein | Nein | Ja |

Die Community-Edition läuft ohne Lizenzschlüssel. Alle Funktionen sind lokal verfügbar, ohne Registrierung.

---

## 1. Aktüllen Lizenzstatus prüfen

```bash
swao license status
```

Beispielausgabe:

```
Licence tier:    Community
Key:             (none)
Expires:         n/a
Features:        core, llm, report/pdf
```

Der Befehl `swao doctor` gibt den Lizenzstatus ebenfalls als einen seiner Prüfpunkte aus.

---

## 2. Upgrade von Community auf Consultant

### Schritt 1 -- Lizenztoken anfordern

```bash
swao license request
```

Dieser Befehl gibt einen Token auf stdout aus, der den Rechner-Fingerabdruck verschlüsselt. Den vollständigen Token kopieren.

### Schritt 2 -- Token an das SWAO-Team senden

Den Token an die auf der SWAO-Releases-Seite oder in der Beschaffungsvereinbarung angegebene Adresse senden. Das Team stellt einen an den Token gebundenen Aktivierungsschlüssel aus.

### Schritt 3 -- Schlüssel aktivieren

```bash
swao license activate <activation-key>
```

Bei Erfolg zeigt `swao license status` die neü Stufe und das Ablaufdatum an.

---

## 3. Offline-Aktivierung

Für Rechner ohne ausgehenden Internet-Zugang steht ein Export-/Import-Workflow bereit:

```bash
# On the internet-connected machine: generate the request file
swao license request --export /tmp/swao-licence-request.json

# Transfer the JSON file to the machine that can reach the SWAO licensing service
# then on that machine:
swao license import --key <activation-key> --output /tmp/swao-licence-token.json

# Transfer the token file back to the air-gapped machine and apply it
swao license import /tmp/swao-licence-token.json
```

Das Lizenztoken ist ein signiertes JSON-Payload. Es enthält keine personenbezogenen Daten ausser dem Rechner-Fingerabdruck, der beim `request`-Aufruf eingebettet wird.

---

## 4. Erneürung

Lizenzen haben ein Ablaufdatum. Wenn eine Lizenz innerhalb von 30 Tagen abläuft, gibt `swao doctor` eine gelbe Warnung beim Lizenz-Prüfpunkt aus. Nach dem Ablauf wird der Prüfpunkt rot, und Consultant-/Enterprise-Funktionen werden bis zur Erneürung gesperrt.

```bash
# Check days remaining
swao license status

# Renew: follow the same request -> activate flow as initial activation
swao license request
# email the token, receive new key
swao license activate <new-key>
```

Die Community-Edition läuft unbegrenzt und erfordert keine Erneürung.

---

## 5. Speicherort der Lizenzdatei

Die aktivierte Lizenz wird lokal gespeichert unter:

- **Linux / macOS:** `~/.swao/licence.json`
- **Windows:** `%APPDATA%\swao\licence.json`

Diese Datei nicht manüll bearbeiten. Bei Beschädigung löschen und neu aktivieren.

```bash
# Linux/macOS
rm ~/.swao/licence.json
swao license activate <key>

# Windows (PowerShell)
Remove-Item "$env:APPDATA\swao\licence.json"
swao license activate <key>
```

---

## 6. Enterprise-Lizenzen

Enterprise-Lizenzen werden organisationsweit über einen Lizenzserver bereitgestellt. Für den Enterprise-Onboarding-Leitfaden das SWAO-Team kontaktieren. Die oben beschriebenen `swao license`-Unterbefehle gelten gleichermassen; der Unterschied besteht darin, dass der Aktivierungsschlüssel pro Organisation statt pro Nutzer ausgestellt wird.
