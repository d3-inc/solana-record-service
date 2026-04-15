import { isPublicKey, publicKey, type Program } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { assert } from 'chai';

import {
  ResolutionInvalidCAIP2Error,
  ResolutionInvalidNameError,
  SrsRecordDecodeError,
} from '../../src/resolution/errors';
import {
  NAME_MAPPING_TYPE,
  WALLET_MAPPING_TYPE,
  deserializeSrsMappings,
  findRecordPda,
  namehash,
  normalizeName,
  serializeSrsMappings,
  validateAndNormalizeCAIP2,
  type SrsMapping,
} from '../../src/resolution/shared';

describe('validateAndNormalizeCAIP2', () => {
  it('accepts a valid CAIP-2 and returns it unchanged', () => {
    assert.equal(validateAndNormalizeCAIP2('solana:_'), 'solana:_');
  });

  it('accepts a CAIP-2 with a long reference', () => {
    assert.equal(
      validateAndNormalizeCAIP2('bip122:000000000019d6689c085ae165831e93'),
      'bip122:000000000019d6689c085ae165831e93',
    );
  });

  it('trims surrounding whitespace before validation', () => {
    assert.equal(validateAndNormalizeCAIP2('  solana:_  '), 'solana:_');
  });

  it('throws ResolutionInvalidCAIP2Error for uppercase namespace', () => {
    assert.throws(() => validateAndNormalizeCAIP2('SOLANA:_'), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error when namespace is too short', () => {
    assert.throws(() => validateAndNormalizeCAIP2('ab:_'), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error when namespace is too long', () => {
    assert.throws(() => validateAndNormalizeCAIP2('toolongname:_'), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error when reference is empty', () => {
    assert.throws(() => validateAndNormalizeCAIP2('solana:'), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error when reference contains a space', () => {
    assert.throws(() => validateAndNormalizeCAIP2('solana:a b'), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error for an empty string', () => {
    assert.throws(() => validateAndNormalizeCAIP2(''), ResolutionInvalidCAIP2Error);
  });

  it('throws ResolutionInvalidCAIP2Error when the colon separator is missing', () => {
    assert.throws(() => validateAndNormalizeCAIP2('solana'), ResolutionInvalidCAIP2Error);
  });
});

describe('normalizeName', () => {
  it('returns a plain ASCII name unchanged', () => {
    assert.equal(normalizeName('example.com'), 'example.com');
  });

  it('trims leading and trailing whitespace', () => {
    assert.equal(normalizeName('  example.com  '), 'example.com');
  });

  it('lowercases ASCII labels', () => {
    assert.equal(normalizeName('EXAMPLE.COM'), 'example.com');
  });

  it('converts unicode labels to punycode (IDN)', () => {
    assert.equal(normalizeName('münchen.de'), 'xn--mnchen-3ya.de');
  });

  it('throws ResolutionInvalidNameError for an empty string', () => {
    assert.throws(() => normalizeName(''), ResolutionInvalidNameError);
  });

  it('throws ResolutionInvalidNameError for a whitespace-only string', () => {
    assert.throws(() => normalizeName('   '), ResolutionInvalidNameError);
  });

  it('throws ResolutionInvalidNameError for a label starting with a hyphen', () => {
    assert.throws(() => normalizeName('-invalid.com'), ResolutionInvalidNameError);
  });

  it('throws ResolutionInvalidNameError for a label ending with a hyphen', () => {
    assert.throws(() => normalizeName('invalid-.com'), ResolutionInvalidNameError);
  });

  it('throws ResolutionInvalidNameError for an empty label', () => {
    assert.throws(() => normalizeName('invalid..com'), ResolutionInvalidNameError);
  });
});

describe('namehash', () => {
  it('produces correct namehash', () => {
    const hash = namehash('example.com');
    assert.deepEqual(
      Buffer.from(hash).toString('hex'),
      'f59ba973941fd531b0702df2592a8480fd9f28516c50a93626e652a8ce263832',
    );
  });

  it('throws ResolutionInvalidNameError for an empty string', () => {
    assert.throws(() => namehash(''), ResolutionInvalidNameError);
  });

  it('throws ResolutionInvalidNameError for an invalid name', () => {
    assert.throws(() => namehash('-bad.com'), ResolutionInvalidNameError);
  });
});

describe('findRecordPda', () => {
  const ctx = createUmi({ rpcEndpoint: 'http://test.local' } as any);
  const classAddress = publicKey('11111111111111111111111111111111');
  const recordSeed = new Uint8Array([1, 2, 3]);

  it('returns a valid public key and a bump', () => {
    const [pda, bump] = findRecordPda(ctx, classAddress, recordSeed);
    assert.isTrue(isPublicKey(pda));
    assert.equal(pda, '89QVDWCjTvG1LtV45QNZSDfcwrYBps72ozw9VuLyAWjs');
    assert.equal(bump, 255);
  });

  it('is deterministic for the same inputs', () => {
    const [pda1, bump1] = findRecordPda(ctx, classAddress, recordSeed);
    const [pda2, bump2] = findRecordPda(ctx, classAddress, recordSeed);
    assert.equal(pda1, pda2);
    assert.equal(bump1, bump2);
  });

  it('produces a different PDA for a different class address', () => {
    const otherClass = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const [pda1] = findRecordPda(ctx, classAddress, recordSeed);
    const [pda2] = findRecordPda(ctx, otherClass, recordSeed);
    assert.notEqual(pda1, pda2);
  });

  it('produces a different PDA for a different record seed', () => {
    const otherSeed = new Uint8Array([4, 5, 6]);
    const [pda1] = findRecordPda(ctx, classAddress, recordSeed);
    const [pda2] = findRecordPda(ctx, classAddress, otherSeed);
    assert.notEqual(pda1, pda2);
  });

  it('uses the program ID registered in the context', () => {
    const altCtx = createUmi('http://test.local');
    const altProgramId = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const fakeProgram: Program = {
      name: 'solanaRecordService',
      publicKey: altProgramId,
      getErrorFromCode: () => null,
      getErrorFromName: () => null,
      isOnCluster: () => true,
    };
    altCtx.programs.add(fakeProgram);

    const [pda1] = findRecordPda(ctx, classAddress, recordSeed);
    const [pda2] = findRecordPda(altCtx, classAddress, recordSeed);
    assert.notEqual(pda1, pda2);
  });
});

// ASCII "mappings" — the shared SrsRecordData discriminator
const SRS_DISCRIMINATOR = new Uint8Array([0x6d, 0x61, 0x70, 0x70, 0x69, 0x6e, 0x67, 0x73]);

describe('serializeSrsMappings', () => {
  it('starts with the "mappings" discriminator and a u32 count', () => {
    const bytes = serializeSrsMappings([]);
    assert.equal(bytes.length, 12); // 8 discriminator + 4 count
    assert.deepEqual(bytes.slice(0, 8), SRS_DISCRIMINATOR);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 0);
  });

  it('encodes each SrsMapping as type(u8) + data_len(u32) + data', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const bytes = serializeSrsMappings([{ mappingType: WALLET_MAPPING_TYPE, data: payload }]);
    // 8(disc) + 4(count=1) + 1(type) + 4(len=3) + 3(data) = 20
    assert.equal(bytes.length, 20);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 1);
    assert.equal(bytes[12], WALLET_MAPPING_TYPE);
    const dataLen = new DataView(bytes.buffer, bytes.byteOffset + 13).getUint32(0, true);
    assert.equal(dataLen, 3);
    assert.deepEqual(bytes.slice(17, 20), payload);
  });

  it('encodes multiple mappings preserving type and data', () => {
    const mappings: SrsMapping[] = [
      { mappingType: WALLET_MAPPING_TYPE, data: new Uint8Array([0xaa]) },
      { mappingType: NAME_MAPPING_TYPE, data: new Uint8Array([0xbb, 0xcc]) },
    ];
    const bytes = serializeSrsMappings(mappings);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 2);
  });

  it('constants WALLET_MAPPING_TYPE and NAME_MAPPING_TYPE are 1 and 2', () => {
    assert.equal(WALLET_MAPPING_TYPE, 1);
    assert.equal(NAME_MAPPING_TYPE, 2);
  });
});

describe('deserializeSrsMappings', () => {
  it('round-trips an empty mapping list', () => {
    assert.deepEqual(deserializeSrsMappings(serializeSrsMappings([])), []);
  });

  it('round-trips a single mapping', () => {
    const mappings: SrsMapping[] = [
      { mappingType: WALLET_MAPPING_TYPE, data: new Uint8Array([0x01, 0x02]) },
    ];
    const result = deserializeSrsMappings(serializeSrsMappings(mappings));
    assert.equal(result.length, 1);
    assert.equal(result[0].mappingType, WALLET_MAPPING_TYPE);
    assert.deepEqual(result[0].data, new Uint8Array([0x01, 0x02]));
  });

  it('round-trips multiple mappings preserving order and types', () => {
    const mappings: SrsMapping[] = [
      { mappingType: WALLET_MAPPING_TYPE, data: new Uint8Array([0xaa]) },
      { mappingType: NAME_MAPPING_TYPE, data: new Uint8Array([0xbb, 0xcc]) },
    ];
    const result = deserializeSrsMappings(serializeSrsMappings(mappings));
    assert.equal(result.length, 2);
    assert.equal(result[0].mappingType, WALLET_MAPPING_TYPE);
    assert.equal(result[1].mappingType, NAME_MAPPING_TYPE);
    assert.deepEqual(result[0].data, new Uint8Array([0xaa]));
    assert.deepEqual(result[1].data, new Uint8Array([0xbb, 0xcc]));
  });

  it('throws SrsRecordDecodeError when data is empty', () => {
    assert.throws(() => deserializeSrsMappings(new Uint8Array(0)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError when data is shorter than 12 bytes', () => {
    assert.throws(() => deserializeSrsMappings(new Uint8Array(11)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError for a wrong discriminator', () => {
    const bytes = serializeSrsMappings([]);
    bytes[0] = 0x00;
    assert.throws(() => deserializeSrsMappings(bytes), SrsRecordDecodeError);
  });
});
