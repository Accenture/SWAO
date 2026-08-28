# Windows: SWAO-Binary freigeben

Windows Defender SmartScreen blockiert die SWAO-Programmdatei beim ersten Start, da sie in Microsofts Reputationsdienst noch nicht weit verbreitet ist. Dieses Runbook beschreibt, wie die Binary auf einzelnen Rechnern und in Unternehmensumgebungen freigegeben werden kann.

---

## Warum SmartScreen die Binary blockiert

SmartScreen prüft jede heruntergeladene Programmdatei gegen eine cloudbasierte Reputationsdatenbank. Binaries, die noch keine ausreichende Download-Historie aufgebaut haben, erhalten eine Warnung -- unabhängig davon, ob sie signiert sind. SWAO-Binaries sind signiert und sicher; die Blockierung ist ein Reputationsschwellenproblem, kein Sicherheitsbefund.

---

## 1. Interaktive Freigabe über Dateieigenschaften

1. `swao-enterprise-win.exe` von der GitHub-Releases-Seite herunterladen.
2. Rechtsklick auf die Datei im Windows Explorer und **Eigenschaften** auswählen.
3. Auf der Registerkarte **Allgemein** den Sicherheitshinweis unten suchen: "Diese Datei stammt von einem anderen Computer. Der Zugriff wurde möglicherweise aus Sicherheitsgründen blockiert."
4. Das Kontrollkästchen **Zulassen** anhaaken und auf **Übernehmen** klicken.
5. **OK** klicken. Die Datei ist nun auf diesem Rechner vertraünswürdig.

---

## 2. Freigabe per PowerShell

Für die Bereitstellung per Skript oder bei bevorzugter Kommandozeilennutzung:

```powershell
# Unblock the downloaded binary
Unblock-File -Path "C:\Tools\swao\swao-enterprise-win.exe"

# Verify the Zone.Identifier alternate data stream is removed
Get-Item -Path "C:\Tools\swao\swao-enterprise-win.exe" -Stream * |
  Where-Object Stream -ne ':$DATA'
# Expected: no output (Zone.Identifier stream removed)
```

---

## 3. Umgang mit der Meldung "Windows hat Ihren PC geschützt"

Wenn die Binary ausgeführt wird, bevor sie freigegeben wurde, zeigt SmartScreen einen blaün Dialog mit der Meldung "Windows hat Ihren PC geschützt":

1. Auf **Weitere Informationen** (den Link unterhalb der Hauptmeldung) klicken.
2. Der Dialog erweitert sich und zeigt den Herausgebernamen sowie die Herkunft der Datei.
3. Auf **Trotzdem ausführen** klicken.

Die Binary läuft normal. Bei künftigen Ausführungen vom selben Pfad erscheint keine weitere Abfrage.

---

## 4. Unternehmens-MDM und Software-Allowlist

Für Organisationen, die Endpunkte über Microsoft Intune, Endpoint Configuration Manager oder ein Drittanbieter-MDM verwalten:

```powershell
# Add publisher rule via AppLocker (example -- adjust OU/policy target)
# Path rule for a managed install location
New-AppLockerPolicy -RuleType Path `
  -Path "C:\Program Files\SWAO\swao-enterprise-win.exe" `
  -User Everyone `
  -Action Allow
```

Alternativ kann der Binary-Hash zur Software-Allowlist hinzugefügt werden. Den SHA-256-Hash abrufen:

```powershell
Get-FileHash -Path "C:\Tools\swao\swao-enterprise-win.exe" -Algorithm SHA256 |
  Select-Object Hash, Path
```

Diesen Wert vor dem Hinzufügen zur Allowlist-Richtlinie mit dem in jeder GitHub-Version veröffentlichten `sha256sums.txt` vergleichen.

---

## 5. Windows Defender-Ausnahme (CI-/Build-Rechner)

Auf dedizierten Build- oder CI-Rechnern, auf denen keine interaktiven Abfragen möglich sind:

```powershell
# Add a folder exclusion (adjust path to match your binary location)
Add-MpPreference -ExclusionPath "C:\Tools\swao"

# Or add a process exclusion
Add-MpPreference -ExclusionProcess "swao-enterprise-win.exe"
```

Die Ausnahme muss vor dem Pipeline-Schritt gesetzt werden, der `swao-enterprise-win.exe` ausführt. Siehe auch das Runbook [CI/CD-Pipeline-Integration](./cicd-pipeline.md) für ein vollständiges Workflow-Beispiel.

---

## 6. Installation verifizieren

```powershell
# Confirm the binary runs correctly after allowlisting
& "C:\Tools\swao\swao-enterprise-win.exe" --version

# Full health check
& "C:\Tools\swao\swao-enterprise-win.exe" doctor
```

Eine saubere `swao health-check`-Ausgabe mit allen grünen Prüfpunkten bestätigt, dass die Binary vertraünswürdig und betriebsbereit ist.
