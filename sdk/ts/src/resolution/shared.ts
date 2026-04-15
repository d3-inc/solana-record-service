import { keccak_256 } from '@noble/hashes/sha3';
import { Context, PublicKey, publicKeyBytes } from '@metaplex-foundation/umi';

import { SOLANA_RECORD_SERVICE_PROGRAM_ID } from '../generated/programs';

import { ResolutionInputError } from './errors';

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

export function validateAndNormalizeCAIP2(caip2: string): string {
  const trimmed = caip2.trim();
  if (!CAIP2_PATTERN.test(trimmed)) {
    throw new ResolutionInputError(`Invalid CAIP-2: ${caip2}`);
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

export function findRecordPda(
  context: Pick<Context, 'eddsa' | 'programs'>,
  classAddress: PublicKey,
  recordSeed: Uint8Array,
): [PublicKey, number] {

   const programId = context.programs.getPublicKey(
    'solanaRecordService',
    SOLANA_RECORD_SERVICE_PROGRAM_ID
  );

  const textEncoder = new TextEncoder();
  const SRS_RECORD_PDA_SEED = textEncoder.encode('record');

  return context.eddsa.findPda(programId, [
    SRS_RECORD_PDA_SEED,
    publicKeyBytes(classAddress),
    recordSeed,
  ]);
}

function concat32(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  out.set(left, 0);
  out.set(right, 32);
  return out;
}