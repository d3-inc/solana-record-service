import assert from 'node:assert/strict';
import * as program from '../sdk/ts/src/index';

describe('sdk', () => {
  it('exports the expected SRS program id', () => {
    assert.equal(
      program.SOLANA_RECORD_SERVICE_PROGRAM_ID,
      'srsUi2TVUUCyGcZdopxJauk8ZBzgAaHHZCVUhm5ifPa'
    );
  });

  it('encodes createClass instruction data with discriminator 0', () => {
    const encoded = program.getCreateClassInstructionDataSerializer().serialize({
      isPermissioned: false,
      isFrozen: false,
      name: 'twitter',
      metadata: 'test',
    });

    assert.equal(encoded[0], 0);
    assert.ok(encoded.length > 4);
  });
});
