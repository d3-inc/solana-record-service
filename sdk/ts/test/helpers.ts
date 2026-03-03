import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import {
  getRecordAccountDataSerializer,
  type Record,
} from '../src/accounts';

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
  if ((options.ownerType ?? 0) !== 0) {
    throw new Error('buildSrsRecordAccountData supports ownerType=0 only');
  }

  return getRecordAccountDataSerializer().serialize({
    class: options.classAddress,
    owner: options.ownerAddress,
    isFrozen: options.isFrozen ?? false,
    expiry: options.expiry ?? 0n,
    seed: options.seed,
    data: options.data,
  });
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
