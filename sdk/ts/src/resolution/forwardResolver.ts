import { PublicKey } from '@metaplex-foundation/umi';
import { parseWalletTuple, normalizeChainCaip2 } from './caip';
import { DEFAULT_SOLANA_CAIP2, SRS_DEFAULT_PROGRAM_ID } from './constants';
import { namehash } from './namehash';
import { findRecordPda } from './pda';
import type { RecordAccountProvider } from './provider';
import { parseResolutionTuples } from './tupleCodec';

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
    const tokenId = namehash(name);
    const [recordPda] = await findRecordPda(
      this.domaClassAddress,
      tokenId,
      this.programId
    );

    const tuples = await this.fetchRecordTuples(recordPda);
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

  private async fetchRecordTuples(recordPda: PublicKey) {
    const record = await this.provider.fetchRecord(recordPda);
    if (!record) {
      return null;
    }

    return parseResolutionTuples(record.data);
  }
}
