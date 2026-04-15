import {
  addCodecSizePrefix,
  getTupleCodec,
  getU32Codec,
  getUtf8Codec,
} from '@solana/kit';
import { Context, publicKey, PublicKey, publicKeyBytes, RpcGetAccountOptions } from '@metaplex-foundation/umi';

import { DEFAULT_SOLANA_CAIP2, resolve } from './resolve';
import { findRecordPda, normalizeName } from './shared';
import { ResolutionInputError, SrsRecordDecodeError } from './errors';
import { safeFetchRecord } from '../accounts';

export const DEFAULT_REVERSE_RESOLUTION_CLASS_ADDRESS: PublicKey = publicKey(
  'EM8obeyZaFKZ9T2kWZ1JZwRBUMmvJcX2r4YVF9ZLv2xQ'
);

const REVERSE_NAME_DISCRIMINATOR = new Uint8Array([0x64, 0x6f, 0x6d, 0x61, 0x72, 0x6e, 0x61, 0x6d]);
const REVERSE_NAME_VERSION = 1;
const REVERSE_NAME_RECORD_TYPE = 1; // RecordType::Name = 1

export type ReverseNameRecord = {
  sld: string;
  tld: string;
  tokenId: string;
};

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

  const reverseRecord = deserializeReverseRecord(record.data);
  const name = normalizeName(`${reverseRecord.sld}.${reverseRecord.tld}`);

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

  return publicKey(resolvedWallet) === wallet;
}

// Borsh layout:
//   [0..8]  discriminator (8 bytes)
//   [8]     version (u8)
//   [9]     record_type (u8)
//   [10..]  sld, tld, tokenId as borsh strings (u32+bytes each)
function getReverseRecordCodec() {
  const s = addCodecSizePrefix(getUtf8Codec(), getU32Codec());
  const bodyCodec = getTupleCodec([s, s, s] as const);

  return {
    encode(record: ReverseNameRecord): Uint8Array {
      const bodyBytes = bodyCodec.encode([record.sld, record.tld, record.tokenId]);
      const result = new Uint8Array(10 + bodyBytes.length);
      result.set(REVERSE_NAME_DISCRIMINATOR, 0);
      result[8] = REVERSE_NAME_VERSION;
      result[9] = REVERSE_NAME_RECORD_TYPE;
      result.set(bodyBytes, 10);
      return result;
    },
    decode(bytes: Uint8Array): ReverseNameRecord {
      if (bytes.length < 10) {
        throw new Error(`Reverse record data too short: ${bytes.length} bytes`);
      }
      for (let i = 0; i < 8; i++) {
        if (bytes[i] !== REVERSE_NAME_DISCRIMINATOR[i]) {
          throw new Error('Invalid reverse name discriminator');
        }
      }
      if (bytes[8] !== REVERSE_NAME_VERSION) {
        throw new Error(`Unsupported reverse name version: ${bytes[8]}`);
      }
      if (bytes[9] !== REVERSE_NAME_RECORD_TYPE) {
        throw new Error(`Unsupported reverse name record type: ${bytes[9]}`);
      }
      const [sld, tld, tokenId] = bodyCodec.decode(bytes.slice(10));
      return { sld, tld, tokenId };
    },
  };
}

export function serializeReverseRecord(record: ReverseNameRecord): Uint8Array {
  return getReverseRecordCodec().encode(record);
}

function deserializeReverseRecord(data: Uint8Array): ReverseNameRecord {
  try {
    return getReverseRecordCodec().decode(data);
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to decode reverse name record', error);
  }
}
