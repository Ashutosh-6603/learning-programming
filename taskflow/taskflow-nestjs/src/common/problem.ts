export interface FieldError {
  field: string;
  message: string;
}

const TITLES = {
  'bad-request': 'Bad request',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  'not-found': 'Not found',
  'method-not-allowed': 'Method not allowed',
  conflict: 'Conflict',
  'payload-too-large': 'Payload too large',
  'unsupported-media-type': 'Unsupported media type',
  'validation-error': 'Validation failed',
  'rate-limited': 'Too many requests',
  internal: 'Internal server error',
} as const;

export type ProblemSlug = keyof typeof TITLES;

const STATUS: Record<ProblemSlug, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  'payload-too-large': 413,
  'unsupported-media-type': 415,
  'validation-error': 422,
  'rate-limited': 429,
  internal: 500,
};

export const PROBLEM_TYPE_BASE = 'https://taskflow.example/problems/';

/** An error that maps 1:1 to an RFC 9457 problem response. */
export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;

  constructor(
    readonly slug: ProblemSlug,
    detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? TITLES[slug]);
    this.name = 'ProblemError';
    this.status = STATUS[slug];
    this.title = TITLES[slug];
  }
}

export const notFound = (what = 'Resource') => new ProblemError('not-found', `${what} not found`);
export const forbidden = (detail = 'Your role does not allow this action') =>
  new ProblemError('forbidden', detail);
export const conflict = (detail: string) => new ProblemError('conflict', detail);
export const unauthorized = (detail = 'Authentication required') =>
  new ProblemError('unauthorized', detail);
export const invalid = (field: string, message: string) =>
  new ProblemError('validation-error', 'The request contains invalid fields', [{ field, message }]);
