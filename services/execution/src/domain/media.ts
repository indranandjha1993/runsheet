import { DomainError } from "./errors.js";

const SHA256 = /^[0-9a-f]{64}$/;
// A proof is a photograph or a signature taken on a handset over a bad link. Anything past
// this is not a proof, and a device that sends it will never finish the upload.
const MAX_BYTES = 25 * 1024 * 1024;
const OVERDUE_MS = 24 * 3_600_000;

export interface MediaRecord {
  readonly mediaId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: string;
  readonly declaredAt: Date;
  readonly uploadedAt?: Date;
}

export interface DeclareMediaCommand {
  readonly mediaId: string;
  readonly tenantId: string;
  readonly eventId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: string;
  readonly at: Date;
}

export function declare(command: DeclareMediaCommand): MediaRecord {
  if (!SHA256.test(command.sha256)) {
    throw new DomainError("invalid_input", "that is not a sha256 hash");
  }
  if (command.bytes <= 0) {
    throw new DomainError("invalid_input", "declared media has no bytes");
  }
  if (command.bytes > MAX_BYTES) {
    throw new DomainError("invalid_input", "that file is too large for a proof");
  }

  return {
    mediaId: command.mediaId,
    tenantId: command.tenantId,
    eventId: command.eventId,
    sha256: command.sha256,
    bytes: command.bytes,
    kind: command.kind,
    declaredAt: command.at,
  };
}

// Content is addressed by its hash, so an upload is idempotent and a device on a bad link may
// retry as often as it likes without anything changing.
export function accept(record: MediaRecord, sha256: string, at: Date): MediaRecord {
  if (sha256 !== record.sha256) {
    throw new DomainError("invalid_input", "those bytes are not what was declared");
  }
  if (record.uploadedAt !== undefined) return record;
  return { ...record, uploadedAt: at };
}

// A delivery is never reversed for a missing photograph. It is raised for somebody to chase.
export function overdue(record: MediaRecord, now: Date): boolean {
  if (record.uploadedAt !== undefined) return false;
  return now.getTime() - record.declaredAt.getTime() > OVERDUE_MS;
}
