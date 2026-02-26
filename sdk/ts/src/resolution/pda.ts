import { PublicKey, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
import { PublicKey as Web3PublicKey } from '@solana/web3.js';
import { SRS_DEFAULT_PROGRAM_ID, SRS_RECORD_PDA_SEED } from './constants';
import { ResolutionInputError } from './errors';

export function findRecordPda(
  classAddress: PublicKey,
  tokenId: Uint8Array,
  programId: PublicKey = SRS_DEFAULT_PROGRAM_ID
): [PublicKey, number] {
  if (tokenId.length === 0 || tokenId.length > 32) {
    throw new ResolutionInputError(
      `tokenId must be in range [1, 32], got ${tokenId.length}`
    );
  }

  const [recordPda, bump] = Web3PublicKey.findProgramAddressSync(
    [
      Buffer.from(SRS_RECORD_PDA_SEED),
      Buffer.from(publicKeyBytes(classAddress)),
      Buffer.from(tokenId),
    ],
    new Web3PublicKey(programId)
  );

  return [publicKey(recordPda.toBase58()), bump];
}

export function reverseRecordSeed(wallet: string): Uint8Array {
  return publicKeyBytes(wallet);
}
