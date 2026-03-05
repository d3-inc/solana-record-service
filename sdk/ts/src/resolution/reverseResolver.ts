import { PublicKey, publicKey } from '@metaplex-foundation/umi';
import { normalizeChainCaip2 } from './caip';
import { DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID } from './constants';
import { ResolutionInputError } from './errors';
import { normalizeName } from './namehash';
import { findRecordPda, reverseRecordSeed } from './pda';
import type { RecordAccountProvider } from './provider';
import {
  parseResolutionTuples,
  type ResolutionTuple,
} from './tupleCodec';

export interface ForwardNameResolver {
  resolve(name: string, chainCaip2?: string): Promise<string | null>;
}

export interface SrsReverseResolverConfig {
  provider: RecordAccountProvider;
  reverseClassAddress: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
  verifyReverseWithForward?: boolean;
  forwardVerifier?: ForwardNameResolver;
}

export class SrsReverseResolver {
  private readonly provider: RecordAccountProvider;
  private readonly reverseClassAddress: PublicKey;
  private readonly programId: PublicKey;
  private readonly defaultChainCaip2: string;
  private readonly verifyReverseWithForward: boolean;
  private readonly forwardVerifier?: ForwardNameResolver;

  constructor(config: SrsReverseResolverConfig) {
    this.provider = config.provider;
    this.reverseClassAddress = config.reverseClassAddress;
    this.programId = config.programId ?? SRS_DEFAULT_PROGRAM_ID;
    this.defaultChainCaip2 = normalizeChainCaip2(
      config.defaultChainCaip2 ?? DEFAULT_SOLANA_CAIP2
    );
    this.verifyReverseWithForward = config.verifyReverseWithForward ?? true;
    this.forwardVerifier = config.forwardVerifier;

    if (this.verifyReverseWithForward && !this.forwardVerifier) {
      throw new ResolutionInputError(
        'forwardVerifier is required when verifyReverseWithForward is enabled'
      );
    }
  }

  async reverseResolve(wallet: string): Promise<string | null> {
    const normalizedWallet = publicKey(wallet);
    const tuples = await this.fetchReverseTuples(normalizedWallet);
    if (!tuples) {
      return null;
    }

    let selectedName: string | null = null;
    for (const name of this.extractReverseNames(tuples)) {
      selectedName = name;
    }

    if (!selectedName) {
      return null;
    }

    if (!this.verifyReverseWithForward) {
      return selectedName;
    }

    const resolvedWallet = await this.forwardVerifier?.resolve(
      selectedName,
      this.defaultChainCaip2
    );
    if (!resolvedWallet) {
      return null;
    }

    return resolvedWallet === normalizedWallet ? selectedName : null;
  }

  async reverseResolveAll(wallet: string): Promise<string[]> {
    const normalizedWallet = publicKey(wallet);
    const tuples = await this.fetchReverseTuples(normalizedWallet);
    if (!tuples) {
      return [];
    }

    const names = this.extractReverseNames(tuples);
    if (!this.verifyReverseWithForward) {
      return names;
    }

    const verified = await Promise.all(
      names.map(async (name) => {
        const resolvedWallet = await this.forwardVerifier?.resolve(
          name,
          this.defaultChainCaip2
        );
        return resolvedWallet === normalizedWallet ? name : null;
      })
    );
    return verified.filter((name): name is string => name !== null);
  }

  async batchReverseResolve(
    wallets: readonly string[]
  ): Promise<Array<string | null>> {
    return Promise.all(wallets.map((wallet) => this.reverseResolve(wallet)));
  }

  async batchReverseResolveAll(
    wallets: readonly string[]
  ): Promise<string[][]> {
    return Promise.all(wallets.map((wallet) => this.reverseResolveAll(wallet)));
  }

  private extractReverseNames(tuples: readonly ResolutionTuple[]): string[] {
    const names: string[] = [];
    for (const [key, value] of tuples) {
      if (key.trim().toUpperCase() !== 'NAME') {
        continue;
      }

      const candidateName = value.trim();
      if (candidateName.length > 0) {
        names.push(normalizeName(candidateName));
      }
    }

    return names;
  }

  private async fetchReverseTuples(wallet: string): Promise<ResolutionTuple[] | null> {
    const reverseSeed = reverseRecordSeed(wallet);
    const [recordPda] = await findRecordPda(
      this.reverseClassAddress,
      reverseSeed,
      this.programId
    );

    return this.fetchRecordTuples(recordPda);
  }

  private async fetchRecordTuples(recordPda: PublicKey) {
    const record = await this.provider.fetchRecord(recordPda);
    if (!record) {
      return null;
    }

    return parseResolutionTuples(record.data);
  }
}
