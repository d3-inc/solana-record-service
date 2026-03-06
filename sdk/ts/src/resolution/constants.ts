import { PublicKey, publicKey } from '@metaplex-foundation/umi';
import { SOLANA_RECORD_SERVICE_PROGRAM_ID } from '../programs';

const textEncoder = new TextEncoder();

export const SRS_DEFAULT_PROGRAM_ID: PublicKey =
  SOLANA_RECORD_SERVICE_PROGRAM_ID;
export const SRS_RECORD_PDA_SEED = textEncoder.encode('record');
export const SRS_RECORD_DISCRIMINATOR = 2;
export const SRS_RECORD_TUPLE_VERSION = 1;
export const DEFAULT_SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SRS_DEFAULT_DOMA_CLASS_ADDRESS: PublicKey = publicKey(
  'CCcpHtBokXDR9PimwAKsxyspDoVtXxXjAJTBSsC1jHYY'
);
export const SRS_DEFAULT_REVERSE_CLASS_ADDRESS: PublicKey = publicKey(
  '6icKiynEybk18pNMSkNnsJwDxokhtYh2abReKnGc4CNT'
);
