import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { webcrypto } from 'node:crypto';
import { SRS_DEFAULT_PROGRAM_ID, SRS_RECORD_PDA_SEED } from './constants';
import { ResolutionInputError } from './errors';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

export async function findRecordPda(
  classAddress: PublicKey,
  tokenId: Uint8Array,
  programId: PublicKey = SRS_DEFAULT_PROGRAM_ID
): Promise<[PublicKey, number]> {
  if (tokenId.length === 0 || tokenId.length > 32) {
    throw new ResolutionInputError(
      `tokenId must be in range [1, 32], got ${tokenId.length}`
    );
  }

  const [recordPda, bump] = await getProgramDerivedAddress({
    programAddress: programId as unknown as Address,
    seeds: [SRS_RECORD_PDA_SEED, publicKeyBytes(classAddress), tokenId],
  });

  return [publicKey(recordPda), bump];
}

export function reverseRecordSeed(wallet: string): Uint8Array {
  return publicKeyBytes(wallet);
}
