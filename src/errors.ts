export class MigratorError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'MigratorError';
  }
}

export class ConfigError extends MigratorError {
  override name = 'ConfigError';
}

export class ExportParseError extends MigratorError {
  override name = 'ExportParseError';
}

export class APIError extends MigratorError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: Error,
  ) {
    super(message, cause);
    this.name = 'APIError';
  }
}

export class AuthError extends MigratorError {
  override name = 'AuthError';
}

export class StateError extends MigratorError {
  override name = 'StateError';
}

export class RateLimitError extends APIError {
  override name = 'RateLimitError';

  constructor(message: string, cause?: Error) {
    super(message, 429, cause);
  }
}
