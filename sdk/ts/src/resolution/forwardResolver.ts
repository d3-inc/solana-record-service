import { PublicKey } from '@metaplex-foundation/umi';
import { parseWalletTuple, normalizeChainCaip2 } from './caip';
import { DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID } from './constants';
import { namehash } from './namehash';
import { findRecordPda } from './pda';
import type { RecordAccountProvider } from './provider';
import {
  parseResolutionTuples,
  type ResolutionTuple,
} from './tupleCodec';

export interface DomaForwardResolverConfig {
  provider: RecordAccountProvider;
  domaClassAddress: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
}

export class DomaForwardResolver {
  private readonly provider: RecordAccountProvider;
  private readonly domaClassAddress: PublicKey;
  private readonly programId: PublicKey;
  private readonly defaultChainCaip2: string;

  constructor(config: DomaForwardResolverConfig) {
    this.provider = config.provider;
    this.domaClassAddress = config.domaClassAddress;
    this.programId = config.programId ?? SRS_DEFAULT_PROGRAM_ID;
    this.defaultChainCaip2 = normalizeChainCaip2(
      config.defaultChainCaip2 ?? DEFAULT_SOLANA_CAIP2
    );
  }

  async resolve(
    name: string,
    chainCaip2: string = this.defaultChainCaip2
  ): Promise<string | null> {
    const normalizedChain = normalizeChainCaip2(chainCaip2);
    const tuples = await this.fetchNameTuples(name);
    if (!tuples) {
      return null;
    }

    let selectedWallet: string | null = null;
    for (const [key, value] of tuples) {
      const parsed = parseWalletTuple(key, value, normalizedChain);
      if (!parsed) {
        continue;
      }

      if (parsed.chainId === normalizedChain) {
        selectedWallet = parsed.walletAddress;
      }
    }

    return selectedWallet;
  }

  async resolveRecord(name: string, recordKey: string): Promise<string | null> {
    const tuples = await this.fetchNameTuples(name);
    if (!tuples) {
      return null;
    }

    const normalizedKey = recordKey.trim().toUpperCase();
    if (normalizedKey.length === 0) {
      return null;
    }

    let selectedValue: string | null = null;
    for (const [key, value] of tuples) {
      if (key.trim().toUpperCase() !== normalizedKey) {
        continue;
      }

      const candidate = value.trim();
      if (candidate.length > 0) {
        selectedValue = candidate;
      }
    }

    return selectedValue;
  }

  async resolveRecords(name: string, recordKey: string): Promise<string[]> {
    const tuples = await this.fetchNameTuples(name);
    if (!tuples) {
      return [];
    }

    const normalizedKey = recordKey.trim().toUpperCase();
    if (normalizedKey.length === 0) {
      return [];
    }

    return tuples
      .filter(([key]) => key.trim().toUpperCase() === normalizedKey)
      .map(([, value]) => value.trim())
      .filter((value) => value.length > 0);
  }

  private async fetchNameTuples(name: string): Promise<ResolutionTuple[] | null> {
    const tokenId = namehash(name);
    const [recordPda] = await findRecordPda(
      this.domaClassAddress,
      tokenId,
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
