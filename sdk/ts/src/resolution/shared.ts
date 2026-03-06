import {
  Context,
  PublicKey,
  RpcGetAccountOptions,
  publicKey,
} from '@metaplex-foundation/umi';
import { safeFetchRecord } from '../accounts';
import { getSolanaRecordServiceProgramId } from '../programs';
import {
  DEFAULT_SOLANA_CAIP2,
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
} from './constants';
import { ResolutionInputError } from './errors';
import { namehash } from './namehash';
import { findRecordPda, reverseRecordSeed } from './pda';
import { parseResolutionTuples, type ResolutionTuple } from './tupleCodec';
import { normalizeChainCaip2 } from './caip';

export type ResolutionContext = Pick<Context, 'rpc' | 'programs'>;
type PdaContext = ResolutionContext & Pick<Context, 'eddsa'>;

export interface ResolutionOptions {
  domaClassAddress?: PublicKey;
  reverseClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
  rpcGetAccountOptions?: RpcGetAccountOptions;
}

function getPdaContext(context: ResolutionContext): PdaContext {
  const withEddsa = context as Partial<PdaContext>;
  if (!withEddsa.eddsa) {
    throw new ResolutionInputError(
      'context.eddsa is required to derive SRS PDAs'
    );
  }

  return withEddsa as PdaContext;
}

export function getProgramId(
  context: ResolutionContext,
  options?: ResolutionOptions
): PublicKey {
  return options?.programId ?? getSolanaRecordServiceProgramId(context);
}

export function getDomaClassAddress(options?: ResolutionOptions): PublicKey {
  return options?.domaClassAddress ?? SRS_DEFAULT_DOMA_CLASS_ADDRESS;
}

export function getReverseClassAddress(options?: ResolutionOptions): PublicKey {
  return options?.reverseClassAddress ?? SRS_DEFAULT_REVERSE_CLASS_ADDRESS;
}

export function getDefaultChainCaip2(options?: ResolutionOptions): string {
  return normalizeChainCaip2(options?.defaultChainCaip2 ?? DEFAULT_SOLANA_CAIP2);
}

export async function fetchForwardTuples(
  context: ResolutionContext,
  name: string,
  options?: ResolutionOptions
): Promise<ResolutionTuple[] | null> {
  const tokenId = namehash(name);
  const [recordPda] = findRecordPda(
    getPdaContext(context),
    getDomaClassAddress(options),
    tokenId,
    getProgramId(context, options)
  );

  const record = await safeFetchRecord(
    context,
    recordPda,
    options?.rpcGetAccountOptions
  );

  return record ? parseResolutionTuples(record.data) : null;
}

export async function fetchReverseTuples(
  context: ResolutionContext,
  wallet: string,
  options?: ResolutionOptions
): Promise<ResolutionTuple[] | null> {
  const seed = reverseRecordSeed(wallet);
  const [recordPda] = findRecordPda(
    getPdaContext(context),
    getReverseClassAddress(options),
    seed,
    getProgramId(context, options)
  );

  const record = await safeFetchRecord(
    context,
    recordPda,
    options?.rpcGetAccountOptions
  );

  return record ? parseResolutionTuples(record.data) : null;
}

export function normalizeWalletAddress(wallet: string): string {
  return publicKey(wallet);
}
