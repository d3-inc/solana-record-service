import { ResolutionInputError } from './errors';
import { DEFAULT_SOLANA_CAIP2 } from './constants';

// CAIP-2: namespace [-a-z0-9]{3,8}, reference [-_a-zA-Z0-9]{1,32}
const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const LEGACY_SOLANA_MAINNET_CAIP2 = 'solana:mainnet';
const LEGACY_SOLANA_MAINNET_BETA_CAIP2 = 'solana:mainnet-beta';
const LEGACY_SOLANA_MAINNET_GENESIS_CAIP2 =
  'solana:4sgjmw1sunhzsxgspuhpqldx6wiyjntz';

export interface ParsedWalletValue {
  chainId: string;
  walletAddress: string;
}

function canonicalizeChainCaip2(chainId: string): string {
  const lower = chainId.toLowerCase();
  if (
    lower === LEGACY_SOLANA_MAINNET_CAIP2 ||
    lower === LEGACY_SOLANA_MAINNET_BETA_CAIP2 ||
    lower === LEGACY_SOLANA_MAINNET_GENESIS_CAIP2
  ) {
    return DEFAULT_SOLANA_CAIP2;
  }

  return chainId;
}

export function normalizeChainCaip2(chainId: string): string {
  const trimmed = chainId.trim();
  if (!CAIP2_PATTERN.test(trimmed)) {
    throw new ResolutionInputError(`Invalid CAIP-2 chain id: ${chainId}`);
  }

  return canonicalizeChainCaip2(trimmed);
}

function parseCaipWalletValue(value: string): ParsedWalletValue | null {
  const trimmed = value.trim();
  const parts = trimmed.split(':');

  if (parts.length < 3) {
    return null;
  }

  // DID-PKH is supported by requirement: did:pkh:<namespace>:<reference>:<account>
  if (parts[0]?.toLowerCase() === 'did' && parts[1]?.toLowerCase() === 'pkh' && parts.length >= 5) {
    const chain = `${parts[2]?.trim()}:${parts[3]?.trim()}`;
    let normalizedChain: string;
    try {
      normalizedChain = normalizeChainCaip2(chain);
    } catch {
      return null;
    }

    const walletAddress = parts.slice(4).join(':').trim();
    if (walletAddress.length === 0) {
      return null;
    }

    return { chainId: normalizedChain, walletAddress };
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

  if (normalizedKey === 'WALLET') {
    const parsed = parseCaipWalletValue(value);
    if (parsed) {
      return parsed;
    }

    const walletAddress = value.trim();
    if (walletAddress.length === 0) {
      return null;
    }

    return { chainId: normalizedDefault, walletAddress };
  }

  if (!normalizedKey.startsWith('WALLET:')) {
    return null;
  }

  const chainInKeyRaw = trimmedKey.slice('WALLET:'.length).trim();
  if (chainInKeyRaw.length === 0) {
    return null;
  }

  const chainId = normalizeChainCaip2(chainInKeyRaw);
  const parsed = parseCaipWalletValue(value);
  if (parsed) {
    return {
      chainId,
      walletAddress: parsed.walletAddress,
    };
  }

  const walletAddress = value.trim();
  if (walletAddress.length === 0) {
    return null;
  }

  return { chainId, walletAddress };
}
