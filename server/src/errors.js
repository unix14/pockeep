export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.statusCode = status;
    this.code = code;
  }
}
export const badRequest = (msg, code = 'bad_request') => new HttpError(400, code, msg);
export const notFound = (msg = 'לא נמצא') => new HttpError(404, 'not_found', msg);
export const conflict = (msg, code = 'conflict') => new HttpError(409, code, msg);
