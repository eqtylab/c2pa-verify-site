// Copyright 2021-2024 Adobe, Copyright 2025 The C2PA Contributors

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractEmbeddedCertificateChains,
  extractEmbeddedCertificates,
  extractRootCertificateOrganizationalUnit,
  selectSigningCertificateChain,
} from './certificateChain';

const testImagePath = path.resolve(process.cwd(), 'test.jpg');
const testImage2Path = path.resolve(process.cwd(), 'test2.jpg');

describe('lib/certificateChain', () => {
  it('extracts embedded certificates from a signed asset', () => {
    const bytes = fs.readFileSync(testImagePath);
    const certs = extractEmbeddedCertificates(bytes);

    expect(certs).toHaveLength(6);
    expect(
      certs.some((cert) =>
        cert.organizationalUnits.includes('EQTY System Notary'),
      ),
    ).toBe(true);
  });

  it('selects the signing chain instead of the timestamp chain', () => {
    const bytes = fs.readFileSync(testImagePath);
    const chain = selectSigningCertificateChain(bytes);

    expect(chain).not.toBeNull();
    expect(chain?.map((cert) => cert.commonName)).toEqual([
      'example.com',
      'did:key:zDnaey2QkBPHCRfQ8GZtuzpDmn2sYTTKpTk1JCiYz2chxKAH6',
      'did:key:zDnaecQsVD5FhzvuJoAhMhBtVc3fniaUX48J9sSzu11VTgYJk',
    ]);
  });

  it('extracts the root OU from the signing certificate chain', () => {
    const bytes = fs.readFileSync(testImagePath);

    expect(extractRootCertificateOrganizationalUnit(bytes)).toBe(
      'EQTY System Notary',
    );
  });

  it('returns all detected chains', () => {
    const bytes = fs.readFileSync(testImagePath);
    const chains = extractEmbeddedCertificateChains(bytes);

    expect(chains).toHaveLength(2);
    expect(
      chains.map((chain) => chain.length).sort((left, right) => left - right),
    ).toEqual([3, 3]);
  });

  it('extracts partially-decodable intermediate certificates', () => {
    const bytes = fs.readFileSync(testImage2Path);
    const certs = extractEmbeddedCertificates(bytes);
    const chain = selectSigningCertificateChain(bytes);

    expect(certs).toHaveLength(6);
    expect(chain?.map((cert) => cert.commonName)).toEqual([
      'example.com',
      'did:key:zDnaeu6EWDfXXhu4kG6CHVRd4XVdz4Fxn5wCMdyeT9SmcrzDF',
      'did:key:zDnaeaZTza91NcTeKdWdJbVqE9VtKQT7n58jRX6bCZUUDAF3K',
    ]);
  });
});
