import { Context, PublicKey } from '@metaplex-foundation/umi';
import {
  SRS_DEFAULT_DOMA_CLASS_ADDRESS,
  SRS_DEFAULT_REVERSE_CLASS_ADDRESS,
} from './constants';
import { ResolutionInputError } from './errors';
import {
  DomaForwardResolver,
  type DomaForwardResolverConfig,
} from './forwardResolver';
import {
  type RecordAccountProvider,
  RpcRecordAccountProvider,
} from './provider';
import {
  SrsReverseResolver,
  type SrsReverseResolverConfig,
} from './reverseResolver';

export interface DomaSrsResolverConfig {
  provider: DomaForwardResolverConfig['provider'];
  domaClassAddress?: PublicKey;
  reverseClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
  verifyReverseWithForward?: boolean;
}

export class DomaSrsResolver {
  private readonly forwardResolver: DomaForwardResolver;
  private readonly reverseResolver: SrsReverseResolver;

  constructor(config: DomaSrsResolverConfig) {
    const domaClassAddress =
      config.domaClassAddress ??
      SRS_DEFAULT_DOMA_CLASS_ADDRESS;
    const reverseClassAddress =
      config.reverseClassAddress ?? SRS_DEFAULT_REVERSE_CLASS_ADDRESS;

    this.forwardResolver = new DomaForwardResolver({
      provider: config.provider,
      domaClassAddress,
      programId: config.programId,
      defaultChainCaip2: config.defaultChainCaip2,
    });

    const reverseConfig: SrsReverseResolverConfig = {
      provider: config.provider,
      reverseClassAddress,
      programId: config.programId,
      defaultChainCaip2: config.defaultChainCaip2,
      verifyReverseWithForward: config.verifyReverseWithForward,
      forwardVerifier: this.forwardResolver,
    };

    this.reverseResolver = new SrsReverseResolver(reverseConfig);
  }

  async resolve(name: string, chainCaip2?: string): Promise<string | null> {
    return this.forwardResolver.resolve(name, chainCaip2);
  }

  async resolveRecord(name: string, recordKey: string): Promise<string | null> {
    return this.forwardResolver.resolveRecord(name, recordKey);
  }

  async resolveRecords(name: string, recordKey: string): Promise<string[]> {
    return this.forwardResolver.resolveRecords(name, recordKey);
  }

  async reverseResolve(wallet: string): Promise<string | null> {
    return this.reverseResolver.reverseResolve(wallet);
  }

  async reverseResolveAll(wallet: string): Promise<string[]> {
    return this.reverseResolver.reverseResolveAll(wallet);
  }

  async batchReverseResolve(
    wallets: readonly string[]
  ): Promise<Array<string | null>> {
    return this.reverseResolver.batchReverseResolve(wallets);
  }

  async batchReverseResolveAll(wallets: readonly string[]): Promise<string[][]> {
    return this.reverseResolver.batchReverseResolveAll(wallets);
  }
}

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

  return new RpcRecordAccountProvider(context);
}

export interface ResolveInput extends BaseResolveInput {
  name: string;
  chainCaip2?: string;
}

export async function resolve(input: ResolveInput): Promise<string | null> {
  const provider = getProvider(input.context, input.provider);
  const forwardResolver = new DomaForwardResolver({
    provider,
    domaClassAddress:
      input.domaClassAddress ??
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
  });

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
  const forwardResolver = new DomaForwardResolver({
    provider,
    domaClassAddress:
      input.domaClassAddress ??
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
  });

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
  const forwardResolver = new DomaForwardResolver({
    provider,
    domaClassAddress:
      input.domaClassAddress ??
      SRS_DEFAULT_DOMA_CLASS_ADDRESS,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
  });

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
  const resolver = new DomaSrsResolver({
    provider,
    domaClassAddress: input.domaClassAddress,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward: input.verifyReverseWithForward,
  });

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
  const resolver = new DomaSrsResolver({
    provider,
    domaClassAddress: input.domaClassAddress,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward: input.verifyReverseWithForward,
  });

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
  const resolver = new DomaSrsResolver({
    provider,
    domaClassAddress: input.domaClassAddress,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward: input.verifyReverseWithForward,
  });

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
  const resolver = new DomaSrsResolver({
    provider,
    domaClassAddress: input.domaClassAddress,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward: input.verifyReverseWithForward,
  });

  return resolver.batchReverseResolveAll(input.wallets);
}
