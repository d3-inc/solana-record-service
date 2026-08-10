/** Thrown when a CAIP-2 chain identifier does not match the expected format. */
export class ResolutionInvalidCAIP2Error extends Error {
  constructor(caip2: string) {
    super(`Invalid CAIP-2 format: ${caip2}`);
    this.name = 'ResolutionInvalidCAIP2Error';
  }
}

/** Thrown when a domain name fails IDNA/UTS#46 normalization. */
export class ResolutionInvalidNameError extends Error {
  constructor(name: string) {
    super(`Invalid name: ${name}`);
    this.name = 'ResolutionInvalidNameError';
  }
}

/** Thrown when an on-chain record account contains malformed or unrecognized data. */
export class SrsRecordDecodeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SrsRecordDecodeError';
  }
}
