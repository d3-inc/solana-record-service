import { Context, PublicKey, RpcBaseOptions } from '@metaplex-foundation/umi';

import { safeFetchAllRecord, safeFetchRecord } from '../generated/accounts';

import { string, tuple, u32 } from '@metaplex-foundation/umi-serializers';
import { ResolutionInvalidNameError, SrsRecordDecodeError } from './errors';
import {
  WALLET_MAPPING_TYPE,
  deserializeSrsMappings,
  findRecordPda,
  namehash,
  type NameToNameId,
  sanitizeRpcOptions,
  serializeSrsMappings,
  validateAndNormalizeCAIP2,
} from './shared';

/**
 * Default CAIP-2 chain identifier for Solana.
 * Uses the wildcard namespace per [CAIP-363](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-363.md).
 */
export const DEFAULT_SOLANA_CAIP2 = 'solana:_';

/** A wallet address associated with a specific blockchain chain. */
export type WalletMapping = {
  /** CAIP-2 chain identifier, e.g. `"solana:_"`, `"eip155:1"`. */
  chainCaip2: string;
  /** Chain-native address string. */
  address: string;
};

const walletMappingPayloadCodec = tuple([
  string({ size: u32() }),
  string({ size: u32() }),
] as const);

/**
 * Derives the on-chain PDA for a forward resolution record.
 *
 * @param nameToNameId - Overrides the default `name` → `nameId` mapping. Defaults to {@link namehash}.
 */
export function findNameRecordPDA(
  context: Pick<Context, 'programs' | 'eddsa'>,
  name: string,
  classAddress: PublicKey,
  nameToNameId: NameToNameId = namehash,
): PublicKey {
  const nameId = nameToNameId(name);
  const [recordPda] = findRecordPda(context, classAddress, nameId);

  return recordPda;
}

/**
 * Per-name result entry returned by {@link resolveBatch}.
 * - `{ ok: true, value: string }` — resolved to a wallet address.
 * - `{ ok: true, value: null }` — no record exists or no matching chain mapping.
 * - `{ ok: false, error }` — the name is invalid or the on-chain record is malformed.
 */
export type ResolveResult =
  | { ok: true; value: string | null }
  | { ok: false; error: ResolutionInvalidNameError | SrsRecordDecodeError };

/** Options for {@link resolve}. */
export type ResolveOptions = {
  /** CAIP-2 chain to look up. Defaults to {@link DEFAULT_SOLANA_CAIP2}. */
  chainCaip2?: string;
  /** Overrides the default `name` → `nameId` mapping. Defaults to {@link namehash}. */
  nameToNameId?: NameToNameId;
} & RpcBaseOptions;

/**
 * Resolves a domain name to a wallet address.
 *
 * @param name - The domain name to resolve, e.g. `"example.com"`.
 * @param classAddress - The SRS class account that owns the name.
 * @returns The wallet address string, or `null` if no record or matching chain mapping exists.
 * @throws {ResolutionInvalidNameError} if `name` is not a valid domain.
 * @throws {ResolutionInvalidCAIP2Error} if `options.chainCaip2` is not a valid CAIP-2 identifier.
 * @throws {SrsRecordDecodeError} if the on-chain record data is malformed.
 */
export async function resolve(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  name: string,
  classAddress: PublicKey,
  options?: ResolveOptions,
): Promise<string | null> {
  const chainCaip2 = validateAndNormalizeCAIP2(options?.chainCaip2 ?? DEFAULT_SOLANA_CAIP2);

  const recordPda = findNameRecordPDA(context, name, classAddress, options?.nameToNameId);

  const record = await safeFetchRecord(context, recordPda, sanitizeRpcOptions(options));
  if (!record) {
    return null;
  }

  const mappings = deserializeWalletMappings(record.data);
  if (!mappings.length) {
    return null;
  }

  return findWalletMapping(mappings, chainCaip2);
}

/**
 * Resolves a batch of domain names to wallet addresses in a single RPC call.
 *
 * Every input name appears in the returned map:
 * - `{ ok: true, value: string }` — resolved to a wallet address.
 * - `{ ok: true, value: null }` — no record exists or no matching chain mapping.
 * - `{ ok: false, error }` — the name is invalid or the on-chain record is malformed.
 *
 * @param names - Domain names to resolve.
 * @param classAddress - The registry class account that owns the names.
 * @throws {ResolutionInvalidCAIP2Error} if `options.chainCaip2` is not a valid CAIP-2 identifier.
 */
export async function resolveBatch(
  context: Pick<Context, 'rpc' | 'programs' | 'eddsa'>,
  names: string[],
  classAddress: PublicKey,
  options?: ResolveOptions,
): Promise<Record<string, ResolveResult>> {
  if (names.length === 0) return {};

  const chainCaip2 = validateAndNormalizeCAIP2(options?.chainCaip2 ?? DEFAULT_SOLANA_CAIP2);

  const result: Record<string, ResolveResult> = {};
  const validPdas: PublicKey[] = [];
  const validNames: string[] = [];

  for (const name of names) {
    try {
      validPdas.push(findNameRecordPDA(context, name, classAddress, options?.nameToNameId));
      validNames.push(name);
    } catch (e) {
      if (e instanceof ResolutionInvalidNameError) {
        result[name] = { ok: false, error: e };
      } else {
        throw e;
      }
    }
  }

  if (validPdas.length > 0) {
    const records = await safeFetchAllRecord(context, validPdas, sanitizeRpcOptions(options));
    const recordByPda = new Map(records.map((r) => [r.publicKey.toString(), r]));

    for (let i = 0; i < validNames.length; i++) {
      const record = recordByPda.get(validPdas[i].toString());
      if (!record) {
        result[validNames[i]] = { ok: true, value: null };
        continue;
      }
      try {
        result[validNames[i]] = {
          ok: true,
          value: findWalletMapping(deserializeWalletMappings(record.data), chainCaip2),
        };
      } catch (e) {
        if (e instanceof SrsRecordDecodeError) {
          result[validNames[i]] = { ok: false, error: e };
        } else {
          throw e;
        }
      }
    }
  }

  return result;
}

/** Serializes a list of {@link WalletMapping} entries into an `SrsRecordData` blob. */
export function serializeWalletMappings(mappings: WalletMapping[]): Uint8Array {
  return serializeSrsMappings(
    mappings.map(({ chainCaip2, address }) => ({
      mappingType: WALLET_MAPPING_TYPE,
      data: walletMappingPayloadCodec.serialize([chainCaip2, address] as [string, string]),
    })),
  );
}

/**
 * Deserializes an `SrsRecordData` blob into its {@link WalletMapping} entries.
 * Entries with unknown `mapping_type` values are silently ignored.
 * @throws {SrsRecordDecodeError} if the data is malformed.
 */
export function deserializeWalletMappings(data: Uint8Array): WalletMapping[] {
  try {
    return deserializeSrsMappings(data)
      .filter((m) => m.mappingType === WALLET_MAPPING_TYPE)
      .map((m) => {
        const [[chainCaip2, address]] = walletMappingPayloadCodec.deserialize(m.data);
        return { chainCaip2, address };
      });
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to decode SRS record data', error);
  }
}

function findWalletMapping(mappings: WalletMapping[], caip2: string): string | null {
  for (const mapping of mappings) {
    if (mapping.chainCaip2 !== caip2) {
      continue;
    }

    return mapping.address;
  }

  return null;
}
