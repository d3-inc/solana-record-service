import { Context, publicKey, PublicKey, RpcGetAccountOptions } from '@metaplex-foundation/umi';

import { safeFetchRecord } from '../generated/accounts';

import {
  findRecordPda,
  namehash,
  validateAndNormalizeCAIP2,
} from './shared';
import { ResolutionInputError, SrsRecordDecodeError } from './errors';
import { addCodecSizePrefix, getArrayCodec, getTupleCodec, getU32Codec, getUtf8Codec } from '@solana/kit';

export const DEFAULT_RESOLUTION_CLASS_ADDRESS: PublicKey = publicKey(
  'CCcpHtBokXDR9PimwAKsxyspDoVtXxXjAJTBSsC1jHYY'
);

// Wildcard namespace is used by default:
// https://standards.chainagnostic.org/CAIPs/caip-363
export const DEFAULT_SOLANA_CAIP2 = 'solana:_';

export type WalletMapping = {
  chainCaip2: string;
  address: string;
}

export type FindNamePDAOptions = {
   classAddress?: PublicKey;
};

export function findNameRecordPDA(
  context: Pick<Context, 'programs' | 'eddsa'>, 
  name: string,
  options?: FindNamePDAOptions
): PublicKey {
  const nameId = namehash(name);
  const resolutionClassAddress = options?.classAddress ?? DEFAULT_RESOLUTION_CLASS_ADDRESS;
  const [recordPda] = findRecordPda(
    context,
    resolutionClassAddress,
    nameId
  );

  return recordPda;
}

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

  const recordPda = findNameRecordPDA(
    context,
    name,
    { classAddress: options?.classAddress }
  );

  const record = await safeFetchRecord(
    context,
    recordPda,
    options
  );
  if(!record) {
    throw new ResolutionInputError(`No SRS record found for name: ${name}`);
  }

  const mappings = await deserializeRecordData(record?.data);
  if (!mappings?.length) {
    return null;
  }

  return findWalletRecord(mappings, chainCaip2);
}

function findWalletRecord(
  mappings: WalletMapping[],
  caip2: string,
): string | null {
  for (const mapping of mappings) {
    if (mapping.chainCaip2 !== caip2) {
      continue;
    }

    return mapping.address;
  }

  return null;
}


// Discriminator: first 8 bytes of sha256("doma:wallet_mapping_record")
// ASCII: "domawmap"
const WALLET_MAPPING_DISCRIMINATOR = new Uint8Array([0x64, 0x6f, 0x6d, 0x61, 0x77, 0x6d, 0x61, 0x70]);
const WALLET_MAPPING_VERSION = 1;
const WALLET_MAPPING_RECORD_TYPE = 0; // RecordType::Wallet

export function serializeRecordData(
  mappings: WalletMapping[],
): Uint8Array {
  return Uint8Array.from(getRecordDataCodec().encode(mappings));
}

export function deserializeRecordData(
  data: Uint8Array,
): WalletMapping[] {
  try {
    return getRecordDataCodec().decode(data);
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to decode SRS record data', error);
  }
}

// Borsh: u32 LE length prefix + UTF-8 bytes
function getBorshStringCodec() {
  return addCodecSizePrefix(getUtf8Codec(), getU32Codec());
}

// Borsh layout:
//   [0..8]  discriminator (8 bytes)
//   [8]     version (u8)
//   [9]     record_type (u8)
//   [10..]  mappings: u32 count + [u32+chain_caip2, u32+address]*
function getRecordDataCodec() {
  const s = getBorshStringCodec();
  const pairCodec = getTupleCodec([s, s] as const);
  const pairsCodec = getArrayCodec(pairCodec);

  return {
    encode(mappings: WalletMapping[]): Uint8Array {
      const pairs = mappings.map(({ chainCaip2, address }) => [chainCaip2, address] as const);
      const mappingsBytes = pairsCodec.encode(pairs);
      const result = new Uint8Array(10 + mappingsBytes.length);
      result.set(WALLET_MAPPING_DISCRIMINATOR, 0);
      result[8] = WALLET_MAPPING_VERSION;
      result[9] = WALLET_MAPPING_RECORD_TYPE;
      result.set(mappingsBytes, 10);
      return result;
    },
    decode(bytes: Uint8Array): WalletMapping[] {
      if (bytes.length < 10) {
        throw new Error(`Record data too short: ${bytes.length} bytes`);
      }
      for (let i = 0; i < 8; i++) {
        if (bytes[i] !== WALLET_MAPPING_DISCRIMINATOR[i]) {
          throw new Error('Invalid wallet mapping discriminator');
        }
      }
      if (bytes[8] !== WALLET_MAPPING_VERSION) {
        throw new Error(`Unsupported wallet mapping version: ${bytes[8]}`);
      }
      if (bytes[9] !== WALLET_MAPPING_RECORD_TYPE) {
        throw new Error(`Unsupported wallet mapping record type: ${bytes[9]}`);
      }
      return pairsCodec.decode(bytes.slice(10)).map(([chainCaip2, address]) => ({ chainCaip2, address }));
    },
  };
}