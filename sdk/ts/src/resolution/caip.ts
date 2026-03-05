import { ResolutionInputError } from './errors';

// CAIP-2: namespace [-a-z0-9]{3,8}, reference [-_a-zA-Z0-9]{1,32}
const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

export interface ParsedWalletValue {
  chainId: string;
  walletAddress: string;
}

export function normalizeChainCaip2(chainId: string): string {
  const trimmed = chainId.trim();
  if (!CAIP2_PATTERN.test(trimmed)) {
    throw new ResolutionInputError(`Invalid CAIP-2 chain id: ${chainId}`);
  }

  return trimmed;
}

function parseCaipWalletValue(value: string): ParsedWalletValue | null {
  const trimmed = value.trim();
  const parts = trimmed.split(':');

  if (parts.length < 3) {
    return null;
  }

  // Explicitly reject DID-PKH payloads. Resolution supports CAIP-10 values only.
  if (parts[0]?.toLowerCase() === 'did' && parts[1]?.toLowerCase() === 'pkh') {
    return null;
  }

  const chainId = `${parts[0]?.trim()}:${parts[1]?.trim()}`;
  let normalizedChain: string;
  try {
    normalizedChain = normalizeChainCaip2(chainId);
  } catch {
    return null;
  }

  const walletAddress = parts.slice(2).join(':').trim();
  if (walletAddress.length === 0) {
    return null;
  }

  return { chainId: normalizedChain, walletAddress };
}

export function parseWalletTuple(
  key: string,
  value: string,
  defaultChainCaip2: string
): ParsedWalletValue | null {
  const normalizedDefault = normalizeChainCaip2(defaultChainCaip2);
  const trimmedKey = key.trim();
  const normalizedKey = trimmedKey.toUpperCase();

  if (normalizedKey !== 'WALLET') {
    return null;
  }

  const parsed = parseCaipWalletValue(value);
  if (parsed) {
    return parsed;
  }

  const walletAddress = value.trim();
  if (walletAddress.length === 0) {
    return null;
  }

  // Fallback only for plain addresses. Colon-separated payloads must be valid CAIP-10.
  if (walletAddress.includes(':')) {
    return null;
  }

  return { chainId: normalizedDefault, walletAddress };
}
