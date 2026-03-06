import { Context, PublicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { SRS_DEFAULT_PROGRAM_ID, SRS_RECORD_PDA_SEED } from './constants';
import { ResolutionInputError } from './errors';

export type PdaContext = Pick<Context, 'eddsa'>;

export function findRecordPda(
  context: PdaContext,
  classAddress: PublicKey,
  tokenId: Uint8Array,
  programId: PublicKey = SRS_DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  if (tokenId.length === 0 || tokenId.length > 32) {
    throw new ResolutionInputError(
      `tokenId must be in range [1, 32], got ${tokenId.length}`
    );
  }

  return context.eddsa.findPda(programId, [
    SRS_RECORD_PDA_SEED,
    publicKeyBytes(classAddress),
    tokenId,
  ]);
}

export function reverseRecordSeed(wallet: string): Uint8Array {
  return publicKeyBytes(wallet);
}
