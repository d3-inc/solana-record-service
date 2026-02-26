import { Context, PublicKey, RpcGetAccountOptions } from '@metaplex-foundation/umi';
import { safeFetchRecord, type Record } from '../accounts';

export interface RecordAccountProvider {
  fetchRecord(recordPda: PublicKey): Promise<Record | null>;
}

export type RawRecordAccountProvider = RecordAccountProvider;
export class RpcRecordAccountProvider implements RecordAccountProvider {
  private readonly context: Pick<Context, 'rpc'>;
  private readonly options: RpcGetAccountOptions | undefined;

  constructor(
    context: Pick<Context, 'rpc'>,
    options?: RpcGetAccountOptions
  ) {
    this.context = context;
    this.options = options;
  }

  async fetchRecord(recordPda: PublicKey): Promise<Record | null> {
    return safeFetchRecord(this.context, recordPda, this.options);
  }
}

// Backward-compatible alias for earlier naming.
export class RpcRawRecordAccountProvider extends RpcRecordAccountProvider {}
