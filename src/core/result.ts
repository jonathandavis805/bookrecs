// Every core operation that can be refused returns a Result. The status is the
// HTTP status the API should answer with, so routes never have to guess it
// from the message text.
export interface Failure {
  ok: false;
  error: string;
  status: 400 | 403 | 404;
}

export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

export const fail = (error: string): Failure => ({ ok: false, error, status: 400 });
export const forbidden = (error: string): Failure => ({ ok: false, error, status: 403 });
export const notFound = (error: string): Failure => ({ ok: false, error, status: 404 });
