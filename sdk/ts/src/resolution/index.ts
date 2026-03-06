export {
  resolve,
  resolveRecord,
  resolveRecords,
  type ResolveInput,
  type ResolveTextRecordInput,
} from './resolve';
export {
  reverseResolve,
  batchReverseResolve,
  type ReverseResolveInput,
  type ReverseResolveOptions,
  type BatchReverseResolveInput,
} from './reverseResolve';

export {
  serializeResolutionTuples,
  parseResolutionTuples,
  type ResolutionTuple,
} from './tupleCodec';

export { namehash, normalizeName } from './namehash';
export { findRecordPda, reverseRecordSeed, type PdaContext } from './pda';
export {
  parseWalletTuple,
  normalizeChainCaip2,
  type ParsedWalletValue,
} from './caip';
export { type ResolutionContext, type ResolutionOptions } from './shared';
export {
  ResolutionCodecError,
  ResolutionInputError,
  SrsRecordDecodeError,
} from './errors';
export {
  DEFAULT_SOLANA_CAIP2,
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_PROGRAM_ID,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
  SRS_RECORD_PDA_SEED,
} from './constants';
