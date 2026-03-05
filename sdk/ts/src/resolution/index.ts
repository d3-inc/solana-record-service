export {
  DomaForwardResolver,
  type DomaForwardResolverConfig,
} from './forwardResolver';
export {
  SrsReverseResolver,
  type ForwardNameResolver,
  type SrsReverseResolverConfig,
} from './reverseResolver';
export {
  resolve,
  resolveRecord,
  resolveRecords,
  reverseResolve,
  reverseResolveAll,
  batchReverseResolve,
  batchReverseResolveAll,
  type ResolveInput,
  type ResolveRecordInput,
  type ResolveRecordsInput,
  type ReverseResolveInput,
  type ReverseResolveAllInput,
  type BatchReverseResolveInput,
  type BatchReverseResolveAllInput,
} from './resolver';
export {
  createRpcRecordAccountProvider,
  type RecordAccountProvider,
} from './provider';

export {
  serializeResolutionTuples,
  parseResolutionTuples,
  type ResolutionTuple,
} from './tupleCodec';

export { decodeSrsRecord, type DecodedSrsRecord } from './recordDecoder';
export { namehash, normalizeName } from './namehash';
export { findRecordPda, reverseRecordSeed } from './pda';
export {
  parseWalletTuple,
  normalizeChainCaip2,
  type ParsedWalletValue,
} from './caip';
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
