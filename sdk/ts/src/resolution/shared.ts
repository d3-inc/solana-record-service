import { keccak_256 } from '@noble/hashes/sha3';
import {
  addCodecSizePrefix,
  getArrayCodec,
  getTupleCodec,
  getU32Codec,
  getUtf8Codec,
  transformCodec,
} from '@solana/kit';

import { ResolutionInputError, SrsRecordDecodeError } from './errors';

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const CAIP10_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/;

export function validateAndNormalizeCAIP2(caip2: string): string {
  const trimmed = caip2.trim();
  if (!CAIP2_PATTERN.test(trimmed)) {
    throw new ResolutionInputError(`Invalid CAIP-2: ${caip2}`);
  }

  return trimmed;
}

export function validateAndNormalizeCAIP10(caip10: string): string {
  const trimmed = caip10.trim();
  if (!CAIP10_PATTERN.test(trimmed)) {
    throw new ResolutionInputError(`Invalid CAIP-10: ${caip10}`);
  }

  return trimmed;
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ResolutionInputError('Name cannot be empty');
  }

  // Loaded dynamically, as it's an optional peer dependency
  const tr46 = require('tr46');

  const asciiName = tr46.toASCII(trimmed, {
    checkBidi: true,
    checkHyphens: true,
    useSTD3ASCIIRules: true,
    verifyDNSLength: true,
    transitionalProcessing: false,
  });

  if (!asciiName) {
    throw new ResolutionInputError(`Invalid name: ${name}`);
  }

  return asciiName;
}

export function namehash(name: string): Uint8Array {
  const normalized = normalizeName(name);

  const labels = normalized.split('.').filter((label) => label.length > 0);
  let node = new Uint8Array(32);

  const textEncoder = new TextEncoder();

  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const labelBytes = textEncoder.encode(labels[i]);
    const labelHash = Uint8Array.from(keccak_256(labelBytes));
    node = Uint8Array.from(keccak_256(concat32(node, labelHash)));
  }

  return node;
}

function concat32(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  out.set(left, 0);
  out.set(right, 32);
  return out;
}

export type Tuples = Array<readonly [string, string]>;

export function serializeRecordData(
  data: Tuples,
): Uint8Array {
  return Uint8Array.from(getRecordDataCodec().encode(data));
}

export function deserializeRecordData(
  data: Uint8Array,
): Tuples {
  try {
    return getRecordDataCodec().decode(data);
  } catch (error) {
    throw new SrsRecordDecodeError('Failed to decode SRS record data', error);
  }
}

// Borsh: u32 LE length prefix + UTF-8 bytes
function getBorshStringCodec() {
  return addCodecSizePrefix(getUtf8Codec(), getU32Codec());
}

// Borsh layout: u32 (outer array len) -> u32 (entry count) -> [u32+key, u32+value]*
function getRecordDataCodec() {
  const s = getBorshStringCodec();
  const kvPairCodec = getTupleCodec([s, s] as const);
  const mapEntriesCodec = getArrayCodec(kvPairCodec);
  return mapEntriesCodec;
}

