import {
  getRecordAccountDataSerializer,
  type RecordAccountData,
} from '../accounts';
import { SrsRecordDecodeError } from './errors';

export type DecodedSrsRecord = RecordAccountData;

export function decodeSrsRecord(rawAccountData: Uint8Array): DecodedSrsRecord {
  try {
    const serializer = getRecordAccountDataSerializer();
    const [decoded, offset] = serializer.deserialize(rawAccountData);
    if (offset !== rawAccountData.length) {
      throw new SrsRecordDecodeError('Trailing bytes after SRS record payload');
    }
    return decoded;
  } catch (error) {
    if (error instanceof SrsRecordDecodeError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new SrsRecordDecodeError(message);
  }
}
