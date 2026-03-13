import { Context, publicKey, PublicKey, RpcGetAccountOptions } from '@metaplex-foundation/umi';

import { safeFetchRecord } from '../accounts';

import {
  deserializeRecordData,
  findRecordPda,
  namehash,
  Tuples,
  validateAndNormalizeCAIP10,
  validateAndNormalizeCAIP2,
} from './shared';
import { ResolutionInputError } from './errors';

export const DEFAULT_RESOLUTION_CLASS_ADDRESS: PublicKey = publicKey(
  'CCcpHtBokXDR9PimwAKsxyspDoVtXxXjAJTBSsC1jHYY'
);

// Wildcard namespace is used by default:
// https://standards.chainagnostic.org/CAIPs/caip-363
export const DEFAULT_SOLANA_CAIP2 = 'solana:_';

export type ResolveOptions = {
   classAddress?: PublicKey;
   chainCaip2?: string;
} & RpcGetAccountOptions;

export async function resolve(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  name: string,
  options?: ResolveOptions
): Promise<string | null> {
  const chainCaip2 = validateAndNormalizeCAIP2(
    options?.chainCaip2 || DEFAULT_SOLANA_CAIP2
  );
  const resolutionClassAddress = options?.classAddress ?? DEFAULT_RESOLUTION_CLASS_ADDRESS;

  const nameId = namehash(name);
  const [recordPda] = findRecordPda(
    context,
    resolutionClassAddress,
    nameId
  );

  const record = await safeFetchRecord(
    context,
    recordPda,
    options
  );
  if(!record) {
    throw new ResolutionInputError(`No SRS record found for name: ${name}`);
  }

  const tuples = await deserializeRecordData(record?.data);
  if (!tuples?.length) {
    return null;
  }

  return findWalletRecord(tuples, chainCaip2);
}

function findWalletRecord(
  tuples: Tuples,
  caip2: string,
): string | null {
  for (const [key, value] of tuples) {
    if (key !== 'WALLET') {
      continue;
    }

    const parsed = parseCaip10WalletValue(value);
    if (parsed?.caip2 === caip2) {
      return parsed.walletAddress;
    }
  }

  return null;
}

function parseCaip10WalletValue(value: string): { caip2: string, walletAddress: string } | null {
  const caip10 = validateAndNormalizeCAIP10(value);

  const [namespace, reference, address] = caip10.split(':');

  return {
    caip2: `${namespace}:${reference}`,
    walletAddress: address,
  }
}