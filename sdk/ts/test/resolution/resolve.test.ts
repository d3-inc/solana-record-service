import {
  lamports,
  publicKey,
  type MaybeRpcAccount,
  type PublicKey,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { AssertionError, assert } from 'chai';

import { getRecordAccountDataSerializer } from '../../src/generated/accounts/record';
import {
  ResolutionInvalidCAIP2Error,
  ResolutionInvalidNameError,
  SrsRecordDecodeError,
} from '../../src/resolution/errors';
import {
  DEFAULT_SOLANA_CAIP2,
  deserializeWalletMappings,
  findNameRecordPDA,
  resolve,
  resolveBatch,
  serializeWalletMappings,
  type WalletMapping,
} from '../../src/resolution/resolve';
import type { NameToNameId } from '../../src/resolution/shared';

// Deterministic stand-in for `namehash` used to prove a custom `nameToNameId` is honored:
// truncates/pads the name's UTF-8 bytes into a 32-byte seed instead of hashing it.
const stubNameToNameId: NameToNameId = (name) => {
  const seed = new Uint8Array(32);
  seed.set(new TextEncoder().encode(name).slice(0, 32));
  return seed;
};

const CLASS_ADDRESS = publicKey('11111111111111111111111111111111');

// ASCII "mappings" — shared SrsRecordData discriminator
const DISCRIMINATOR = new Uint8Array([0x6d, 0x61, 0x70, 0x70, 0x69, 0x6e, 0x67, 0x73]);

describe('serializeWalletMappings', () => {
  it('starts with the "mappings" discriminator and u32 SrsMapping count', () => {
    const bytes = serializeWalletMappings([]);
    // discriminator(8) + count(4) = 12 bytes, count = 0
    assert.equal(bytes.length, 12);
    assert.deepEqual(bytes.slice(0, 8), DISCRIMINATOR);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 0);
  });

  it('encodes a single mapping as an SrsMapping with type 1', () => {
    const bytes = serializeWalletMappings([{ chainCaip2: 'solana:_', address: 'abc' }]);
    // disc(8) + count(4) + type(1) + data_len(4) + caip2_len(4)+"solana:_"(8) + addr_len(4)+"abc"(3) = 36
    assert.equal(bytes.length, 36);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 1);
    assert.equal(bytes[12], 1); // WALLET_MAPPING_TYPE

    const caip2Len = new DataView(bytes.buffer, bytes.byteOffset + 17).getUint32(0, true);
    assert.equal(caip2Len, 8);
    assert.equal(new TextDecoder().decode(bytes.slice(21, 21 + caip2Len)), 'solana:_');

    const addrLen = new DataView(bytes.buffer, bytes.byteOffset + 29).getUint32(0, true);
    assert.equal(addrLen, 3);
    assert.equal(new TextDecoder().decode(bytes.slice(33, 33 + addrLen)), 'abc');
  });

  it('encodes multiple mappings', () => {
    const mappings: WalletMapping[] = [
      { chainCaip2: 'solana:_', address: 'addr1' },
      { chainCaip2: 'eip155:1', address: 'addr2' },
    ];
    const bytes = serializeWalletMappings(mappings);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 2);
  });
});

describe('deserializeWalletMappings', () => {
  it('round-trips an empty list', () => {
    const original: WalletMapping[] = [];
    assert.deepEqual(deserializeWalletMappings(serializeWalletMappings(original)), original);
  });

  it('round-trips a single mapping', () => {
    const original: WalletMapping[] = [
      { chainCaip2: 'solana:_', address: 'So11111111111111111111111111111111111111112' },
    ];
    assert.deepEqual(deserializeWalletMappings(serializeWalletMappings(original)), original);
  });

  it('round-trips multiple mappings preserving order', () => {
    const original: WalletMapping[] = [
      { chainCaip2: 'solana:_', address: 'addr-sol' },
      { chainCaip2: 'eip155:1', address: '0xdeadbeef' },
      { chainCaip2: 'bip122:_', address: 'bc1qxyz' },
    ];
    assert.deepEqual(deserializeWalletMappings(serializeWalletMappings(original)), original);
  });

  it('throws SrsRecordDecodeError when data is empty', () => {
    assert.throws(() => deserializeWalletMappings(new Uint8Array(0)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError when data is shorter than 12 bytes', () => {
    assert.throws(() => deserializeWalletMappings(new Uint8Array(11)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError for a wrong discriminator', () => {
    const bytes = serializeWalletMappings([]);
    bytes[0] = 0x00;
    assert.throws(() => deserializeWalletMappings(bytes), SrsRecordDecodeError);
  });
});

describe('findNameRecordPDA', () => {
  const ctx = createUmi('http://test.local');
  const classAddress = publicKey('11111111111111111111111111111111');

  it('returns a valid public key', () => {
    const pda = findNameRecordPDA(ctx, 'example.com', classAddress);
    assert.equal(pda, '8E1gwbcWbejdmjqZ8MFUpMA5mfnWLcaXWxGMPoDzBtP2');
  });

  it('is deterministic for the same name and class address', () => {
    const pda1 = findNameRecordPDA(ctx, 'example.com', classAddress);
    const pda2 = findNameRecordPDA(ctx, 'example.com', classAddress);
    assert.equal(pda1, pda2);
  });

  it('produces a different PDA for a different name', () => {
    const pda1 = findNameRecordPDA(ctx, 'example.com', classAddress);
    const pda2 = findNameRecordPDA(ctx, 'bob.sol', classAddress);
    assert.notEqual(pda1, pda2);
  });

  it('produces a different PDA for a different class address', () => {
    const otherClass = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const pda1 = findNameRecordPDA(ctx, 'example.com', classAddress);
    const pda2 = findNameRecordPDA(ctx, 'example.com', otherClass);
    assert.notEqual(pda1, pda2);
  });

  it('normalizes the name before hashing (case-insensitive)', () => {
    const pda1 = findNameRecordPDA(ctx, 'Example.COM', classAddress);
    const pda2 = findNameRecordPDA(ctx, 'example.com', classAddress);
    assert.equal(pda1, pda2);
  });

  it('normalizes the name before hashing (trims whitespace)', () => {
    const pda1 = findNameRecordPDA(ctx, '  example.com  ', classAddress);
    const pda2 = findNameRecordPDA(ctx, 'example.com', classAddress);
    assert.equal(pda1, pda2);
  });

  it('throws ResolutionInvalidNameError for an invalid name', () => {
    assert.throws(
      () => findNameRecordPDA(ctx, '-bad.com', classAddress),
      ResolutionInvalidNameError,
    );
  });

  it('uses a custom nameToNameId override to derive a different PDA', () => {
    const defaultPda = findNameRecordPDA(ctx, 'example.com', classAddress);
    const customPda = findNameRecordPDA(ctx, 'example.com', classAddress, stubNameToNameId);
    assert.notEqual(customPda, defaultPda);
  });

  it('is deterministic for the same custom nameToNameId', () => {
    const pda1 = findNameRecordPDA(ctx, 'example.com', classAddress, stubNameToNameId);
    const pda2 = findNameRecordPDA(ctx, 'example.com', classAddress, stubNameToNameId);
    assert.equal(pda1, pda2);
  });
});

describe('resolve', () => {
  it('returns null when the account does not exist', async () => {
    const ctx = makeMockContext(null);
    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS);
    assert.isNull(result);
  });

  it('returns null when the record has no mappings', async () => {
    const ctx = makeMockContext(makeRecordAccount([]));
    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS);
    assert.isNull(result);
  });

  it('returns the address for the default solana:_ chain', async () => {
    const mappings: WalletMapping[] = [{ chainCaip2: 'solana:_', address: 'SolAddr1' }];
    const ctx = makeMockContext(makeRecordAccount(mappings));
    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS);
    assert.equal(result, 'SolAddr1');
  });

  it('uses DEFAULT_SOLANA_CAIP2 when chainCaip2 option is not provided', async () => {
    assert.equal(DEFAULT_SOLANA_CAIP2, 'solana:_');
    const mappings: WalletMapping[] = [{ chainCaip2: DEFAULT_SOLANA_CAIP2, address: 'DefaultSol' }];
    const ctx = makeMockContext(makeRecordAccount(mappings));
    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS);
    assert.equal(result, 'DefaultSol');
  });

  it('returns null when no mapping matches the requested chain', async () => {
    const mappings: WalletMapping[] = [{ chainCaip2: 'solana:_', address: 'SolAddr1' }];
    const ctx = makeMockContext(makeRecordAccount(mappings));
    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS, { chainCaip2: 'eip155:1' });
    assert.isNull(result);
  });

  it('returns the correct address among multiple mappings', async () => {
    const mappings: WalletMapping[] = [
      { chainCaip2: 'solana:_', address: 'SolAddr' },
      { chainCaip2: 'eip155:1', address: '0xEthAddr' },
      { chainCaip2: 'bip122:_', address: 'BtcAddr' },
    ];
    const ctx = makeMockContext(makeRecordAccount(mappings));
    assert.equal(
      await resolve(ctx, 'example.com', CLASS_ADDRESS, { chainCaip2: 'eip155:1' }),
      '0xEthAddr',
    );
    assert.equal(
      await resolve(ctx, 'example.com', CLASS_ADDRESS, { chainCaip2: 'bip122:_' }),
      'BtcAddr',
    );
  });

  it('throws ResolutionInvalidCAIP2Error for an invalid chainCaip2 option', async () => {
    const ctx = makeMockContext(makeRecordAccount([]));
    await assertRejects(
      () => resolve(ctx, 'example.com', CLASS_ADDRESS, { chainCaip2: 'INVALID' }),
      ResolutionInvalidCAIP2Error,
    );
  });

  it('throws ResolutionInvalidNameError for an invalid name', async () => {
    const ctx = makeMockContext(makeRecordAccount([]));
    await assertRejects(() => resolve(ctx, '-bad.com', CLASS_ADDRESS), ResolutionInvalidNameError);
  });

  it('honors a custom nameToNameId override to look up the record', async () => {
    const umi = createUmi('http://test.local');
    const expectedPda = findNameRecordPDA(umi, 'example.com', CLASS_ADDRESS, stubNameToNameId);
    let requestedPk: PublicKey | undefined;
    const ctx = {
      programs: umi.programs,
      eddsa: umi.eddsa,
      rpc: {
        ...umi.rpc,
        getAccount: async (pk: PublicKey): Promise<MaybeRpcAccount> => {
          requestedPk = pk;
          return makeRecordAccount([{ chainCaip2: 'solana:_', address: 'CustomAddr' }]);
        },
      },
    };

    const result = await resolve(ctx, 'example.com', CLASS_ADDRESS, {
      nameToNameId: stubNameToNameId,
    });

    assert.equal(result, 'CustomAddr');
    assert.equal(requestedPk, expectedPda);
  });

  function makeMockContext(account: MaybeRpcAccount | null) {
    const umi = createUmi('http://test.local');
    return {
      programs: umi.programs,
      eddsa: umi.eddsa,
      rpc: {
        ...umi.rpc,
        getAccount: async (pk: PublicKey): Promise<MaybeRpcAccount> =>
          account ?? { publicKey: pk, exists: false },
      },
    };
  }
});

describe('resolveBatch', () => {
  it('returns an empty object for an empty names array', async () => {
    const ctx = makeBatchContext([]);
    const result = await resolveBatch(ctx, [], CLASS_ADDRESS);
    assert.deepEqual(result, {});
  });

  it('all names present with null value when no records exist', async () => {
    const ctx = makeBatchContext([[null, null]]);
    const result = await resolveBatch(ctx, ['example.com', 'bob.sol'], CLASS_ADDRESS);
    assert.deepEqual(result, {
      'example.com': { ok: true, value: null },
      'bob.sol': { ok: true, value: null },
    });
  });

  it('resolves a single name to its wallet address', async () => {
    const ctx = makeBatchContext([
      [makeRecordAccount([{ chainCaip2: 'solana:_', address: 'SolAddr1' }])],
    ]);
    const result = await resolveBatch(ctx, ['example.com'], CLASS_ADDRESS);
    assert.deepEqual(result, { 'example.com': { ok: true, value: 'SolAddr1' } });
  });

  it('returns null for names with no record and the address for names that resolve', async () => {
    const ctx = makeBatchContext([
      [makeRecordAccount([{ chainCaip2: 'solana:_', address: 'SolAddr1' }]), null],
    ]);
    const result = await resolveBatch(ctx, ['example.com', 'missing.sol'], CLASS_ADDRESS);
    assert.deepEqual(result, {
      'example.com': { ok: true, value: 'SolAddr1' },
      'missing.sol': { ok: true, value: null },
    });
  });

  it('returns null for names with no matching chain mapping', async () => {
    const ctx = makeBatchContext([
      [makeRecordAccount([{ chainCaip2: 'eip155:1', address: '0xEthAddr' }])],
    ]);
    const result = await resolveBatch(ctx, ['example.com'], CLASS_ADDRESS);
    assert.deepEqual(result, { 'example.com': { ok: true, value: null } });
  });

  it('resolves multiple names in one RPC call', async () => {
    const ctx = makeBatchContext([
      [
        makeRecordAccount([{ chainCaip2: 'solana:_', address: 'SolAddr1' }]),
        makeRecordAccount([{ chainCaip2: 'solana:_', address: 'SolAddr2' }]),
      ],
    ]);
    const result = await resolveBatch(ctx, ['example.com', 'bob.sol'], CLASS_ADDRESS);
    assert.deepEqual(result, {
      'example.com': { ok: true, value: 'SolAddr1' },
      'bob.sol': { ok: true, value: 'SolAddr2' },
    });
  });

  it('respects the chainCaip2 option', async () => {
    const ctx = makeBatchContext([
      [
        makeRecordAccount([
          { chainCaip2: 'solana:_', address: 'SolAddr' },
          { chainCaip2: 'eip155:1', address: '0xEthAddr' },
        ]),
      ],
    ]);
    const result = await resolveBatch(ctx, ['example.com'], CLASS_ADDRESS, {
      chainCaip2: 'eip155:1',
    });
    assert.deepEqual(result, { 'example.com': { ok: true, value: '0xEthAddr' } });
  });

  it('returns per-name error for an invalid name', async () => {
    const ctx = makeBatchContext([[]]);
    const result = await resolveBatch(ctx, ['-bad.sol', 'valid.com'], CLASS_ADDRESS);
    assert.equal(result['-bad.sol'].ok, false);
    if (!result['-bad.sol'].ok) {
      assert.instanceOf(result['-bad.sol'].error, ResolutionInvalidNameError);
    }
    assert.deepEqual(result['valid.com'], { ok: true, value: null });
  });

  it('returns per-name error for a malformed record', async () => {
    const ctx = makeBatchContext([[makeMalformedRecordAccount()]]);
    const result = await resolveBatch(ctx, ['example.com'], CLASS_ADDRESS);
    assert.equal(result['example.com'].ok, false);
    if (!result['example.com'].ok) {
      assert.instanceOf(result['example.com'].error, SrsRecordDecodeError);
    }
  });

  it('throws ResolutionInvalidCAIP2Error for an invalid chainCaip2 option', async () => {
    const ctx = makeBatchContext([[]]);
    await assertRejects(
      () => resolveBatch(ctx, ['example.com'], CLASS_ADDRESS, { chainCaip2: 'INVALID' }),
      ResolutionInvalidCAIP2Error,
    );
  });

  it('honors a custom nameToNameId override for every name in the batch', async () => {
    const umi = createUmi('http://test.local');
    const names = ['alice.com', 'bob.com'];
    const expectedPdas = names.map((n) => findNameRecordPDA(umi, n, CLASS_ADDRESS, stubNameToNameId));
    let requestedPks: PublicKey[] = [];
    const ctx = {
      programs: umi.programs,
      eddsa: umi.eddsa,
      rpc: {
        ...umi.rpc,
        getAccounts: async (pks: PublicKey[]): Promise<MaybeRpcAccount[]> => {
          requestedPks = pks;
          return pks.map((pk) => ({ publicKey: pk, exists: false }));
        },
      },
    };

    await resolveBatch(ctx, names, CLASS_ADDRESS, { nameToNameId: stubNameToNameId });

    assert.deepEqual(requestedPks, expectedPdas);
  });

  // The mock dequeues one batch per getAccounts call; publicKey is overridden with the
  // actual requested PDA so the map lookup inside resolveBatch finds the right record.
  function makeBatchContext(batches: (MaybeRpcAccount | null)[][]) {
    const umi = createUmi('http://test.local');
    let i = 0;
    return {
      programs: umi.programs,
      eddsa: umi.eddsa,
      rpc: {
        ...umi.rpc,
        getAccounts: async (pks: PublicKey[]): Promise<MaybeRpcAccount[]> => {
          const batch = batches[i++] ?? [];
          return pks.map((pk, j) => {
            const acct = batch[j];
            if (!acct || !acct.exists) return { publicKey: pk, exists: false };
            return { ...acct, publicKey: pk };
          });
        },
      },
    };
  }
});

function makeMalformedRecordAccount(): MaybeRpcAccount {
  const data = getRecordAccountDataSerializer().serialize({
    class: CLASS_ADDRESS,
    owner: CLASS_ADDRESS,
    isFrozen: false,
    expiry: 0n,
    seed: new Uint8Array(0),
    data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  });
  return {
    exists: true,
    publicKey: CLASS_ADDRESS,
    lamports: lamports(1_000_000n),
    executable: false,
    owner: CLASS_ADDRESS,
    data,
  };
}

function makeRecordAccount(mappings: WalletMapping[]): MaybeRpcAccount {
  const data = getRecordAccountDataSerializer().serialize({
    class: CLASS_ADDRESS,
    owner: CLASS_ADDRESS,
    isFrozen: false,
    expiry: 0n,
    seed: new Uint8Array(0),
    data: serializeWalletMappings(mappings),
  });
  return {
    exists: true,
    publicKey: CLASS_ADDRESS,
    lamports: lamports(1_000_000n),
    executable: false,
    owner: CLASS_ADDRESS,
    data,
  };
}

async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: any[]) => Error,
): Promise<void> {
  try {
    await fn();
    assert.fail('Expected an error to be thrown');
  } catch (e) {
    if (e instanceof AssertionError) throw e;
    assert.instanceOf(e, ErrorClass);
  }
}
