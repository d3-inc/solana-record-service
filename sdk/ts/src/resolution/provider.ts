import { Connection, PublicKey } from '@solana/web3.js';
import type {
  Context as UmiContext,
  PublicKey as UmiPublicKey,
} from '@metaplex-foundation/umi';

export interface RawRecordAccountProvider {
  fetchRawRecordAccount(recordPda: PublicKey): Promise<Uint8Array | null>;
}

export type UmiRecordAccountProviderContext = Pick<UmiContext, 'rpc'>;
export type RecordAccountProviderContext =
  | RawRecordAccountProvider
  | Connection
  | UmiRecordAccountProviderContext;

export class RpcRawRecordAccountProvider implements RawRecordAccountProvider {
  private readonly connection: Connection;
  private readonly commitment:
    | 'processed'
    | 'confirmed'
    | 'finalized'
    | undefined;

  constructor(
    connection: Connection,
    commitment?: 'processed' | 'confirmed' | 'finalized'
  ) {
    this.connection = connection;
    this.commitment = commitment;
  }

  async fetchRawRecordAccount(recordPda: PublicKey): Promise<Uint8Array | null> {
    const account = await this.connection.getAccountInfo(recordPda, this.commitment);
    return account?.data ?? null;
  }
}

export class UmiRawRecordAccountProvider implements RawRecordAccountProvider {
  private readonly context: UmiRecordAccountProviderContext;

  constructor(context: UmiRecordAccountProviderContext) {
    this.context = context;
  }

  async fetchRawRecordAccount(recordPda: PublicKey): Promise<Uint8Array | null> {
    const maybeAccount = await this.context.rpc.getAccount(
      recordPda.toBase58() as UmiPublicKey
    );
    return maybeAccount.exists ? maybeAccount.data : null;
  }
}

function isRawRecordAccountProvider(
  context: RecordAccountProviderContext
): context is RawRecordAccountProvider {
  return typeof (context as RawRecordAccountProvider).fetchRawRecordAccount === 'function';
}

function isWeb3Connection(
  context: RecordAccountProviderContext
): context is Connection {
  return typeof (context as Connection).getAccountInfo === 'function';
}

function isUmiContext(
  context: RecordAccountProviderContext
): context is UmiRecordAccountProviderContext {
  return (
    typeof (context as UmiRecordAccountProviderContext).rpc === 'object' &&
    typeof (context as UmiRecordAccountProviderContext).rpc.getAccount === 'function'
  );
}

export function createRawRecordAccountProvider(
  context: RecordAccountProviderContext
): RawRecordAccountProvider {
  if (isRawRecordAccountProvider(context)) {
    return context;
  }

  if (isWeb3Connection(context)) {
    return new RpcRawRecordAccountProvider(context);
  }

  if (isUmiContext(context)) {
    return new UmiRawRecordAccountProvider(context);
  }

  throw new TypeError('Unsupported record account provider context');
}
