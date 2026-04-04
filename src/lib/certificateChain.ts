// Copyright 2021-2024 Adobe, Copyright 2025 The C2PA Contributors

import { X509Certificate } from '@peculiar/x509';

export interface EmbeddedCertificate {
  certificate: X509Certificate;
  derBytes: Uint8Array;
  subject: string;
  issuer: string;
  organizationalUnits: string[];
  commonName: string | null;
  isSelfSigned: boolean;
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readDerLength(
  bytes: Uint8Array,
  offset: number,
): { headerLength: number; contentLength: number } | null {
  const first = bytes[offset];

  if (first === undefined) {
    return null;
  }

  if ((first & 0x80) === 0) {
    return {
      headerLength: 1,
      contentLength: first,
    };
  }

  const octetCount = first & 0x7f;

  if (octetCount === 0 || octetCount > 4) {
    return null;
  }

  if (offset + octetCount >= bytes.length) {
    return null;
  }

  let contentLength = 0;

  for (let idx = 0; idx < octetCount; idx++) {
    contentLength = (contentLength << 8) | bytes[offset + 1 + idx];
  }

  return {
    headerLength: 1 + octetCount,
    contentLength,
  };
}

function splitDistinguishedName(name: string): string[] {
  const parts: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of name) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current.trim());
  }

  return parts;
}

function getDistinguishedNameValues(name: string, key: string): string[] {
  return splitDistinguishedName(name)
    .map((part) => {
      const separatorIdx = part.indexOf('=');

      if (separatorIdx < 0) {
        return null;
      }

      const partKey = part.slice(0, separatorIdx).trim();
      const partValue = part.slice(separatorIdx + 1).trim();

      if (partKey !== key) {
        return null;
      }

      return partValue.replace(/\\,/g, ',').replace(/\\\\/g, '\\');
    })
    .filter((value): value is string => !!value);
}

function isLikelyX509Certificate(
  bytes: Uint8Array,
  start: number,
): { end: number } | null {
  if (bytes[start] !== 0x30) {
    return null;
  }

  const outerLength = readDerLength(bytes, start + 1);

  if (!outerLength) {
    return null;
  }

  const outerHeaderLength = 1 + outerLength.headerLength;
  const end = start + outerHeaderLength + outerLength.contentLength;

  if (end > bytes.length) {
    return null;
  }

  // X.509 certs start with an outer SEQUENCE containing a TBSCertificate SEQUENCE.
  if (bytes[start + outerHeaderLength] !== 0x30) {
    return null;
  }

  return { end };
}

function isTimestampLike(cert: EmbeddedCertificate): boolean {
  return [cert.subject, cert.issuer, cert.commonName ?? ''].some((value) =>
    /timestamp/i.test(value),
  );
}

export function extractEmbeddedCertificates(
  input: ArrayBuffer | Uint8Array,
): EmbeddedCertificate[] {
  const bytes = toUint8Array(input);
  const certs: EmbeddedCertificate[] = [];
  const seen = new Set<string>();

  for (let idx = 0; idx < bytes.length; idx++) {
    const candidate = isLikelyX509Certificate(bytes, idx);

    if (!candidate) {
      continue;
    }

    const derBytes = bytes.slice(idx, candidate.end);
    const fingerprint = toHex(derBytes);

    if (seen.has(fingerprint)) {
      idx = candidate.end - 1;
      continue;
    }

    try {
      const certificate = new X509Certificate(derBytes);
      const subject = certificate.subject;
      const issuer = certificate.issuer;

      certs.push({
        certificate,
        derBytes,
        subject,
        issuer,
        organizationalUnits: getDistinguishedNameValues(subject, 'OU'),
        commonName: getDistinguishedNameValues(subject, 'CN')[0] ?? null,
        isSelfSigned: subject === issuer,
      });

      seen.add(fingerprint);
      idx = candidate.end - 1;
    } catch {
      // Some DER sequences in the file are not certificates.
    }
  }

  return certs;
}

export function extractEmbeddedCertificateChains(
  input: ArrayBuffer | Uint8Array,
): EmbeddedCertificate[][] {
  const certs = extractEmbeddedCertificates(input);
  const parents = new Map<EmbeddedCertificate, EmbeddedCertificate | null>();

  certs.forEach((cert) => {
    const parent =
      certs.find(
        (candidate) => candidate !== cert && candidate.subject === cert.issuer,
      ) ?? null;
    parents.set(cert, parent);
  });

  const leaves = certs.filter(
    (cert) =>
      !certs.some(
        (candidate) => candidate !== cert && candidate.issuer === cert.subject,
      ),
  );
  const chainStarts = leaves.length > 0 ? leaves : certs;
  const seenChains = new Set<string>();

  return chainStarts
    .map((leaf) => {
      const chain: EmbeddedCertificate[] = [];
      const visited = new Set<EmbeddedCertificate>();
      let current: EmbeddedCertificate | null = leaf;

      while (current && !visited.has(current)) {
        chain.push(current);
        visited.add(current);

        const parent: EmbeddedCertificate | null = parents.get(current) ?? null;

        if (!parent || parent === current) {
          break;
        }

        current = parent;
      }

      return chain;
    })
    .filter((chain) => {
      const key = chain.map((cert) => cert.subject).join(' -> ');

      if (seenChains.has(key)) {
        return false;
      }

      seenChains.add(key);

      return true;
    });
}

export function selectSigningCertificateChain(
  input: ArrayBuffer | Uint8Array,
): EmbeddedCertificate[] | null {
  const chains = extractEmbeddedCertificateChains(input);

  if (chains.length === 0) {
    return null;
  }

  return [...chains].sort((left, right) => {
    const leftScore =
      (left.at(-1)?.isSelfSigned ? 100 : 0) +
      (!isTimestampLike(left[0]) ? 50 : -50) +
      ((left.at(-1)?.organizationalUnits.length ?? 0) > 0 ? 10 : 0);
    const rightScore =
      (right.at(-1)?.isSelfSigned ? 100 : 0) +
      (!isTimestampLike(right[0]) ? 50 : -50) +
      ((right.at(-1)?.organizationalUnits.length ?? 0) > 0 ? 10 : 0);

    return rightScore - leftScore;
  })[0];
}

export function extractRootCertificateOrganizationalUnit(
  input: ArrayBuffer | Uint8Array,
): string | null {
  const chain = selectSigningCertificateChain(input);
  const root = chain?.at(-1);

  return root?.organizationalUnits[0] ?? null;
}
