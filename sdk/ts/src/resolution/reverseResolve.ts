import {
  Context,
  publicKey,
  PublicKey,
  publicKeyBytes,
  RpcBaseOptions,
} from '@metaplex-foundation/umi';
import { string, tuple, u32 } from '@metaplex-foundation/umi-serializers';

import { safeFetchAllRecord, safeFetchRecord } from '../generated/accounts';
import { ResolutionInvalidNameError, SrsRecordDecodeError } from './errors';
import { DEFAULT_SOLANA_CAIP2, resolve, resolveBatch } from './resolve';
import {
  deserializeSrsMappings,
  findRecordPda,
  NAME_MAPPING_TYPE,
  type NameToNameId,
  normalizeName,
  sanitizeRpcOptions,
  serializeSrsMappings,
} from './shared';

/** The name stored in a reverse resolution record. */
export type NameMapping = {
  /** Second-level domain, e.g. `"example"`. */
  sld: string;
  /** Top-level domain, e.g. `"com"`. */
  tld: string;
};

/**
 * Per-wallet result entry returned by {@link reverseResolveBatch}.
 * - `{ ok: true, value: string }` — resolved to a domain name.
 * - `{ ok: true, value: null }` — no record, no name mapping, or forward-verification mismatch.
 * - `{ ok: false, error }` — the on-chain record is malformed or stores an invalid name.
 */
export type ReverseResolveResult =
  | { ok: true; value: string | null }
  | { ok: false; error: SrsRecordDecodeError | ResolutionInvalidNameError };

/** Options for {@link reverseResolve}. */
export type ReverseResolveOptions = (
  | {
      /** When `true`, forward-resolves the name to confirm it maps back to the same wallet. */
      verifyReverseWithForward: true;
      /** Registry class address used for the forward resolution check. Required when `verifyReverseWithForward` is `true`. */
      forwardClassAddress: PublicKey;
    }
  | { verifyReverseWithForward: false; forwardClassAddress?: undefined }
) & {
  /** Overrides the default `name` → `nameId` mapping used during forward verification. Defaults to `namehash`. */
  nameToNameId?: NameToNameId;
} & RpcBaseOptions;

const nameMappingPayloadCodec = tuple([string({ size: u32() }), string({ size: u32() })] as const);

/**
 * Resolves a wallet address to its primary domain name.
 *
 * When `verifyReverseWithForward` is set to `true`, the result is verified by
 * forward-resolving the returned name and confirming it maps back to `wallet`.
 * This is the recommended option to ensure the reverse record is not stale or maliciously set.
 * Enabled by default.
 *
 * @param wallet - The wallet public key to look up.
 * @param classAddress - The SRS class account that owns the reverse record.
 * @returns The normalized domain name (e.g. `"example.com"`), or `null` if no record exists.
 * @throws {SrsRecordDecodeError} if the on-chain record data is malformed.
 */
export async function reverseResolve(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  wallet: PublicKey,
  classAddress: PublicKey,
  options?: ReverseResolveOptions,
): Promise<string | null> {
  const seed = publicKeyBytes(wallet);
  const [recordPda] = findRecordPda(context, classAddress, seed);

  const record = await safeFetchRecord(context, recordPda, sanitizeRpcOptions(options));
  if (!record) {
    return null;
  }

  const nameMapping = deserializeNameMapping(record.data);
  if (!nameMapping) {
    return null;
  }

  const name = normalizeName(`${nameMapping.sld}.${nameMapping.tld}`);

  const verifyReverseWithForward = options?.verifyReverseWithForward ?? true;
  if (!verifyReverseWithForward) {
    return name;
  }

  const isForwardMatch = await verifyWithForwardResolution(name, context, wallet, options);
  return isForwardMatch ? name : null;
}

/**
 * Resolves a batch of wallet addresses to their primary domain names in at most two RPC calls
 * (one for reverse records, one for forward verification if enabled).
 *
 * Every input wallet appears in the returned map:
 * - `{ ok: true, value: string }` — resolved to a domain name.
 * - `{ ok: true, value: null }` — no record, no name mapping, or forward-verification mismatch.
 * - `{ ok: false, error }` — the on-chain record is malformed or stores an invalid name.
 *
 * @param wallets - Wallet public keys to look up.
 * @param classAddress - The registry class account that owns the reverse records.
 */
export async function reverseResolveBatch(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  wallets: PublicKey[],
  classAddress: PublicKey,
  options?: ReverseResolveOptions,
): Promise<Record<string, ReverseResolveResult>> {
  if (wallets.length === 0) {
    return {};
  }

  const reversePdas = wallets.map((wallet) => {
    const [pda] = findRecordPda(context, classAddress, publicKeyBytes(wallet));
    return pda;
  });

  const reverseRecords = await safeFetchAllRecord(
    context,
    reversePdas,
    sanitizeRpcOptions(options),
  );
  const reverseRecordByPda = new Map(reverseRecords.map((r) => [r.publicKey.toString(), r]));

  const result: Record<string, ReverseResolveResult> = {};
  // Tracks wallet → name for the optional forward-verification pass.
  const resolvedNames: Record<string, string> = {};

  reversePdas.forEach((pda, i) => {
    const wallet = wallets[i];
    const record = reverseRecordByPda.get(pda.toString());
    if (!record) {
      result[wallet] = { ok: true, value: null };
      return;
    }
    try {
      const nameMapping = deserializeNameMapping(record.data);
      if (!nameMapping) {
        result[wallet] = { ok: true, value: null };
        return;
      }
      const name = normalizeName(`${nameMapping.sld}.${nameMapping.tld}`);
      resolvedNames[wallet] = name;
      result[wallet] = { ok: true, value: name };
    } catch (e) {
      if (e instanceof SrsRecordDecodeError || e instanceof ResolutionInvalidNameError) {
        result[wallet] = { ok: false, error: e };
      } else {
        throw e;
      }
    }
  });

  if (!options?.verifyReverseWithForward) {
    return result;
  }

  if (!options?.forwardClassAddress) {
    throw new Error('forwardClassAddress is required when verifyReverseWithForward is true');
  }

  // Use resolveBatch for forward verification (single RPC call for all unique names).
  const uniqueNames = [...new Set(Object.values(resolvedNames))];
  const forwardResults = await resolveBatch(context, uniqueNames, options.forwardClassAddress, {
    ...sanitizeRpcOptions(options),
    chainCaip2: DEFAULT_SOLANA_CAIP2,
    nameToNameId: options?.nameToNameId,
  });

  for (const [wallet, name] of Object.entries(resolvedNames)) {
    const fwdResult = forwardResults[name];
    const resolvedAddress = fwdResult?.ok ? fwdResult.value : null;
    try {
      if (!resolvedAddress || publicKey(resolvedAddress) !== wallet) {
        result[wallet] = { ok: true, value: null };
      }
    } catch {
      // This can happen if the forward-resolved address is malformed.
      // In that case, we treat it as a mismatch.
      result[wallet] = { ok: true, value: null };
    }
  }

  return result;
}

/** Serializes a {@link NameMapping} into an `SrsRecordData` blob. */
export function serializeNameMapping(mapping: NameMapping): Uint8Array {
  return serializeSrsMappings([
    {
      mappingType: NAME_MAPPING_TYPE,
      data: nameMappingPayloadCodec.serialize([mapping.sld, mapping.tld] as [string, string]),
    },
  ]);
}

/**
 * Deserializes an `SrsRecordData` blob into a {@link NameMapping}.
 * @returns The name mapping, or `null` if the blob contains no type-2 entry.
 * @throws {SrsRecordDecodeError} if the data is malformed.
 */
export function deserializeNameMapping(data: Uint8Array): NameMapping | null {
  try {
    const srsMappings = deserializeSrsMappings(data);
    const nameMapping = srsMappings.find((m) => m.mappingType === NAME_MAPPING_TYPE);
    if (!nameMapping) {
      return null;
    }
    const [[sld, tld]] = nameMappingPayloadCodec.deserialize(nameMapping.data);
    return { sld, tld };
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to decode reverse name record', error);
  }
}

async function verifyWithForwardResolution(
  name: string,
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  wallet: PublicKey,
  options?: ReverseResolveOptions,
): Promise<boolean> {
  // Defensive check: forwardClassAddress is required when verifyReverseWithForward is true
  if (!options?.forwardClassAddress) {
    throw new Error('forwardClassAddress is required when verifyReverseWithForward is true');
  }

  const resolvedWallet = await resolve(context, name, options.forwardClassAddress, {
    ...sanitizeRpcOptions(options),
    chainCaip2: DEFAULT_SOLANA_CAIP2,
    nameToNameId: options?.nameToNameId,
  });

  if (!resolvedWallet) {
    return false;
  }

  const isWalletMatch = publicKey(resolvedWallet) === wallet;
  return isWalletMatch;
}
