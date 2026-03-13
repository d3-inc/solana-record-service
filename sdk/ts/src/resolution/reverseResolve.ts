import { normalizeName } from './namehash';
import {
  fetchReverseTuples,
  getDefaultChainCaip2,
  normalizeWalletAddress,
  type ResolutionContext,
  type ResolutionOptions,
} from './shared';
import { resolve } from './resolve';
import { publicKeyBytes } from '@metaplex-foundation/umi';

export interface ReverseResolveInput {
  wallet: string;
}

export interface ReverseResolveOptions extends ResolutionOptions {
  verifyReverseWithForward?: boolean;
}

export interface BatchReverseResolveInput {
  wallets: readonly string[];
}

export async function reverseResolve(
  context: ResolutionContext,
  input: ReverseResolveInput,
  options?: ReverseResolveOptions
): Promise<string | null> {
  const normalizedWallet = normalizeWalletAddress(input.wallet);
  const tuples = await fetchReverseTuples(context, normalizedWallet, options);
  if (!tuples) {
    return null;
  }

  let selectedName: string | null = null;
  for (const [key, value] of tuples) {
    if (key.trim().toUpperCase() !== 'NAME') {
      continue;
    }

    const candidate = value.trim();
    if (candidate.length > 0) {
      selectedName = normalizeName(candidate);
    }
  }

  if (!selectedName) {
    return null;
  }

  const verifyReverseWithForward = options?.verifyReverseWithForward ?? true;
  if (!verifyReverseWithForward) {
    return selectedName;
  }

  const resolvedWallet = await resolve(
    context,
    {
      name: selectedName,
      chainCaip2: getDefaultChainCaip2(options),
    },
    options
  );

  if (!resolvedWallet) {
    return null;
  }

  return normalizeWalletAddress(resolvedWallet) === normalizedWallet
    ? selectedName
    : null;
}


function reverseRecordSeed(wallet: string): Uint8Array {
  return publicKeyBytes(wallet);
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
