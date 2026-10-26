# Pass 08: Kryptografische Lage (CRYPTO)

| Eigenschaft | Wert |
|---|---|
| Pass-Nummer | 08 |
| Schlüssel | `crypto` |
| Pass-Name in der Ausgabe | `crypto_posture` |
| Signal-Präfix | `CRYPTO` |
| Typ | Deterministisch (Regel-Engine), kein LLM; eigene deterministische Service-Variante |
| Standard | Aktiv |
| Assessment-Typen | `application`; `llm` (innerhalb jedes Legs); `service` (bedingt: läuft mit der Service-Variante, wenn Konfigurationsdateien oder Binärdateien geliefert werden). Läuft nicht bei `landing-zone-catalog`. |
| Lizenzstufe | Nicht eingeschränkt (ab Community) |

## Wofür der Pass gedacht ist

Schwache oder veraltete Kryptografie ist zugleich Sicherheitsrisiko und Compliance-Hindernis, und der Umgang mit Schlüsseln ändert sich beim Plattformwechsel häufig (etwa von Umgebungsgeheimnissen hin zu einem Key-Management-Service). Pass 08 beantwortet die Frage: **„Nutzt die Anwendung solide kryptografische Primitive, wie werden Tokens signiert, und ist die Verschlüsselung ruhender Daten berücksichtigt?“**

Im Application-Modus untersucht er Quellcode und Konfiguration. Im Service-Modus, in dem kein Quellcode vorliegt, untersucht er die gelieferten Konfigurationsdateien und die von der Binäranalyse erfassten Code-Signing-Zertifikate.

## Was Sie bereitstellen müssen

**Application-Modus**

- Den Quellcode der Anwendung (JavaScript- und TypeScript-Dateien für die eingebauten Muster; Java-, Python-, C#-, Go- und Kotlin-Code sowie Konfigurationsdateien für den Algorithmenkatalog) mit `package.json` sowie optional `.env.example`, `prisma/schema.prisma` und `docker-compose.yml` (im Wurzelverzeichnis oder in `docker/`).

**Service-Modus** (siehe [Service Portfolio Assessment](/de/service-assessment/))

- Konfigurationsdateien oder Binärdateien in `ingestion/binary/` oder `wsp/inputs/binary/`, oder ein Installationspaket, Paket oder eine SBOM an beliebiger Stelle in `ingestion/` (der Pass durchsucht dann den gesamten Ordner `ingestion/`). Liegt nichts davon vor, wird der Pass übersprungen.
- Optional: das Ergebnis der Binäranalyse `wsp/inputs/binary/binary-analysis.json`, das Pass 25 (BINARY) vor der Pass-Schleife schreibt, für die Zertifikatsprüfung.

In beiden Modi werden weder Zugangsdaten noch ein LLM benötigt.

## Wie der Pass arbeitet

### Application-Modus

1. **Quelldateien scannen** (`.ts`, `.js`, `.mjs`, `.cjs`; `node_modules`, `dist` und `fixtures` werden übersprungen). Für jedes Primitiv werden die erste Datei und Zeile seines Vorkommens festgehalten:

   | Gruppe | Primitiv | Muster (vereinfacht) |
   |---|---|---|
   | Starke Schlüsselableitung | PBKDF2, bcrypt, Argon2id, scrypt | `pbkdf2(`, `bcrypt.hash(`, `argon2.hash(`, `scrypt(` |
   | Starker MAC | HMAC-SHA512, HMAC-SHA256 | `createHmac('sha512'` bzw. `'sha256'` |
   | Authentifizierte Verschlüsselung | AES-GCM | `createCipheriv('aes-128-gcm'`, `'aes-192-gcm'` oder `'aes-256-gcm'` |
   | Schwach (CWE-327) | MD5, SHA-1, DES | `createHash('md5')`, `createHash('sha1')`, `createCipheriv('des')` |

2. **Algorithmenkatalog-Scan** (`pass-catalogs/pass-08-crypto-algorithms.yaml`, Workspace-Überschreibungen in `wsp/inputs/pass-catalogs/`). Codedateien (`.ts`, `.js`, `.mjs`, `.cjs`, `.java`, `.py`, `.cs`, `.go`, `.kt`) werden mit den `imports`-Token jedes Eintrags abgeglichen, Konfigurationsdateien (`.yaml`, `.yml`, `.properties`, `.conf`, `.ini`, `.toml`, `.xml`, `.env`; ohne Lock-Dateien) mit seinen `config_keys` und beide mit seinen `context`-Ausdrücken. Der Abgleich nutzt den gemeinsamen Katalog-Matcher: nur ganze Bezeichner (`TDEA` trifft nicht `istDeaktiviert`), nackte Akronyme wie `3DES`, `RC4` oder `SHA1` nur innerhalb eines Cipher-Aufrufs oder einer Algorithmus-Zuweisung (`Cipher.getInstance("DESede/...")`, `createCipheriv('rc4', ...)`, `algorithm: '3DES'`); generierte oder minifizierte Dateien, Dateien über 512 KB, Zeilen über 1.000 Zeichen, Base64-Folgen und `data:`-URIs werden nie abgeglichen. Jedes Vorkommen wird gezählt (bis zu 50 je Eintrag gespeichert) und als Produktiv- oder Testcode eingeordnet. Kontext-Ausnahmen im Katalog senken den Schweregrad einzelner Treffer: SHA-1 in einer TOTP/HOTP-Konfiguration (RFC 6238) ist informational, HMAC-SHA1 low, ein SHA-1-Digest neben einem Git-Objektheader, `sha1sum` oder ETag-Merkmal informational. Beschreiben ein eingebautes Muster und ein Katalogeintrag denselben Algorithmus, gehört das Signal dem Katalogeintrag. Siehe `pass-catalogs/README.md`.

   Java (#3422): Der Katalog bewertet JCA-Algorithmus-Strings in Aufrufen von `Cipher`, `MessageDigest`, `Mac`, `KeyGenerator`, `SecretKeyFactory` und `Signature` (etwa `Cipher.getInstance("DESede/CBC/PKCS5Padding")`, `KeyGenerator.getInstance("DES")`, `Mac.getInstance("HmacMD5")`, `Signature.getInstance("SHA1withRSA")`, `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")`, `MessageDigest.getInstance("SHA-256")`), BouncyCastle-Lightweight-Klassen (`DESEngine`, `DESedeEngine`, `RC4Engine`, `MD5Digest`, `SHA1Digest`, `SHA256Digest`, `GCMBlockCipher`) und Spring-Security-Passwort-Encoder: `BCryptPasswordEncoder`, `Pbkdf2PasswordEncoder`, `SCryptPasswordEncoder` und `Argon2PasswordEncoder` sind zugelassen; `NoOpPasswordEncoder`, `StandardPasswordEncoder`, `MessageDigestPasswordEncoder`, `LdapShaPasswordEncoder` und `Md4PasswordEncoder` sind schwach (Eintrag `spring-legacy-password-encoder`). Die zugelassenen Java-Einträge `pbkdf2-sha2`, `scrypt` und `hmac-sha2` sind mit den eingebauten JavaScript-Mustern gepaart; ein Repository mit beidem meldet die KDF bzw. den MAC einmal.
3. **Inventar der Java Cryptography Architecture (#3422).** Im selben Lesedurchgang wird jeder JCA-Engine-Aufruf mit literalem Algorithmus-String (`Cipher`, `MessageDigest`, `Mac`, `KeyGenerator`, `KeyPairGenerator`, `SecretKeyFactory`, `KeyFactory`, `Signature`, `KeyAgreement`, `KeyStore`, `SecureRandom`, `AlgorithmParameters`, `CertificateFactory`, `TrustManagerFactory`, `KeyManagerFactory`, `SSLContext`) und jede Registrierung eines BouncyCastle-Providers in Java-, Kotlin-, Groovy- oder Scala-Dateien mit Datei und Zeile aufgeführt, gleich ob der Katalog den Algorithmus bewertet (etwa `AES/CBC/PKCS5Padding`, `SHA1PRNG`, `PKCS12`). Gespeichert werden bis zu 50 Aufrufe, Produktivcode zuerst; die Gesamtzahl zählt jeden Aufruf, die Zählung je Algorithmus deckt die gespeicherten Aufrufe ab, und `truncated` kennzeichnet eine längere Liste.
4. **JWT-Signaturverfahren.** Ist `@nestjs/jwt`, `jsonwebtoken` oder `jose` eine Abhängigkeit oder existiert eine `.env.example`, liest der Pass `.env.example`: `JWT_PRIVATE_KEY`, `RSA_PRIVATE_KEY`, `EC_PRIVATE_KEY` oder `JWT_PUBLIC_KEY` bedeutet asymmetrische Signatur (RS256 oder ES256); `JWT_SECRET_KEY`, `JWT_SECRET` oder `NEXTAUTH_SECRET` bedeutet ein symmetrisches HMAC-Geheimnis.
5. **HTTP-Sicherheitsheader.** `helmet` oder `@fastify/helmet` in den Abhängigkeiten.
6. **Verschlüsselung ruhender Daten.** Eine Verschlüsselungsannotation im Prisma-Schema (`encrypt`, `@encrypted`, `@cipher`, `cipher_`), eine Abhängigkeit mit `kms` oder `vault` im Namen oder `kms`, `vault` bzw. `luks` in der Compose-Datei.

### Service-Modus

1. Durchsucht Text-Konfigurationsdateien (`.ini`, `.xml`, `.conf`, `.cfg`, `.config`, `.json`, `.env`, `.properties`, `.yaml`, `.yml`, `.toml`, `.txt`, `.reg`, je bis 2 MB) Zeile für Zeile nach drei Regeln:
   - `weak_algorithm`: MD5, SHA-1, RC4, 3DES oder DES, ECB-Modus
   - `cleartext_endpoint`: URLs mit `http://`, `ldap://`, `ftp://` oder `telnet://` außer `localhost` und `127.0.0.1`
   - `hardcoded_secret`: Zuweisungen an `password`, `passwd`, `pwd`, `secret`, `api_key`, `access_token` oder `private_key` mit einem literalen Wert (Platzhalter wie `${...}`, `%...%`, `<...>` oder `***` werden ignoriert)
2. Liest `binary-analysis.json` und zählt Code-Signing-Zertifikate, deren Gültigkeit vor dem Assessment-Datum endete und deren Signatur keinen Zeitstempel trägt (eine Signatur mit Zeitstempel bleibt nach Ablauf des Zertifikats gültig).
3. Die Evidenz nennt nur Datei und Zeile; gefundene Werte wie Passwörter werden niemals in ein Signal übernommen.

## Wie gemessen wird

### Application-Modus

Die Signalnummern werden in der folgenden Reihenfolge vergeben; `CRYPTO-01` steht daher nicht immer für dieselbe Prüfung.

| Reihenfolge | Wird erzeugt, wenn | Schweregrad | Bedeutung |
|---|---|---|---|
| 1 | Starke Schlüsselableitungsfunktion gefunden | positive | KDF für Passwort- oder API-Schlüssel-Hashing im Einsatz (NIST SP 800-132 bzw. OWASP-Empfehlung) |
| 2 | HMAC-SHA512 oder HMAC-SHA256 gefunden | positive | Starker MAC (NIST FIPS 198-1) |
| 3 | AES-GCM wird an `createCipheriv` übergeben | positive | Authentifizierte symmetrische Verschlüsselung (NIST SP 800-38D) |
| 4 | JWT-Abhängigkeit oder JWT-Schlüsselvariable in `.env.example` | positive (asymmetrisch), medium (symmetrisches Geheimnis), low (Verfahren unbestimmt) | Token-Signaturverfahren; bei symmetrischen Geheimnissen empfiehlt der Pass RS256 oder ES256 mit KMS-gestütztem Schlüssel für souveräne Bereitstellungen mit mehreren Diensten |
| 5 | Helmet vorhanden | positive | HTTP-Sicherheitsheader aktiv (OWASP A05:2021) |
| 6 | Kein Treffer der eingebauten Muster oder des Katalogs und keines der obigen Signale | informational (Konfidenz low) | "No cryptographic primitives detected by pattern scan (languages scanned: ...; files: N)"; manuelle Prüfung empfohlen |
| 7 | Immer | positive (Verschlüsselung ruhender Daten gefunden) oder medium | Ohne Nachweis hängt die Volume-Verschlüsselung vom Host ab und muss im Bereitstellungs-Runbook geprüft werden (der Pass verweist auf DORA Artikel 9 und BSI C5) |
| 8 und folgende | Je gefundenem schwachem Primitiv | high, wenn ein Vorkommen im Produktivcode von keiner Kontext-Ausnahme erfasst ist; der stärkste Ausnahme-Schweregrad, wenn alle Produktiv-Vorkommen erfasst sind (Konfidenz medium); unverändert, aber Konfidenz low bei Vorkommen nur im Testcode; mit `assessment.test_code.mode: tag` senkt der Testcode-Marker es danach um eine Stufe | Gebrochener oder riskanter Algorithmus (CWE-327): "N occurrences (P production, T test)", die angewandten Ausnahmen mit Begründung, bis zu 10 Fundstellen mit Produktivcode zuerst |
| Folgende Nummern | Je gefundenem zugelassenem Katalog-Algorithmus, dessen eingebautes Gegenstück nicht bereits oben ein positives Signal erzeugt hat | positive (informational bei Vorkommen nur im Testcode) | Zugelassenes Primitiv mit Status nach BSI TR-02102 und NIST und Anzahl der Vorkommen |
| Zuletzt | Mindestens ein JCA-Aufruf mit literalem Algorithmus (Schritt 3) | informational, Konfidenz hoch | „Java Cryptography Architecture usage“: Engine und Algorithmus mit Anzahl, registrierte Provider, „N occurrences (P production, T test)“, bis zu 10 Fundstellen mit Produktivcode zuerst; unterdrückt den Rückfall in Zeile 6, ändert aber nie `overall_posture`, `nist_compliant` oder `blocks_migration` |

Der `assessment`-Block enthält:

- `primitives`: `api_key_hash`, `access_token`, `symmetric_encryption`, `jwt_signing`, `tls`, `at_rest_encryption`
- `overall_posture`: `weak_primitives_detected`, `weak_primitives_context_excepted` (alle Produktiv-Vorkommen von einer Kontext-Ausnahme erfasst), `weak_primitives_in_test_code_only`, `good_with_infrastructure_gap` (starke KDF, starker MAC, AES-GCM oder zugelassener Katalog-Algorithmus im Produktivcode, kein schwaches Primitiv) oder `unknown`
- `nist_compliant`: `true`, wenn ein starkes Primitiv im Produktivcode gefunden wird und kein schwaches Primitiv
- `blocks_migration`: `true`, wenn ein schwaches Primitiv ein Vorkommen im Produktivcode hat, das keine Kontext-Ausnahme erfasst, oder (nur im Standard-Testcode-Modus `include`) ein Vorkommen mit Schweregrad high im Testcode
- `hits`: je Katalogeintrag `total`, `production`, `test`, `unclassified`, `truncated` und die gespeicherten `locations` (Datei, Zeile, Pfadklasse, Regel, Ausnahme)
- `jca_inventory` (wenn ein JCA-Aufruf gefunden wurde): `total`, `production`, `test`, `unclassified`, `truncated`, `algorithms` (Engine, Algorithmus, Anzahl), `providers` und die gespeicherten `locations`
- `pattern_scan`: `languages`, `configuration_files` und `files`, die die Musterscans gelesen haben
- `catalogue_errors` (falls vorhanden): Katalogeinträge, Kontext-Ausdrücke oder Ausnahmen, die die Validierung oder den ReDoS-Schutz nicht bestanden haben und übersprungen wurden

### Service-Modus

| Signal | Wird erzeugt, wenn | Schweregrad |
|---|---|---|
| `CRYPTO-NN` je Regel mit Treffern | `weak_algorithm` / `cleartext_endpoint` / `hardcoded_secret` gefunden | high / medium / high (Outcome negative); die Evidenz nennt bis zu 20 Verweise im Format Datei:Zeile |
| Nächstes `CRYPTO-NN` | Mindestens ein abgelaufenes Code-Signing-Zertifikat ohne Zeitstempel | high (Outcome negative) |
| `CRYPTO-01` | Nichts gefunden | informational, Outcome indeterminate: Fehlen in einer Teilstichprobe beweist keine solide Lage |

Der Service-`assessment`-Block enthält `mode: service`, `files_scanned`, `findings` je Regel, `expired_certificates` und `blocks_migration` (schwacher Algorithmus oder abgelaufenes Zertifikat).

**Wie die Ergebnisse in spätere Passes einfließen.** CRYPTO-Signale sind Evidenz für Controls zu Kryptografie und Schlüsselverwaltung in Pass 11 (COMP) (etwa BSI C5, ISO 27001 oder DORA, wenn diese in `assessment.regimes_active` aktiv sind) sowie für [Pass 09 (SYNTH)](/de/passes/09-synth). Signale mit hohem Schweregrad werden zu abgeleiteten Sicherheits-Findings.

## Drittanbieter-Module und Werkzeuge

Keine. Der Musterabgleich nutzt eingebaute reguläre Ausdrücke und den gemeinsamen Katalog-Matcher (`catalogue-matcher.ts`); es wird weder ein externer Scanner noch eine Bibliothek aufgerufen. Die Zertifikatsdaten im Service-Modus stammen aus Pass 25 (BINARY).

## Ausgaben

- `wsp/runs/<ts>/passes/08-crypto.yaml` mit Kopf (`id: 8`, `name: crypto_posture`), Signalen und `assessment`.

## Konfiguration und Einschränkungen

**Konfiguration**

- `--passes crypto` führt den Pass allein aus.
- Service-Modus: Legen Sie Konfigurationsexporte neben einem Installationspaket oder einer SBOM an beliebiger Stelle in `ingestion/` ab, oder in `ingestion/binary/`.

**Einschränkungen und bekannte Lücken**

- Die eingebauten Muster decken nur JavaScript und TypeScript und die Benennung der Node.js-`crypto`-API ab. Kryptografie in Java, .NET, Go, Python und Kotlin wird über die Einträge des Algorithmenkatalogs erkannt, JCA-Aufrufe in Java und Kotlin werden zusätzlich inventarisiert; Rust wird nicht gescannt.
- Das JCA-Inventar braucht einen literalen Algorithmus-String: `Cipher.getInstance(ALGORITHM)` mit einer Konstanten oder einem Wert aus der Konfiguration wird nicht aufgeführt. Schlüssellängen (`KeyGenerator.init(1024)`, RSA-Moduluslänge) werden nicht bewertet.
- Das JCA-Inventar speichert höchstens 50 Aufrufe, Produktivcode zuerst. Die Gesamtzahl zählt jeden Aufruf, die Zählung je Algorithmus deckt aber nur die gespeicherten Aufrufe ab: In einer großen Codebasis kann ein Algorithmus, der erst jenseits der ersten 50 Aufrufe vorkommt, in `algorithms` fehlen (`truncated` kennzeichnet diesen Fall).
- Testcode wird am Pfad erkannt (`test/`, `tests/`, `__tests__/`, `systemtest/`, `src/test/java`, `*.test.ts`, `*Test.java` und ähnliche); ein schwaches Primitiv, das nur dort vorkommt, blockiert die Migration nur im Standard-Testcode-Modus `include`, nicht unter `tag` oder `exclude`.
- Die TLS-Konfiguration wird nicht untersucht; das Primitiv `tls` spiegelt nur das Vorhandensein von Helmet wider.
- `.env.example`, Prisma-Schema und Compose-Datei werden nur an festen Orten im Wurzelverzeichnis gelesen (Compose zusätzlich in `docker/`).
- Im Application-Modus wird nicht nach Geheimnissen im Quellcode gesucht; nutzen Sie dafür den optionalen Malware-Pass ([Malware-Scan](/de/malware-scanning)).
