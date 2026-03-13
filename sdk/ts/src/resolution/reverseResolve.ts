import { Context, publicKey, PublicKey, publicKeyBytes, RpcGetAccountOptions } from '@metaplex-foundation/umi';

import { DEFAULT_SOLANA_CAIP2, resolve } from './resolve';
import { deserializeRecordData, findRecordPda, normalizeName, Tuples } from './shared';
import { ResolutionInputError } from './errors';
import { safeFetchRecord } from '../accounts';

// TODO: create actual reverse class
export const DEFAULT_REVERSE_RESOLUTION_CLASS_ADDRESS: PublicKey = publicKey(
  'CCcpHtBokXDR9PimwAKsxyspDoVtXxXjAJTBSsC1jHYY'
);

export type ReverseResolveOptions = {
   classAddress?: PublicKey;
   verifyReverseWithForward?: boolean;
   forwardClassAddress?: PublicKey;
} & RpcGetAccountOptions;

export async function reverseResolve(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  wallet: PublicKey,
  options?: ReverseResolveOptions
): Promise<string | null> {
  const seed = publicKeyBytes(wallet);
  const resolutionClassAddress = options?.classAddress ?? DEFAULT_REVERSE_RESOLUTION_CLASS_ADDRESS;
  const [recordPda] = findRecordPda(
    context,
    resolutionClassAddress,
    seed,
  );

  const record = await safeFetchRecord(
    context,
    recordPda,
    options
  );
  if (!record) {
    throw new ResolutionInputError(`No SRS record found for wallet: ${wallet}`);
  }

  const tuples = await deserializeRecordData(record?.data);
  if (!tuples?.length) {
    return null;
  }

  const name = findReverseRecord(tuples);
  if (!name) {
    return null;
  }

  const verifyReverseWithForward = options?.verifyReverseWithForward ?? true;
  if (!verifyReverseWithForward) {
    return name;
  }

  const isForwardResolutionMatch = await verifyWithForwardResolution(
    name,
    context,
    wallet,
    options
  );

  return isForwardResolutionMatch ? name : null;
}

async function verifyWithForwardResolution(
  name: string,
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  wallet: PublicKey,
  options?: ReverseResolveOptions,
): Promise<boolean> {
  const resolvedWallet = await resolve(
    context,
    name,
    {
      ...options,
      classAddress: options?.forwardClassAddress,
      chainCaip2: DEFAULT_SOLANA_CAIP2,
    }
  );

  if (!resolvedWallet) {
    return false;
  }

  const isForwardResolutionMatch = publicKey(resolvedWallet) === wallet;
  return isForwardResolutionMatch;
}

function findReverseRecord(
  tuples: Tuples,
): string | null {
  for (const [key, value] of tuples) {
    if (key !== 'NAME') {
      continue;
    }

    return normalizeName(value);
  }

  return null;
}