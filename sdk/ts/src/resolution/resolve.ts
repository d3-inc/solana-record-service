import { parseWalletTuple, normalizeChainCaip2 } from './caip';
import {
  fetchForwardTuples,
  getDefaultChainCaip2,
  type ResolutionContext,
  type ResolutionOptions,
} from './shared';

export interface ResolveInput {
  name: string;
  chainCaip2?: string;
}

export interface ResolveTextRecordInput {
  name: string;
  key: string;
}

export async function resolve(
  context: ResolutionContext,
  input: ResolveInput,
  options?: ResolutionOptions
): Promise<string | null> {
  const normalizedChain = normalizeChainCaip2(
    input.chainCaip2 ?? getDefaultChainCaip2(options)
  );
  const tuples = await fetchForwardTuples(context, input.name, options);
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

export async function resolveRecord(
  context: ResolutionContext,
  input: ResolveTextRecordInput,
  options?: ResolutionOptions
): Promise<string | null> {
  const tuples = await fetchForwardTuples(context, input.name, options);
  if (!tuples) {
    return null;
  }

  const normalizedKey = input.key.trim().toUpperCase();
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

export async function resolveRecords(
  context: ResolutionContext,
  input: ResolveTextRecordInput,
  options?: ResolutionOptions
): Promise<string[]> {
  const tuples = await fetchForwardTuples(context, input.name, options);
  if (!tuples) {
    return [];
  }

  const normalizedKey = input.key.trim().toUpperCase();
  if (normalizedKey.length === 0) {
    return [];
  }

  return tuples
    .filter(([key]) => key.trim().toUpperCase() === normalizedKey)
    .map(([, value]) => value.trim())
    .filter((value) => value.length > 0);
}
