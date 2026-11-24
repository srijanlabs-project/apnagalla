export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = 'Please log in again', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const tooMany = (message: string, retryAfterSeconds: number) =>
  new HttpError(429, 'rate_limited', message, { 'retry-after': String(retryAfterSeconds) });
