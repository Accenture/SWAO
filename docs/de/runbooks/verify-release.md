# Einen SWAO-Release-Download prüfen

Jeder SWAO-Release enthält SHA-256-Prüfsummendateien und GPG-Signaturen (`.asc`). Damit
können Sie prüfen, dass ein heruntergeladenes Binary genau das ist, welches das SWAO
Development Team veröffentlicht hat, und dass es unterwegs nicht verändert wurde.

## Signaturschlüssel

| Feld | Wert |
|---|---|
| Schlüsseltyp | Ed25519 + Cv25519 |
| UID | SWAO Security (SWAO Project Security Key) |
| Fingerprint | 7F50A63D2884751B902ED453F876CFFED7D95A7A |
| Gültig bis | 2028-09-04 |
| Öffentliche Schlüsseldatei | `swao-security.asc` im Wurzelverzeichnis des Repositorys |

Vergleichen Sie den Fingerprint nach dem Import mit dem obigen Wert, bevor Sie einer Signatur vertrauen.

## Prüfen

```bash
# SWAO-Signaturschlüssel importieren (einmalig)
gpg --import swao-security.asc
gpg --fingerprint 7F50A63D2884751B902ED453F876CFFED7D95A7A

# Signatur der Prüfsummendatei prüfen
gpg --verify SHA256SUMS.asc SHA256SUMS

# Binary gegen die Prüfsummendatei prüfen
sha256sum -c SHA256SUMS --ignore-missing
```

Jedes Tier hat eine eigene Prüfsummendatei (`SHA256SUMS-community`, `SHA256SUMS-consultant`,
`SHA256SUMS-enterprise`) mit eigener `.asc`; die vom öffentlichen Build hochgeladenen
Community-Binaries stehen zusätzlich in `checksums.sha256`. Unter Windows nutzen Sie
`Get-FileHash <Datei> -Algorithm SHA256` und vergleichen den Wert mit der Prüfsummendatei.

Windows SmartScreen oder ein Endpoint-Schutzprodukt kann bei einem neuen Binary trotzdem
warnen; siehe [Windows-Binary-Allowlisting](windows-binary-allowlisting.md).
