import { expect } from 'chai';
import {
  Context,
  PublicKey,
  publicKey,
  publicKeyBytes,
} from '@metaplex-foundation/umi';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  batchReverseResolve,
  DEFAULT_SOLANA_CAIP2,
  findRecordPda,
  namehash,
  parseResolutionTuples,
  resolve,
  resolveRecord,
  resolveRecords,
  reverseResolve,
  reverseRecordSeed,
  serializeResolutionTuples,
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_PROGRAM_ID,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
  type ResolutionContext,
} from '../src/resolution';
import {
  buildSrsRecordAccountData,
  deterministicPublicKey,
} from './helpers';

function createFakePda(programId: PublicKey, seeds: Uint8Array[]): [PublicKey, number] {
  const programBytes = publicKeyBytes(programId);
  let totalSize = 1 + programBytes.length;
  for (const seed of seeds) {
    totalSize += 2 + seed.length;
  }

  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  buffer[offset++] = seeds.length;
  buffer.set(programBytes, offset);
  offset += programBytes.length;

  for (const seed of seeds) {
    buffer[offset++] = seed.length & 0xff;
    buffer[offset++] = (seed.length >> 8) & 0xff;
    buffer.set(seed, offset);
    offset += seed.length;
  }

  const hash = Uint8Array.from(keccak_256(buffer)).subarray(0, 32);
  return [publicKey(hash), 255];
}

type InMemoryResolutionContext = ResolutionContext & Pick<Context, 'eddsa'>;

class InMemoryContext {
  private readonly accounts = new Map<string, Uint8Array>();

  readonly context: InMemoryResolutionContext = {
    rpc: {
      getEndpoint: () => 'in-memory',
      getCluster: () => 'custom' as never,
      getAccount: async (pk: PublicKey) => {
        const data = this.accounts.get(pk);
        if (!data) {
          return { exists: false, publicKey: pk };
        }

        return {
          exists: true,
          publicKey: pk,
          data,
          executable: false,
          owner: deterministicPublicKey(254),
          lamports: { basisPoints: 0n, identifier: 'SOL', decimals: 9 },
          rentEpoch: 0n,
        };
      },
    } as never,
    programs: {
      getPublicKey: (_name: string, fallback?: PublicKey) =>
        fallback ?? SRS_DEFAULT_PROGRAM_ID,
    } as never,
    eddsa: {
      findPda: (programId: PublicKey, seeds: Uint8Array[]) =>
        createFakePda(programId, seeds),
    } as never,
  };

  putRecord(
    recordPda: PublicKey,
    options: {
      classAddress: PublicKey;
      ownerAddress: PublicKey;
      seed: Uint8Array;
      data: Uint8Array;
      ownerType?: number;
      isFrozen?: boolean;
      expiry?: bigint;
    }
  ): void {
    this.accounts.set(recordPda, buildSrsRecordAccountData(options));
  }
}

async function putForwardRecord(
  env: InMemoryContext,
  classAddress: PublicKey,
  name: string,
  tuples: Array<[string, string]>,
  ownerAddress: PublicKey = deterministicPublicKey(200)
): Promise<void> {
  const seed = namehash(name);
  const [recordPda] = findRecordPda(env.context, classAddress, seed);
  env.putRecord(recordPda, {
    classAddress,
    ownerAddress,
    seed,
    data: serializeResolutionTuples(tuples),
  });
}

async function putReverseRecord(
  env: InMemoryContext,
  reverseClassAddress: PublicKey,
  wallet: string,
  tuples: Array<[string, string]>,
  ownerAddress: PublicKey = deterministicPublicKey(201)
): Promise<void> {
  const seed = reverseRecordSeed(wallet);
  const [recordPda] = findRecordPda(env.context, reverseClassAddress, seed);
  env.putRecord(recordPda, {
    classAddress: reverseClassAddress,
    ownerAddress,
    seed,
    data: serializeResolutionTuples(tuples),
  });
}

describe('resolution codec', () => {
  it('serializes and parses tuples', () => {
    const tuples = [
      ['WALLET', `${DEFAULT_SOLANA_CAIP2}:${deterministicPublicKey(88)}`],
      ['NAME', 'alice.sol'],
    ] as const;

    const encoded = serializeResolutionTuples(tuples);
    expect(parseResolutionTuples(encoded)).to.deep.equal(tuples);
  });
});

describe('forward resolution', () => {
  it('resolves chain-aware WALLET tuples with last-write-wins', async () => {
    const env = new InMemoryContext();
    const latestWallet = deterministicPublicKey(33);

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'alice.sol', [
      ['WALLET', `${DEFAULT_SOLANA_CAIP2}:${deterministicPublicKey(34)}`],
      ['WALLET', 'eip155:1:0x123'],
      ['WALLET', `${DEFAULT_SOLANA_CAIP2}:${latestWallet}`],
    ]);

    const resolved = await resolve(env.context, { name: 'alice.sol' });
    expect(resolved).to.equal(latestWallet);
  });

  it('ignores non-WALLET tuple keys', async () => {
    const env = new InMemoryContext();

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'legacy-chain.sol', [
      ['WALLET:solana:mainnet', deterministicPublicKey(50)],
    ]);

    const resolved = await resolve(env.context, { name: 'legacy-chain.sol' });
    expect(resolved).to.equal(null);
  });

  it('does not resolve DID-PKH payload for Solana chain lookup', async () => {
    const env = new InMemoryContext();
    const wallet = deterministicPublicKey(48);

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'did-pkh.sol', [
      ['WALLET', `did:pkh:${DEFAULT_SOLANA_CAIP2}:${wallet}`],
    ]);

    const resolved = await resolve(env.context, {
      name: 'did-pkh.sol',
      chainCaip2: DEFAULT_SOLANA_CAIP2,
    });
    expect(resolved).to.equal(null);
  });

  it('resolves text records by key', async () => {
    const env = new InMemoryContext();

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'records.sol', [
      ['URL', 'https://a.example'],
      ['TWITTER', '@alice'],
      ['URL', 'https://b.example'],
    ]);

    expect(
      await resolveRecord(env.context, { name: 'records.sol', key: 'url' })
    ).to.equal('https://b.example');
    expect(
      await resolveRecords(env.context, { name: 'records.sol', key: 'URL' })
    ).to.deep.equal(['https://a.example', 'https://b.example']);
  });
});

describe('reverse resolution', () => {
  it('verifies reverse -> forward consistency by default', async () => {
    const env = new InMemoryContext();
    const wallet = deterministicPublicKey(70);

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'alice.sol', [
      ['WALLET', wallet],
    ]);
    await putReverseRecord(env, SRS_DEFAULT_REVERSE_CLASS_ADDRESS, wallet, [
      ['NAME', 'ALICE.sol'],
    ]);

    const resolved = await reverseResolve(env.context, { wallet });
    expect(resolved).to.equal('alice.sol');
  });

  it('returns null on forward/reverse mismatch when verification is enabled', async () => {
    const env = new InMemoryContext();
    const wallet = deterministicPublicKey(71);

    await putForwardRecord(env, SRS_DEFAULT_DOMA_CLASS_ADDRESS, 'alice.sol', [
      ['WALLET', deterministicPublicKey(72)],
    ]);
    await putReverseRecord(env, SRS_DEFAULT_REVERSE_CLASS_ADDRESS, wallet, [
      ['NAME', 'alice.sol'],
    ]);

    const resolved = await reverseResolve(env.context, { wallet });
    expect(resolved).to.equal(null);
  });

  it('can skip forward verification when disabled', async () => {
    const env = new InMemoryContext();
    const wallet = deterministicPublicKey(73);

    await putReverseRecord(env, SRS_DEFAULT_REVERSE_CLASS_ADDRESS, wallet, [
      ['NAME', 'standalone.sol'],
    ]);

    const resolved = await reverseResolve(
      env.context,
      { wallet },
      { verifyReverseWithForward: false }
    );
    expect(resolved).to.equal('standalone.sol');
  });

  it('batch reverse resolves in input order', async () => {
    const env = new InMemoryContext();
    const walletA = deterministicPublicKey(74);
    const walletB = deterministicPublicKey(75);

    await putReverseRecord(env, SRS_DEFAULT_REVERSE_CLASS_ADDRESS, walletA, [
      ['NAME', 'alice.sol'],
    ]);
    await putReverseRecord(env, SRS_DEFAULT_REVERSE_CLASS_ADDRESS, walletB, [
      ['NAME', 'bob.sol'],
    ]);

    const resolved = await batchReverseResolve(
      env.context,
      { wallets: [walletA, walletB] },
      { verifyReverseWithForward: false }
    );

    expect(resolved).to.deep.equal(['alice.sol', 'bob.sol']);
  });
});
