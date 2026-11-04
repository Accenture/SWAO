# Verify a SWAO release download

Every SWAO release ships SHA-256 checksum files and GPG signatures (`.asc`), so you
can check that a binary you downloaded is the one the SWAO Development Team published
and that it was not changed on the way.

## Signing key

| Field | Value |
|---|---|
| Key type | Ed25519 + Cv25519 |
| UID | SWAO Security (SWAO Project Security Key) |
| Fingerprint | 7F50A63D2884751B902ED453F876CFFED7D95A7A |
| Expires | 2028-09-04 |
| Public key file | `swao-security.asc` in the repository root |

Compare the fingerprint after the import with the one above before you trust a signature.

## Verify

```bash
# Import the SWAO signing key (one-time)
gpg --import swao-security.asc
gpg --fingerprint 7F50A63D2884751B902ED453F876CFFED7D95A7A

# Verify the signature of the checksum file
gpg --verify SHA256SUMS.asc SHA256SUMS

# Verify your binary against the checksum file
sha256sum -c SHA256SUMS --ignore-missing
```

Each tier has its own checksum file (`SHA256SUMS-community`, `SHA256SUMS-consultant`,
`SHA256SUMS-enterprise`), each with its `.asc`; the Community binaries uploaded by the
public build are also listed in `checksums.sha256`. On Windows, use
`Get-FileHash <file> -Algorithm SHA256` and compare the value with the checksum file.

Windows SmartScreen or an endpoint protection product may still warn about a new
binary; see [Windows binary allowlisting](windows-binary-allowlisting.md).
