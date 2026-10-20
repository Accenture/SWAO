// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Authenticode (PKCS#7 SignedData) reader for Pass 25 (Design 103 §6.3.1, #3104).
 *
 * Minimal, bounded DER walker: certificates are parsed with node:crypto
 * X509Certificate; the signer is the certificate whose serial number matches
 * the first SignerInfo. Timestamping (legacy countersignature or RFC 3161) is
 * detected so an expired signer with a valid timestamp is not reported as a
 * broken signature. Signature validity is not cryptographically verified.
 */

import { X509Certificate } from 'node:crypto';

/** One DER element: `pos` = tag offset, [start, end) = value. */
interface Tlv { tag: number; pos: number; start: number; end: number; next: number }

function tlv(buf: Buffer, pos: number, limit: number): Tlv | null {
  if (pos + 2 > limit) return null;
  const tag = buf[pos] as number;
  let len = buf[pos + 1] as number;
  let start = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > limit) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (buf[start + i] as number);
    start += n;
  }
  const end = start + len;
  return end > limit ? null : { tag, pos, start, end, next: end };
}

function children(buf: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let pos = parent.start;
  while (pos < parent.end && out.length < 4096) {
    const t = tlv(buf, pos, parent.end);
    if (!t) break;
    out.push(t);
    pos = t.next;
  }
  return out;
}

const OID_COUNTERSIGNATURE = Buffer.from('06092a864886f70d010906', 'hex');
const OID_MS_RFC3161 = Buffer.from('060a2b0601040182370303 01'.replace(/\s/g, ''), 'hex');

export interface CertInfo {
  subject: string;
  issuer: string;
  serial: string;
  not_before: string;
  not_after: string;
}

export interface SignatureInfo {
  present: boolean;
  signer: CertInfo | null;
  certificates: CertInfo[];
  timestamped: boolean;
  parse_error?: string;
}

function certInfo(c: X509Certificate): CertInfo {
  return {
    subject: c.subject.replace(/\n/g, ', '),
    issuer: c.issuer.replace(/\n/g, ', '),
    serial: c.serialNumber.toUpperCase().replace(/^0+(?=.)/, ''),
    not_before: new Date(c.validFrom).toISOString(),
    not_after: new Date(c.validTo).toISOString(),
  };
}

/** Parse a PKCS#7 ContentInfo holding SignedData (WIN_CERTIFICATE payload). Never throws. */
export function parseAuthenticode(der: Buffer): SignatureInfo {
  const fail = (msg: string): SignatureInfo => ({ present: true, signer: null, certificates: [], timestamped: false, parse_error: msg });
  try {
    const content = tlv(der, 0, der.length);
    if (!content || content.tag !== 0x30) return fail('not a DER sequence');
    const ci = children(der, content);
    const explicit = ci[1];
    if (!explicit || explicit.tag !== 0xa0) return fail('no SignedData content');
    const sd = children(der, explicit)[0];
    if (!sd || sd.tag !== 0x30) return fail('malformed SignedData');
    const parts = children(der, sd);
    const certs: CertInfo[] = [];
    const certSet = parts.find((p) => p.tag === 0xa0);
    if (certSet) {
      for (const c of children(der, certSet).slice(0, 64)) {
        if (c.tag !== 0x30) continue;
        try { certs.push(certInfo(new X509Certificate(der.subarray(c.pos, c.end)))); } catch { /* skip non-X.509 entries */ }
      }
    }
    const signerInfos = [...parts].reverse().find((p) => p.tag === 0x31);
    let signerSerial: string | null = null;
    let timestamped = false;
    const si = signerInfos ? children(der, signerInfos)[0] : undefined;
    if (si && si.tag === 0x30) {
      const fields = children(der, si);
      const sid = fields[1];
      if (sid && sid.tag === 0x30) {
        const serial = children(der, sid)[1];
        if (serial && serial.tag === 0x02) signerSerial = der.subarray(serial.start, serial.end).toString('hex').toUpperCase().replace(/^0+(?=.)/, '');
      }
      const unsigned = fields.find((f) => f.tag === 0xa1);
      if (unsigned) {
        const region = der.subarray(unsigned.start, unsigned.end);
        timestamped = region.includes(OID_COUNTERSIGNATURE) || region.includes(OID_MS_RFC3161);
      }
    }
    const issuers = new Set(certs.map((c) => c.issuer));
    const signer = (signerSerial ? certs.find((c) => c.serial === signerSerial) : undefined)
      ?? certs.find((c) => !certs.some((o) => o !== c && o.issuer === c.subject))
      ?? certs.find((c) => !issuers.has(c.subject))
      ?? certs[0]
      ?? null;
    return { present: true, signer, certificates: certs, timestamped };
  } catch (e) {
    return fail((e as Error).message);
  }
}
