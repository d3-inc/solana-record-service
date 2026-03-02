import { PublicKey } from '@solana/web3.js';

export const SRS_DEFAULT_PROGRAM_ID = new PublicKey(
  'srsUi2TVUUCyGcZdopxJauk8ZBzgAaHHZCVUhm5ifPa'
);

// SDK-level defaults used by resolution helpers and resolver constructors.
export const SRS_DEFAULT_DOMA_CLASS_ADDRESS = new PublicKey(
  'p2Yicb86aZig616Eav2VWG9vuXR5mEqhtzshZYBxzsV'
);

export const SRS_DEFAULT_REVERSE_CLASS_ADDRESS = new PublicKey(
  'swqrv48gsrwpBFbftEwnP2vB4jckpvfGJfXkwaniLCC'
);

export const SRS_RECORD_PDA_SEED = Buffer.from('record', 'utf8');
export const SRS_RECORD_DISCRIMINATOR = 2;
export const SRS_RECORD_TUPLE_VERSION = 1;
export const DEFAULT_SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
