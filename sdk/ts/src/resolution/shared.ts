import { Context, PublicKey, publicKeyBytes, RpcBaseOptions } from '@metaplex-foundation/umi';
import { array, bytes, struct, u32, u8 } from '@metaplex-foundation/umi-serializers';
import { keccak_256 } from '@noble/hashes/sha3';

import { SOLANA_RECORD_SERVICE_PROGRAM_ID } from '../generated/programs';

import {
  ResolutionInvalidCAIP2Error,
  ResolutionInvalidNameError,
  SrsRecordDecodeError,
} from './errors';

// ASCII "mappings" — discriminator for every SrsRecordData blob
const SRS_RECORD_DATA_DISCRIMINATOR = new Uint8Array([
  0x6d, 0x61, 0x70, 0x70, 0x69, 0x6e, 0x67, 0x73,
]);

/** `mapping_type` value for a {@link WalletMapping} (forward resolution). */
export const WALLET_MAPPING_TYPE = 1;
/** `mapping_type` value for a {@link NameMapping} (reverse resolution). */
export const NAME_MAPPING_TYPE = 2;

/** A single type-tagged entry inside an `SrsRecordData` blob. */
export type SrsMapping = {
  mappingType: number;
  data: Uint8Array;
};

// Borsh: Vec<SrsMapping> where each entry is { u8 type, Vec<u8> data }
const srsMappingsSerializer = array(
  struct<SrsMapping>([
    ['mappingType', u8()],
    ['data', bytes({ size: u32() })],
  ]),
  { size: u32() },
);

/** Serializes a list of {@link SrsMapping} entries into an `SrsRecordData` blob. */
export function serializeSrsMappings(mappings: SrsMapping[]): Uint8Array {
  const bodyBytes = srsMappingsSerializer.serialize(mappings);
  const result = new Uint8Array(8 + bodyBytes.length);
  result.set(SRS_RECORD_DATA_DISCRIMINATOR, 0);
  result.set(bodyBytes, 8);
  return result;
}

/**
 * Deserializes an `SrsRecordData` blob into its constituent {@link SrsMapping} entries.
 * @throws {SrsRecordDecodeError} if the data is too short, has a wrong discriminator, or is malformed.
 */
export function deserializeSrsMappings(data: Uint8Array): SrsMapping[] {
  if (data.length < 12) {
    throw new SrsRecordDecodeError(`SrsRecordData too short: ${data.length} bytes`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== SRS_RECORD_DATA_DISCRIMINATOR[i]) {
      throw new SrsRecordDecodeError('Invalid SrsRecordData discriminator');
    }
  }
  try {
    const [mappings] = srsMappingsSerializer.deserialize(data.slice(8));
    return mappings;
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to deserialize SRS mappings', error);
  }
}

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

/**
 * Validates and trims a CAIP-2 chain identifier.
 * @throws {ResolutionInvalidCAIP2Error} if the format does not match `namespace:reference`.
 */
export function validateAndNormalizeCAIP2(caip2: string): string {
  const trimmed = caip2.trim();
  if (!CAIP2_PATTERN.test(trimmed)) {
    throw new ResolutionInvalidCAIP2Error(caip2);
  }

  return trimmed;
}

/**
 * Normalizes a domain name using IDNA/UTS#46 (lowercase, punycode, bidi checks).
 * @throws {ResolutionInvalidNameError} if the name is empty or fails IDNA validation.
 */
export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ResolutionInvalidNameError(name);
  }

  // Loaded dynamically, as it's an optional peer dependency.
  let tr46: any;
  try {
    tr46 = require('tr46');
  } catch (e) {
    throw new Error(
      'Missing dependency "tr46". Install it (e.g. `npm i tr46@6.0.0`) to enable IDNA/UTS#46 name normalization.',
    );
  }

  const asciiName = tr46.toASCII(trimmed, {
    checkBidi: true,
    checkHyphens: true,
    checkJoiners: true,
    useSTD3ASCIIRules: true,
    verifyDNSLength: true,
    transitionalProcessing: false,
  });

  if (!asciiName) {
    throw new ResolutionInvalidNameError(name);
  }

  return asciiName;
}

/**
 * Overrides the default `name` → `nameId` mapping used to derive a forward-resolution
 * record's PDA seed. Defaults to {@link namehash}.
 *
 * A custom implementation should throw {@link ResolutionInvalidNameError} for invalid
 * names to get the same per-name error isolation that `resolveBatch` gives `namehash`
 * failures; any other thrown error propagates and aborts the whole batch.
 */
export type NameToNameId = (name: string) => Uint8Array;

/**
 * Computes the Keccak-256 namehash of a domain name.
 * The name is normalized before hashing; labels are processed from TLD to SLD.
 * @throws {ResolutionInvalidNameError} if the name fails normalization.
 */
export function namehash(name: string): Uint8Array {
  const normalized = normalizeName(name);

  const labels = normalized.split('.');
  let node = new Uint8Array(32);

  const textEncoder = new TextEncoder();

  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const labelBytes = textEncoder.encode(labels[i]);
    const labelHash = Uint8Array.from(keccak_256(labelBytes));
    node = Uint8Array.from(keccak_256(concat32(node, labelHash)));
  }

  return node;
}

/**
 * Derives the PDA for a record account.
 * Seeds: `["record", classAddress, recordSeed]`
 */
export function findRecordPda(
  context: Pick<Context, 'eddsa' | 'programs'>,
  classAddress: PublicKey,
  recordSeed: Uint8Array,
): [PublicKey, number] {
  const programId = context.programs.getPublicKey(
    'solanaRecordService',
    SOLANA_RECORD_SERVICE_PROGRAM_ID,
  );

  const textEncoder = new TextEncoder();
  const SRS_RECORD_PDA_SEED = textEncoder.encode('record');

  return context.eddsa.findPda(programId, [
    SRS_RECORD_PDA_SEED,
    publicKeyBytes(classAddress),
    recordSeed,
  ]);
}

/**
 * Sanitizes RPC options for use with Umi's `rpc` methods.
 * Makes sure harmful properties are not passed to the RPC layer.
 */
export function sanitizeRpcOptions(options?: RpcBaseOptions): RpcBaseOptions {
  return {
    commitment: options?.commitment,
    id: options?.id,
    signal: options?.signal,
    minContextSlot: options?.minContextSlot,
  };
}

function concat32(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  out.set(left, 0);
  out.set(right, 32);
  return out;
}
