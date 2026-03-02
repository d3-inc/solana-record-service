import { PublicKey } from '@solana/web3.js';
import { DomaForwardResolver } from './forwardResolver';
import {
  createRawRecordAccountProvider,
  type RecordAccountProviderContext,
} from './provider';
import { SrsReverseResolver } from './reverseResolver';

export interface ResolveInput {
  context: RecordAccountProviderContext;
  name: string;
  chainCaip2?: string;
  domaClassAddress?: PublicKey;
  // Backward-compatible alias for older call sites.
  forwardClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
}

export interface ReverseResolveInput {
  context: RecordAccountProviderContext;
  wallet: string;
  reverseClassAddress?: PublicKey;
  domaClassAddress?: PublicKey;
  // Backward-compatible alias for older call sites.
  forwardClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
  verifyReverseWithForward?: boolean;
}

export interface BatchReverseResolveInput {
  context: RecordAccountProviderContext;
  wallets: readonly string[];
  reverseClassAddress?: PublicKey;
  domaClassAddress?: PublicKey;
  // Backward-compatible alias for older call sites.
  forwardClassAddress?: PublicKey;
  programId?: PublicKey;
  defaultChainCaip2?: string;
  verifyReverseWithForward?: boolean;
}

function resolveDomaClassAddress(input: {
  domaClassAddress?: PublicKey;
  forwardClassAddress?: PublicKey;
}): PublicKey | undefined {
  return input.domaClassAddress ?? input.forwardClassAddress;
}

export async function resolve(input: ResolveInput): Promise<string | null> {
  const provider = createRawRecordAccountProvider(input.context);
  const forwardResolver = new DomaForwardResolver({
    provider,
    domaClassAddress: resolveDomaClassAddress(input),
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
  });

  return forwardResolver.resolve(input.name, input.chainCaip2);
}

export async function reverseResolve(
  input: ReverseResolveInput
): Promise<string | null> {
  const provider = createRawRecordAccountProvider(input.context);
  const verifyReverseWithForward = input.verifyReverseWithForward ?? true;

  const forwardResolver = verifyReverseWithForward
    ? new DomaForwardResolver({
        provider,
        domaClassAddress: resolveDomaClassAddress(input),
        programId: input.programId,
        defaultChainCaip2: input.defaultChainCaip2,
      })
    : undefined;

  const reverseResolver = new SrsReverseResolver({
    provider,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward,
    forwardVerifier: forwardResolver,
  });

  return reverseResolver.reverseResolve(input.wallet);
}

export async function batchReverseResolve(
  input: BatchReverseResolveInput
): Promise<Array<string | null>> {
  const provider = createRawRecordAccountProvider(input.context);
  const verifyReverseWithForward = input.verifyReverseWithForward ?? true;

  const forwardResolver = verifyReverseWithForward
    ? new DomaForwardResolver({
        provider,
        domaClassAddress: resolveDomaClassAddress(input),
        programId: input.programId,
        defaultChainCaip2: input.defaultChainCaip2,
      })
    : undefined;

  const reverseResolver = new SrsReverseResolver({
    provider,
    reverseClassAddress: input.reverseClassAddress,
    programId: input.programId,
    defaultChainCaip2: input.defaultChainCaip2,
    verifyReverseWithForward,
    forwardVerifier: forwardResolver,
  });

  return reverseResolver.batchReverseResolve(input.wallets);
}
