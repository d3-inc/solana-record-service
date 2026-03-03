import { expect } from 'chai';
import { PublicKey } from '@metaplex-foundation/umi';
import type { Record } from '../src/accounts';
import {
  batchReverseResolve,
  DEFAULT_SOLANA_CAIP2,
  decodeSrsRecord,
  DomaForwardResolver,
  DomaSrsResolver,
  findRecordPda,
  namehash,
  parseResolutionTuples,
  resolve,
  reverseResolve,
  reverseRecordSeed,
  serializeResolutionTuples,
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
  SrsReverseResolver,
  type RecordAccountProvider,
} from '../src/resolution';
import {
  buildSrsRecordAccount,
  buildSrsRecordAccountData,
  deterministicPublicKey,
} from './helpers';

class InMemoryRecordProvider implements RecordAccountProvider {
  private readonly records = new Map<string, Record>();

  put(recordPda: PublicKey, record: Record): void {
    this.records.set(recordPda, record);
  }

  async fetchRecord(recordPda: PublicKey): Promise<Record | null> {
    return this.records.get(recordPda) ?? null;
  }
}

describe('resolution codec', () => {
  it('serializes and parses resolution tuples', () => {
    const tuples = [
      [`WALLET:${DEFAULT_SOLANA_CAIP2}`, deterministicPublicKey(88)],
      ['NAME', 'alice.sol'],
    ] as const;

    const encoded = serializeResolutionTuples(tuples);
    const decoded = parseResolutionTuples(encoded);

    expect(decoded).to.deep.equal(tuples);
  });

  it('emits UTF-8 payload compatible with current SRS string record data', () => {
    const tuples = [
      ['WALLET', deterministicPublicKey(89)],
      ['NAME', 'alice.sol'],
    ] as const;

    const encoded = serializeResolutionTuples(tuples);
    const decodedUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(encoded);

    expect(decodedUtf8.length).to.be.greaterThan(0);
    expect(parseResolutionTuples(encoded)).to.deep.equal(tuples);
  });

  it('decodes SRS account data and extracts tuple payload', () => {
    const classAddress = deterministicPublicKey(20);
    const ownerAddress = deterministicPublicKey(21);
    const seed = namehash('alice.sol');
    const tuples = serializeResolutionTuples([['NAME', 'alice.sol']]);

    const rawRecord = buildSrsRecordAccountData({
      classAddress,
      ownerAddress,
      seed,
      data: tuples,
      expiry: 123n,
    });

    const decoded = decodeSrsRecord(rawRecord);
    expect(decoded.class).to.equal(classAddress);
    expect(decoded.owner).to.equal(ownerAddress);
    expect(decoded.expiry).to.equal(123n);
    expect(parseResolutionTuples(decoded.data)).to.deep.equal([['NAME', 'alice.sol']]);
  });
});

describe('DomaForwardResolver', () => {
  it('resolves forward records with chain-aware last-write-wins', async () => {
    const domaClassAddress = deterministicPublicKey(30);
    const ownerAddress = deterministicPublicKey(32);
    const latestWallet = deterministicPublicKey(33);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
      defaultChainCaip2: DEFAULT_SOLANA_CAIP2,
    });

    const seed = namehash('alice.sol');
    const [recordPda] = await findRecordPda(domaClassAddress, seed);

    provider.put(
      recordPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          [`WALLET:${DEFAULT_SOLANA_CAIP2}`, deterministicPublicKey(34)],
          ['WALLET:eip155:1', '0x123'],
          ['WALLET', latestWallet],
        ]),
      })
    );

    const resolved = await resolver.resolve('alice.sol');
    expect(resolved).to.equal(latestWallet);
  });

  it('resolves token-owned forward records and supports DID-PKH wallet values', async () => {
    const domaClassAddress = deterministicPublicKey(35);
    const tokenOwnerAddress = deterministicPublicKey(37);
    const wallet = deterministicPublicKey(38);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
      defaultChainCaip2: DEFAULT_SOLANA_CAIP2,
    });

    const seed = namehash('tokenized.sol');
    const [recordPda] = await findRecordPda(domaClassAddress, seed);

    provider.put(
      recordPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress: tokenOwnerAddress,
        ownerType: 1,
        seed,
        data: serializeResolutionTuples([
          ['WALLET', `did:pkh:${DEFAULT_SOLANA_CAIP2}:${wallet}`],
        ]),
      })
    );

    const resolved = await resolver.resolve('tokenized.sol');
    expect(resolved).to.equal(wallet);
  });

  it('supports CAIP-10 wallet values', async () => {
    const domaClassAddress = deterministicPublicKey(45);
    const ownerAddress = deterministicPublicKey(46);
    const wallet = deterministicPublicKey(47);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
      defaultChainCaip2: DEFAULT_SOLANA_CAIP2,
    });

    const seed = namehash('caip10.sol');
    const [recordPda] = await findRecordPda(domaClassAddress, seed);

    provider.put(
      recordPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          ['WALLET', `solana:mainnet:${wallet}`],
        ]),
      })
    );

    const resolved = await resolver.resolve('caip10.sol');
    expect(resolved).to.equal(wallet);
  });

  it('resolves legacy solana:mainnet chain keys for old SRS records', async () => {
    const domaClassAddress = deterministicPublicKey(48);
    const ownerAddress = deterministicPublicKey(49);
    const wallet = deterministicPublicKey(50);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
      defaultChainCaip2: DEFAULT_SOLANA_CAIP2,
    });

    const seed = namehash('legacy-chain.sol');
    const [recordPda] = await findRecordPda(domaClassAddress, seed);

    provider.put(
      recordPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          ['WALLET:solana:mainnet', wallet],
        ]),
      })
    );

    const resolved = await resolver.resolve('legacy-chain.sol');
    expect(resolved).to.equal(wallet);
  });

  it('resolves legacy Solana genesis-hash aliases to the default Solana chain', async () => {
    const domaClassAddress = deterministicPublicKey(51);
    const ownerAddress = deterministicPublicKey(52);
    const wallet = deterministicPublicKey(53);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
      defaultChainCaip2: DEFAULT_SOLANA_CAIP2,
    });

    const seed = namehash('legacy-genesis.sol');
    const [recordPda] = await findRecordPda(domaClassAddress, seed);

    provider.put(
      recordPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          ['WALLET:solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ', wallet],
        ]),
      })
    );

    const resolved = await resolver.resolve('legacy-genesis.sol');
    expect(resolved).to.equal(wallet);
  });
});

describe('SrsReverseResolver', () => {
  it('requires forward verifier when verification is enabled by default', () => {
    const provider = new InMemoryRecordProvider();

    expect(
      () =>
        new SrsReverseResolver({
          provider,
          reverseClassAddress: deterministicPublicKey(90),
        })
    ).to.throw('forwardVerifier is required when verifyReverseWithForward is enabled');
  });

  it('reverse resolves name only when forward mapping matches', async () => {
    const domaClassAddress = deterministicPublicKey(40);
    const reverseClassAddress = deterministicPublicKey(41);
    const ownerAddress = deterministicPublicKey(42);
    const wallet = deterministicPublicKey(43);
    const name = 'alice.sol';

    const provider = new InMemoryRecordProvider();
    const forwardResolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
    });
    const reverseResolver = new SrsReverseResolver({
      provider,
      reverseClassAddress,
      forwardVerifier: forwardResolver,
      verifyReverseWithForward: true,
    });

    const forwardSeed = namehash(name);
    const [forwardPda] = await findRecordPda(domaClassAddress, forwardSeed);
    provider.put(
      forwardPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed: forwardSeed,
        data: serializeResolutionTuples([['WALLET', wallet]]),
      })
    );

    const reverseSeed = reverseRecordSeed(wallet);
    const [reversePda] = await findRecordPda(reverseClassAddress, reverseSeed);
    provider.put(
      reversePda,
      buildSrsRecordAccount({
        classAddress: reverseClassAddress,
        ownerAddress,
        seed: reverseSeed,
        data: serializeResolutionTuples([['NAME', 'ALICE.sol']]),
      })
    );

    const reverse = await reverseResolver.reverseResolve(wallet);
    expect(reverse).to.equal(name);
  });

  it('returns null for reverse mapping mismatch', async () => {
    const domaClassAddress = deterministicPublicKey(50);
    const reverseClassAddress = deterministicPublicKey(51);
    const ownerAddress = deterministicPublicKey(52);
    const wallet = deterministicPublicKey(53);

    const provider = new InMemoryRecordProvider();
    const forwardResolver = new DomaForwardResolver({
      provider,
      domaClassAddress,
    });
    const reverseResolver = new SrsReverseResolver({
      provider,
      reverseClassAddress,
      forwardVerifier: forwardResolver,
      verifyReverseWithForward: true,
    });

    const forwardSeed = namehash('alice.sol');
    const [forwardPda] = await findRecordPda(domaClassAddress, forwardSeed);
    provider.put(
      forwardPda,
      buildSrsRecordAccount({
        classAddress: domaClassAddress,
        ownerAddress,
        seed: forwardSeed,
        data: serializeResolutionTuples([
          ['WALLET', deterministicPublicKey(54)],
        ]),
      })
    );

    const reverseSeed = reverseRecordSeed(wallet);
    const [reversePda] = await findRecordPda(reverseClassAddress, reverseSeed);
    provider.put(
      reversePda,
      buildSrsRecordAccount({
        classAddress: reverseClassAddress,
        ownerAddress,
        seed: reverseSeed,
        data: serializeResolutionTuples([['NAME', 'alice.sol']]),
      })
    );

    const reverse = await reverseResolver.reverseResolve(wallet);
    expect(reverse).to.equal(null);
  });

  it('batch reverse resolves wallets in order', async () => {
    const reverseClassAddress = deterministicPublicKey(61);
    const ownerAddress = deterministicPublicKey(62);

    const walletA = deterministicPublicKey(63);
    const walletB = deterministicPublicKey(64);

    const provider = new InMemoryRecordProvider();
    const reverseResolver = new SrsReverseResolver({
      provider,
      reverseClassAddress,
      verifyReverseWithForward: false,
    });

    const reverseSeedA = reverseRecordSeed(walletA);
    const reverseSeedB = reverseRecordSeed(walletB);
    const [reversePdaA] = await findRecordPda(reverseClassAddress, reverseSeedA);
    const [reversePdaB] = await findRecordPda(reverseClassAddress, reverseSeedB);

    provider.put(
      reversePdaA,
      buildSrsRecordAccount({
        classAddress: reverseClassAddress,
        ownerAddress,
        seed: reverseSeedA,
        data: serializeResolutionTuples([['NAME', 'alice.sol']]),
      })
    );

    provider.put(
      reversePdaB,
      buildSrsRecordAccount({
        classAddress: reverseClassAddress,
        ownerAddress,
        seed: reverseSeedB,
        data: serializeResolutionTuples([['NAME', 'bob.sol']]),
      })
    );

    const results = await reverseResolver.batchReverseResolve([walletA, walletB]);
    expect(results).to.deep.equal(['alice.sol', 'bob.sol']);
  });

  it('reverse resolves from standalone reverse class without forward dependency when verification disabled', async () => {
    const reverseClassAddress = deterministicPublicKey(71);
    const ownerAddress = deterministicPublicKey(72);
    const wallet = deterministicPublicKey(73);

    const provider = new InMemoryRecordProvider();
    const reverseResolver = new SrsReverseResolver({
      provider,
      reverseClassAddress,
      verifyReverseWithForward: false,
    });

    const seed = reverseRecordSeed(wallet);
    const [reversePda] = await findRecordPda(reverseClassAddress, seed);

    provider.put(
      reversePda,
      buildSrsRecordAccount({
        classAddress: reverseClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([['NAME', 'standalone.sol']]),
      })
    );

    const resolved = await reverseResolver.reverseResolve(wallet);
    expect(resolved).to.equal('standalone.sol');
  });
});

describe('DomaSrsResolver compatibility facade', () => {
  it('supports legacy forwardClassAddress alias', async () => {
    const forwardClassAddress = deterministicPublicKey(101);
    const reverseClassAddress = deterministicPublicKey(102);
    const ownerAddress = deterministicPublicKey(103);

    const provider = new InMemoryRecordProvider();
    const resolver = new DomaSrsResolver({
      provider,
      forwardClassAddress,
      reverseClassAddress,
    });

    const seed = namehash('legacy.sol');
    const [forwardPda] = await findRecordPda(forwardClassAddress, seed);

    provider.put(
      forwardPda,
      buildSrsRecordAccount({
        classAddress: forwardClassAddress,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          ['WALLET', deterministicPublicKey(104)],
        ]),
      })
    );

    const resolved = await resolver.resolve('legacy.sol');
    expect(resolved).to.equal(deterministicPublicKey(104));
  });
});

describe('function-based API', () => {
  it('resolve() uses SDK default class addresses', async () => {
    const provider = new InMemoryRecordProvider();
    const ownerAddress = deterministicPublicKey(110);
    const wallet = deterministicPublicKey(111);

    const seed = namehash('default-forward.sol');
    const [forwardPda] = await findRecordPda(SRS_DEFAULT_DOMA_CLASS_ADDRESS, seed);

    provider.put(
      forwardPda,
      buildSrsRecordAccount({
        classAddress: SRS_DEFAULT_DOMA_CLASS_ADDRESS,
        ownerAddress,
        seed,
        data: serializeResolutionTuples([
          ['WALLET', wallet],
        ]),
      })
    );

    const resolved = await resolve({
      provider,
      name: 'default-forward.sol',
    });
    expect(resolved).to.equal(wallet);
  });

  it('reverseResolve() and batchReverseResolve() use SDK defaults with forward verification', async () => {
    const provider = new InMemoryRecordProvider();
    const ownerAddress = deterministicPublicKey(120);
    const walletA = deterministicPublicKey(121);
    const walletB = deterministicPublicKey(122);
    const nameA = 'default-a.sol';
    const nameB = 'default-b.sol';

    const forwardSeedA = namehash(nameA);
    const [forwardPdaA] = await findRecordPda(
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
      forwardSeedA
    );
    provider.put(
      forwardPdaA,
      buildSrsRecordAccount({
        classAddress: SRS_DEFAULT_DOMA_CLASS_ADDRESS,
        ownerAddress,
        seed: forwardSeedA,
        data: serializeResolutionTuples([['WALLET', walletA]]),
      })
    );

    const forwardSeedB = namehash(nameB);
    const [forwardPdaB] = await findRecordPda(
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
      forwardSeedB
    );
    provider.put(
      forwardPdaB,
      buildSrsRecordAccount({
        classAddress: SRS_DEFAULT_DOMA_CLASS_ADDRESS,
        ownerAddress,
        seed: forwardSeedB,
        data: serializeResolutionTuples([['WALLET', walletB]]),
      })
    );

    const reverseSeedA = reverseRecordSeed(walletA);
    const [reversePdaA] = await findRecordPda(
      SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
      reverseSeedA
    );
    provider.put(
      reversePdaA,
      buildSrsRecordAccount({
        classAddress: SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
        ownerAddress,
        seed: reverseSeedA,
        data: serializeResolutionTuples([['NAME', nameA]]),
      })
    );

    const reverseSeedB = reverseRecordSeed(walletB);
    const [reversePdaB] = await findRecordPda(
      SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
      reverseSeedB
    );
    provider.put(
      reversePdaB,
      buildSrsRecordAccount({
        classAddress: SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
        ownerAddress,
        seed: reverseSeedB,
        data: serializeResolutionTuples([['NAME', nameB]]),
      })
    );

    const single = await reverseResolve({
      provider,
      wallet: walletA,
    });
    expect(single).to.equal(nameA);

    const batch = await batchReverseResolve({
      provider,
      wallets: [walletA, walletB],
    });
    expect(batch).to.deep.equal([nameA, nameB]);
  });
});
