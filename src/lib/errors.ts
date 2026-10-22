// Three distinct failures, because the HTTP status they map to is a security
// decision, not a formatting one.
//
//   Unauthenticated -> 401. No identity at all.
//   NotFound        -> 404. Identity exists but has no membership in the
//                      tenant, OR the row is not in this tenant. Deliberately
//                      NOT 403: a 403 would confirm that tenant B's project id
//                      exists, which hands tenant A a valid id to probe.
//   Forbidden       -> 403. Identity IS a member of this tenant but the role
//                      is too low. Safe to be explicit: they can already see
//                      the tenant, so nothing new leaks.
export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message = "You are not signed in.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Your role does not allow this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>, message = "Invalid input.") {
    super(message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function statusOf(e: unknown): number {
  if (
    e instanceof UnauthenticatedError ||
    e instanceof NotFoundError ||
    e instanceof ForbiddenError ||
    e instanceof ValidationError
  ) {
    return e.status;
  }
  return 500;
}
