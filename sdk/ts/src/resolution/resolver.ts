import { Context, PublicKey } from '@metaplex-foundation/umi';
import {
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
} from './constants';
import { ResolutionInputError } from './errors';
import { DomaForwardResolver } from './forwardResolver';
import {
  createRpcRecordAccountProvider,
  type RecordAccountProvider,
} from './provider';
import { SrsReverseResolver } from './reverseResolver';

type ResolutionContext = Pick<Context, 'rpc'>;

interface BaseResolveInput {
  context?: ResolutionContext;
  provider?: RecordAccountProvider;
  domaClassAddress?: PublicKey;
  reverseClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
}

function getProvider(
  context: ResolutionContext | undefined,
  provider: RecordAccountProvider | undefined
): RecordAccountProvider {
  if (provider) {
    return provider;
  }

  if (!context) {
    throw new ResolutionInputError(
      'context is required when provider is not provided'
    );
  }

  return createRpcRecordAccountProvider(context);
}

function createForwardResolver(
  input: BaseResolveInput,
  provider: RecordAccountProvider
): DomaForwardResolver {
  return new DomaForwardResolver({
    provider,
    domaClassAddress:
      input.domaClassAddress ??
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
  });
}

function createReverseResolver(
  input: BaseResolveInput & { verifyReverseWithForward?: boolean },
  provider: RecordAccountProvider
): SrsReverseResolver {
  const forwardResolver = createForwardResolver(input, provider);
  return new SrsReverseResolver({
    provider,
    reverseClassAddress:
      input.reverseClassAddress ??
      SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward: input.verifyReverseWithForward,
    forwardVerifier: forwardResolver,
  });
}

export interface ResolveInput extends BaseResolveInput {
  name: string;
  chainCaip2?: string;
}

export async function resolve(input: ResolveInput): Promise<string | null> {
  const provider = getProvider(input.context, input.provider);
  const forwardResolver = createForwardResolver(input, provider);

  return forwardResolver.resolve(input.name, input.chainCaip2);
}

export interface ResolveRecordInput extends BaseResolveInput {
  name: string;
  recordKey: string;
}

export async function resolveRecord(
  input: ResolveRecordInput
): Promise<string | null> {
  const provider = getProvider(input.context, input.provider);
  const forwardResolver = createForwardResolver(input, provider);

  return forwardResolver.resolveRecord(input.name, input.recordKey);
}

export interface ResolveRecordsInput extends BaseResolveInput {
  name: string;
  recordKey: string;
}

export async function resolveRecords(
  input: ResolveRecordsInput
): Promise<string[]> {
  const provider = getProvider(input.context, input.provider);
  const forwardResolver = createForwardResolver(input, provider);

  return forwardResolver.resolveRecords(input.name, input.recordKey);
}

export interface ReverseResolveInput extends BaseResolveInput {
  wallet: string;
  verifyReverseWithForward?: boolean;
}

export async function reverseResolve(
  input: ReverseResolveInput
): Promise<string | null> {
  const provider = getProvider(input.context, input.provider);
  const resolver = createReverseResolver(input, provider);

  return resolver.reverseResolve(input.wallet);
}

export interface ReverseResolveAllInput extends BaseResolveInput {
  wallet: string;
  verifyReverseWithForward?: boolean;
}

export async function reverseResolveAll(
  input: ReverseResolveAllInput
): Promise<string[]> {
  const provider = getProvider(input.context, input.provider);
  const resolver = createReverseResolver(input, provider);

  return resolver.reverseResolveAll(input.wallet);
}

export interface BatchReverseResolveInput extends BaseResolveInput {
  wallets: readonly string[];
  verifyReverseWithForward?: boolean;
}

export async function batchReverseResolve(
  input: BatchReverseResolveInput
): Promise<Array<string | null>> {
  const provider = getProvider(input.context, input.provider);
  const resolver = createReverseResolver(input, provider);

  return resolver.batchReverseResolve(input.wallets);
}

export interface BatchReverseResolveAllInput extends BaseResolveInput {
  wallets: readonly string[];
  verifyReverseWithForward?: boolean;
}

export async function batchReverseResolveAll(
  input: BatchReverseResolveAllInput
): Promise<string[][]> {
  const provider = getProvider(input.context, input.provider);
  const resolver = createReverseResolver(input, provider);

  return resolver.batchReverseResolveAll(input.wallets);
}
