import { Context, PublicKey, RpcGetAccountOptions } from '@metaplex-foundation/umi';
import { safeFetchRecord, type Record } from '../accounts';

export interface RecordAccountProvider {
  fetchRecord(recordPda: PublicKey): Promise<Record | null>;
}

export function createRpcRecordAccountProvider(
  context: Pick<Context, 'rpc'>,
  options?: RpcGetAccountOptions
): RecordAccountProvider {
  return {
    fetchRecord(recordPda: PublicKey): Promise<Record | null> {
      return safeFetchRecord(context, recordPda, options);
    },
  };
}
