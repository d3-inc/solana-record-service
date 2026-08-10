import {
  lamports,
  publicKey,
  type MaybeRpcAccount,
  type PublicKey,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { assert } from 'chai';

import { getRecordAccountDataSerializer } from '../../src/generated/accounts/record';
import { SrsRecordDecodeError } from '../../src/resolution/errors';
import { serializeWalletMappings, type WalletMapping } from '../../src/resolution/resolve';
import {
  deserializeNameMapping,
  reverseResolve,
  reverseResolveBatch,
  serializeNameMapping,
  type NameMapping,
  type ReverseResolveOptions,
  type ReverseResolveResult,
} from '../../src/resolution/reverseResolve';

const CLASS_ADDRESS = publicKey('11111111111111111111111111111111');
const WALLET = publicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// ASCII "mappings" — shared SrsRecordData discriminator
const DISCRIMINATOR = new Uint8Array([0x6d, 0x61, 0x70, 0x70, 0x69, 0x6e, 0x67, 0x73]);

describe('serializeNameMapping', () => {
  it('encodes sld and tld as an SrsMapping with type 2', () => {
    const bytes = serializeNameMapping({ sld: 'alice', tld: 'com' });
    // disc(8) + count(4) + type(1) + data_len(4) + sld_len(4)+"alice"(5) + tld_len(4)+"com"(3) = 33
    assert.equal(bytes.length, 33);

    assert.deepEqual(bytes.slice(0, 8), DISCRIMINATOR);
    const count = new DataView(bytes.buffer, bytes.byteOffset + 8).getUint32(0, true);
    assert.equal(count, 1);
    assert.equal(bytes[12], 2); // NAME_MAPPING_TYPE

    const sldLen = new DataView(bytes.buffer, bytes.byteOffset + 17).getUint32(0, true);
    assert.equal(sldLen, 5);
    assert.equal(new TextDecoder().decode(bytes.slice(21, 21 + sldLen)), 'alice');

    const tldLen = new DataView(bytes.buffer, bytes.byteOffset + 26).getUint32(0, true);
    assert.equal(tldLen, 3);
    assert.equal(new TextDecoder().decode(bytes.slice(30, 30 + tldLen)), 'com');
  });
});

describe('deserializeNameMapping', () => {
  it('round-trips a record', () => {
    const original: NameMapping = { sld: 'example', tld: 'com' };
    assert.deepEqual(deserializeNameMapping(serializeNameMapping(original)), original);
  });

  it('throws SrsRecordDecodeError when data is empty', () => {
    assert.throws(() => deserializeNameMapping(new Uint8Array(0)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError when data is shorter than 12 bytes', () => {
    assert.throws(() => deserializeNameMapping(new Uint8Array(11)), SrsRecordDecodeError);
  });

  it('throws SrsRecordDecodeError for a wrong discriminator', () => {
    const bytes = serializeNameMapping({ sld: 'example', tld: 'com' });
    bytes[0] = 0x00;
    assert.throws(() => deserializeNameMapping(bytes), SrsRecordDecodeError);
  });

  it('returns null when no name mapping is present', () => {
    // Valid SrsRecordData container but contains no type-2 (name) mapping
    const noNameMapping = serializeWalletMappings([]);
    assert.isNull(deserializeNameMapping(noNameMapping));
  });
});

describe('reverseResolve', () => {
  // Options to skip the forward-resolution verification step
  const NO_VERIFY: ReverseResolveOptions = {
    verifyReverseWithForward: false,
    forwardClassAddress: undefined,
  };

  it('returns null when the account does not exist', async () => {
    const ctx = makeMockContext([null]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, NO_VERIFY);
    assert.isNull(result);
  });

  it('returns the normalized name when verification is skipped', async () => {
    const ctx = makeMockContext([makeReverseRecordAccount({ sld: 'example', tld: 'com' })]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, NO_VERIFY);
    assert.equal(result, 'example.com');
  });

  it('normalizes uppercase sld and tld', async () => {
    const ctx = makeMockContext([makeReverseRecordAccount({ sld: 'Example', tld: 'COM' })]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, NO_VERIFY);
    assert.equal(result, 'example.com');
  });

  it('returns the name when forward resolution matches the wallet', async () => {
    const ctx = makeMockContext([
      makeReverseRecordAccount({ sld: 'example', tld: 'com' }),
      makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: WALLET }]),
    ]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.equal(result, 'example.com');
  });

  it('returns null when forward resolution returns a different address', async () => {
    const ctx = makeMockContext([
      makeReverseRecordAccount({ sld: 'example', tld: 'com' }),
      makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: CLASS_ADDRESS }]),
    ]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.isNull(result);
  });

  it('returns null when forward record has no solana:_ mapping', async () => {
    const ctx = makeMockContext([
      makeReverseRecordAccount({ sld: 'example', tld: 'com' }),
      makeForwardRecordAccount([{ chainCaip2: 'eip155:1', address: '0xdeadbeef' }]),
    ]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.isNull(result);
  });

  it('returns null when the forward record does not exist', async () => {
    const ctx = makeMockContext([
      makeReverseRecordAccount({ sld: 'example', tld: 'com' }),
      null, // forward account missing
    ]);
    const result = await reverseResolve(ctx, WALLET, CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.isNull(result);
  });

  // Returns a context whose rpc.getAccount dequeues from `accounts` on each call.
  function makeMockContext(accounts: (MaybeRpcAccount | null)[]) {
    const umi = createUmi('http://test.local');
    let i = 0;
    return {
      programs: umi.programs,
      eddsa: umi.eddsa,
      rpc: {
        ...umi.rpc,
        getAccount: async (pk: PublicKey): Promise<MaybeRpcAccount> =>
          accounts[i++] ?? { publicKey: pk, exists: false },
      },
    };
  }
});

describe('reverseResolveBatch', () => {
  const WALLET2 = publicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bRS');

  const NO_VERIFY: ReverseResolveOptions = {
    verifyReverseWithForward: false,
    forwardClassAddress: undefined,
  };

  function ok(value: string | null): ReverseResolveResult {
    return { ok: true, value };
  }

  it('returns an empty object for an empty wallets array', async () => {
    const ctx = makeBatchContext([]);
    const result = await reverseResolveBatch(ctx, [], CLASS_ADDRESS, NO_VERIFY);
    assert.deepEqual(result, {});
  });

  it('all wallets present with null value when no reverse records exist', async () => {
    const ctx = makeBatchContext([[null]]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, NO_VERIFY);
    assert.deepEqual(result, { [WALLET]: ok(null) });
  });

  it('resolves a single wallet when verification is skipped', async () => {
    const ctx = makeBatchContext([[makeReverseRecordAccount({ sld: 'example', tld: 'com' })]]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, NO_VERIFY);
    assert.deepEqual(result, { [WALLET]: ok('example.com') });
  });

  it('all wallets present: resolved one has name, missing one has null', async () => {
    const ctx = makeBatchContext([
      [makeReverseRecordAccount({ sld: 'example', tld: 'com' }), null],
    ]);
    const result = await reverseResolveBatch(ctx, [WALLET, WALLET2], CLASS_ADDRESS, NO_VERIFY);
    assert.deepEqual(result, {
      [WALLET]: ok('example.com'),
      [WALLET2]: ok(null),
    });
  });

  it('returns per-wallet error for a malformed reverse record', async () => {
    const ctx = makeBatchContext([[makeMalformedRecordAccount()]]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, NO_VERIFY);
    assert.equal(result[WALLET].ok, false);
    if (!result[WALLET].ok) {
      assert.instanceOf(result[WALLET].error, SrsRecordDecodeError);
    }
  });

  it('returns verified results when forward resolution matches the wallet', async () => {
    const ctx = makeBatchContext([
      [makeReverseRecordAccount({ sld: 'example', tld: 'com' })],
      [makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: WALLET }])],
    ]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.deepEqual(result, { [WALLET]: ok('example.com') });
  });

  it('verifies multiple wallets with a single forward RPC call', async () => {
    const ctx = makeBatchContext([
      [
        makeReverseRecordAccount({ sld: 'alice', tld: 'com' }),
        makeReverseRecordAccount({ sld: 'bob', tld: 'com' }),
      ],
      [
        makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: WALLET }]),
        makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: WALLET2 }]),
      ],
    ]);
    const result = await reverseResolveBatch(ctx, [WALLET, WALLET2], CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.deepEqual(result, {
      [WALLET]: ok('alice.com'),
      [WALLET2]: ok('bob.com'),
    });
  });

  it('returns null for wallet when forward resolution returns a different address', async () => {
    const ctx = makeBatchContext([
      [makeReverseRecordAccount({ sld: 'example', tld: 'com' })],
      [makeForwardRecordAccount([{ chainCaip2: 'solana:_', address: CLASS_ADDRESS }])],
    ]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.deepEqual(result, { [WALLET]: ok(null) });
  });

  it('returns null for wallet when the forward record does not exist', async () => {
    const ctx = makeBatchContext([
      [makeReverseRecordAccount({ sld: 'example', tld: 'com' })],
      [null],
    ]);
    const result = await reverseResolveBatch(ctx, [WALLET], CLASS_ADDRESS, {
      verifyReverseWithForward: true,
      forwardClassAddress: CLASS_ADDRESS,
    });
    assert.deepEqual(result, { [WALLET]: ok(null) });
  });

  // The mock dequeues one batch per getAccounts call; publicKey is overridden with the
  // actual requested PDA so the map lookup inside reverseResolveBatch finds the right record.
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
  return makeAccountData(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
}

function makeReverseRecordAccount(mapping: NameMapping): MaybeRpcAccount {
  return makeAccountData(serializeNameMapping(mapping));
}

function makeForwardRecordAccount(mappings: WalletMapping[]): MaybeRpcAccount {
  return makeAccountData(serializeWalletMappings(mappings));
}

function makeAccountData(innerData: Uint8Array): MaybeRpcAccount {
  const data = getRecordAccountDataSerializer().serialize({
    class: CLASS_ADDRESS,
    owner: CLASS_ADDRESS,
    isFrozen: false,
    expiry: 0n,
    seed: new Uint8Array(0),
    data: innerData,
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
