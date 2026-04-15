export class ResolutionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionInputError';
  }
}

export class SrsRecordDecodeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SrsRecordDecodeError';
  }
}