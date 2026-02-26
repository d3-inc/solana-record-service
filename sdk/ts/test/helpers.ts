import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import type { Record } from '../src/accounts';

export function deterministicPublicKey(seedByte: number): PublicKey {
  const bytes = new Uint8Array(32);
  bytes.fill(seedByte);
  return publicKey(bytes);
}

export interface BuildSrsRecordOptions {
  classAddress: PublicKey;
  ownerAddress: PublicKey;
  seed: Uint8Array;
  data: Uint8Array;
  ownerType?: number;
  isFrozen?: boolean;
  expiry?: bigint;
}

export function buildSrsRecordAccountData(
  options: BuildSrsRecordOptions
): Uint8Array {
  if (options.seed.length > 0xff) {
    throw new Error('seed must fit in u8');
  }

  const fixedLength = 1 + 32 + 1 + 32 + 1 + 8 + 1;
  const out = new Uint8Array(fixedLength + options.seed.length + options.data.length);
  const view = new DataView(out.buffer);

  let offset = 0;
  out[offset++] = 2;

  out.set(publicKeyBytes(options.classAddress), offset);
  offset += 32;

  out[offset++] = options.ownerType ?? 0;

  out.set(publicKeyBytes(options.ownerAddress), offset);
  offset += 32;

  out[offset++] = options.isFrozen ? 1 : 0;
  view.setBigInt64(offset, options.expiry ?? 0n, true);
  offset += 8;

  out[offset++] = options.seed.length;
  out.set(options.seed, offset);
  offset += options.seed.length;

  out.set(options.data, offset);
  return out;
}

export function buildSrsRecordAccount(options: BuildSrsRecordOptions): Record {
  return {
    publicKey: deterministicPublicKey(255),
    header: {
      executable: false,
      lamports: { basisPoints: 0n, identifier: 'SOL', decimals: 9 },
      owner: deterministicPublicKey(254),
      rentEpoch: 0n,
    },
    discriminator: 2,
    class: options.classAddress,
    ownerType: options.ownerType ?? 0,
    owner: options.ownerAddress,
    isFrozen: options.isFrozen ?? false,
    expiry: options.expiry ?? 0n,
    seed: options.seed,
    data: options.data,
  };
}
