# Runbook: Code-Signierung

---

## Überblick

Die Windows-Binaries von SWAO (`swao-*-win-x64.exe`) sind eigenständige ausführbare
Dateien, die mit `@yao-pkg/pkg` erstellt werden. Nicht signierte ausführbare Dateien
lösen unter Windows SmartScreen-Warnungen aus und können bei ML-basierten
Antiviren-Engines (insbesondere Trapmine) eine oder mehrere Erkennungen verursachen.
Dieses Runbook beschreibt den Authenticode-Signierprozess für die Windows-Binaries.

**Aktueller Stand:** Die Windows-Binaries sind noch nicht mit Authenticode signiert. Die
Integrität der Releases ist durch GPG-Signaturen geschützt (Abschnitt 5); die
VirusTotal-Ergebnisse werden je Release festgehalten.

---

## 1. Optionen für das Zertifikat

Drei Beschaffungswege, in der Reihenfolge ihrer Eignung für ein internes
Accenture-Werkzeug:

### 1.1 Gemeinsam genutztes Zertifikat der Accenture-IT

Klären Sie mit Accenture IT Security / DevSecOps, ob ein gemeinsam genutztes
Authenticode-Zertifikat (OV oder EV) für die Signierung interner Werkzeuge existiert,
die außerhalb von Accenture verteilt werden. Falls ja:

- Signierung als CI-Pipeline-Schritt über den Accenture-Signierdienst beantragen
- Keine Beschaffungskosten; durch die bestehende Unternehmensvereinbarung abgedeckt
- Ansprechpartner: die Leitung Ihres regionalen DevSecOps- bzw. Platform-Engineering-Teams

### 1.2 Eigenes OV-Zertifikat (empfohlen, falls die Accenture-IT keines bereitstellen kann)

Ein Organisation-Validation-Zertifikat (OV) einer vertrauenswürdigen
Zertifizierungsstelle genügt für die SmartScreen-Akzeptanz, sobald das Binary
ausreichend Download-Reputation aufgebaut hat.

| Zertifizierungsstelle | Geschätzte Kosten | Hinweise |
|---|---|---|
| DigiCert | 400 bis 600 USD/Jahr | Breite Unterstützung; gute CI-Werkzeuge |
| Sectigo (Comodo) | 300 bis 500 USD/Jahr | Günstiger; vergleichbarer Support |

Ablauf der Beschaffung:
1. Domain- bzw. Organisationsvalidierung durch die Zertifizierungsstelle (2 bis 5 Werktage)
2. Erhalt einer PKCS#12-Datei (`.pfx`) mit Zertifikat und privatem Schlüssel
3. Ablage der `.pfx` im gemeinsamen Accenture-Passwortmanager unter `swao/code-signing`

### 1.3 EV-Zertifikat

Ein Extended-Validation-Zertifikat (EV) verschafft sofortige SmartScreen-Reputation
(kein Aufbau erforderlich). Die Kosten liegen bei 700 bis 1200 USD/Jahr. Erforderlich
ist ein Hardware-HSM oder ein Cloud-HSM-Dienst (DigiCert KeyLocker, SSL.com eSigner).
Der Betrieb ist aufwendiger. Nur zu empfehlen, wenn SmartScreen-Warnungen nach dem
Release für Kunden zum Hindernis werden.

---

## 2. Das Binary in GitHub Actions signieren

Fügen Sie den folgenden Schritt in `release.yml` nach dem `pkg`-Build-Schritt und vor
dem Hochladen des Binaries als Release-Asset ein:

```yaml
- name: Sign Windows binary (Authenticode)
  if: runner.os == 'Windows'
  shell: pwsh
  env:
    CODESIGN_PFX_B64: ${{ secrets.CODESIGN_PFX_B64 }}
    CODESIGN_PFX_PASSWORD: ${{ secrets.CODESIGN_PFX_PASSWORD }}
  run: |
    # PFX aus dem Base64-Secret dekodieren
    $pfxBytes = [System.Convert]::FromBase64String($env:CODESIGN_PFX_B64)
    $pfxPath = Join-Path $env:RUNNER_TEMP 'swao-codesign.pfx'
    [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)

    # Mit signtool signieren (auf GitHub-Runnern mit Windows Server 2022 verfügbar)
    & 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe' sign `
      /fd SHA256 `
      /tr http://timestamp.digicert.com `
      /td SHA256 `
      /f $pfxPath `
      /p $env:CODESIGN_PFX_PASSWORD `
      dist-bin\swao-enterprise-win-x64.exe `
      dist-bin\swao-consultant-win-x64.exe `
      dist-bin\swao-community-win-x64.exe

    # Prüfen
    & 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe' verify `
      /pa dist-bin\swao-enterprise-win-x64.exe
```

Erforderliche Secrets in GitHub Actions:
- `CODESIGN_PFX_B64`: Base64-kodierte PKCS#12-Zertifikatsdatei
- `CODESIGN_PFX_PASSWORD`: Passwort der PFX-Datei

So kodieren Sie die PFX-Datei für das Secret in Base64:
```powershell
[System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes('swao-codesign.pfx')) | Set-Clipboard
```

---

## 3. Erwartetes VirusTotal-Ergebnis nach der Signierung

- **OV-Zertifikat, Tag 1:** SmartScreen-Warnung „Unbekannter Herausgeber“; die
  Erkennungen auf VirusTotal sinken typischerweise auf 0/72 (die heuristische
  ML-Erkennung durch Trapmine wird durch die Authenticode-Signatur neutralisiert).
- **OV-Zertifikat, nach etwa 10 000 Downloads:** SmartScreen-Reputation aufgebaut;
  die Warnung entfällt bei späteren Ausführungen.
- **EV-Zertifikat, Tag 1:** SmartScreen-Vertrauen wird sofort gewährt; VirusTotal 0/72.

Führen Sie nach der Signierung einen neuen VirusTotal-Scan durch und aktualisieren Sie
`docs/releases/v1.0.0-vt-baseline.md`.

---

## 4. Allowlisting von Windows-Binaries (bis zur Einführung der Code-Signierung)

In Windows-Unternehmensumgebungen mit AppLocker oder Windows Defender Application
Control (WDAC) werden nicht signierte ausführbare Dateien möglicherweise blockiert.
Für das Hash-Pinning-Verfahren, das bis zur Einführung der Authenticode-Signierung
gilt, siehe [Windows-Binary-Allowlisting](/de/runbooks/windows-binary-allowlisting).

---

## 5. GPG-Signierung der Release-Prüfsummen

Authenticode signiert das Windows-Binary selbst. Die GPG-Signierung ist ein separater,
ergänzender Schritt: Durch die Signatur der Datei SHA256SUMS können Nutzerinnen und
Nutzer die Integrität aller Release-Artefakte prüfen (aller Binaries, nicht nur der
Windows-Binaries).

**Aktueller Stand:** Der öffentliche GPG-Schlüssel ist veröffentlicht, und die Releases
enthalten GPG-Signaturen (`.asc`) für die Prüfsummendateien und die Binaries.

### 5.1 Angaben zum Schlüssel

| Feld | Wert |
|---|---|
| Schlüsseltyp | Ed25519 + Cv25519 |
| UID | SWAO Security (SWAO Project Security Key) |
| E-Mail | siehe UID in `swao/swao-security.asc` |
| Fingerprint | 7F50A63D2884751B902ED453F876CFFED7D95A7A |
| Gültig bis | 2028-09-04 |
| Datei mit dem öffentlichen Schlüssel | `swao/swao-security.asc` (im öffentlichen Repository eingecheckt) |
| Ablageort des privaten Schlüssels | Accenture-Passwortmanager, Eintrag „SWAO GPG Private Key“ |

### 5.2 SHA256SUMS für ein Release signieren

Nachdem alle Binaries erstellt und `SHA256SUMS` lokal erzeugt wurde:

```powershell
# Privaten Schlüssel aus dem Passwortmanager importieren, falls er noch nicht im lokalen Schlüsselbund liegt
& "C:\Program Files\GnuPG\bin\gpg.exe" --import swao-security-PRIVATE.asc

# Prüfsummendatei signieren
& "C:\Program Files\GnuPG\bin\gpg.exe" --armor --detach-sign --local-user 7F50A63D2884751B902ED453F876CFFED7D95A7A SHA256SUMS
# Erzeugt SHA256SUMS.asc
```

Laden Sie sowohl `SHA256SUMS` als auch `SHA256SUMS.asc` als Release-Assets hoch.

### 5.3 Anleitung zur Prüfung für Nutzerinnen und Nutzer

In die Release Notes und in `docs/runbooks/verify-download.md` aufnehmen:

```bash
# SWAO-Signierschlüssel importieren (einmalig)
gpg --import swao-security.asc

# Signatur der Prüfsummendatei prüfen
gpg --verify SHA256SUMS.asc SHA256SUMS

# Prüfsumme Ihres Binaries prüfen
sha256sum -c SHA256SUMS --ignore-missing
```

---

## 6. Referenzen

- Issue #2181 (dieses Runbook ist das zugehörige Ergebnis)
- Issue #2182 (Neuaufbau der VirusTotal-Baseline nach der Signierung)
- [Windows-Binary-Allowlisting](/de/runbooks/windows-binary-allowlisting): Übergangslösung
- ADR-0057: Obfuskation vor dem Build für die Premium-Tiers (unabhängig von der Signierung)
- `swao/swao-security.asc`: veröffentlichter öffentlicher GPG-Schlüssel
