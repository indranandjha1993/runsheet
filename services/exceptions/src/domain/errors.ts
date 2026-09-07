export type DomainErrorCode =
  | "invalid_input"
  | "already_exists"
  | "not_found"
  | "tenant_required"
  | "transition_not_allowed";

const STATUS: Record<DomainErrorCode, number> = {
  invalid_input: 400,
  tenant_required: 400,
  transition_not_allowed: 409,
  already_exists: 409,
  not_found: 404,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
