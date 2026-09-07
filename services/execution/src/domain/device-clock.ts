// A handset's wall clock is wrong often enough that it cannot be believed, but the monotonic
// counter since boot survives somebody setting the date by hand. Where the boot is unchanged
// since the last contact, that counter is what the server trusts.

const CLOSE_ENOUGH_MS = 120_000;
const RECONSTRUCTED_MS = 15 * 60_000;

export type ClockFlag =
  "time_reconstructed" | "device_clock_unreliable" | "time_estimated" | "time_clamped";

export interface Handshake {
  readonly deviceBootId: string;
  readonly monotonicNowMs: number;
  readonly offsetMs: number;
  /** The boot the last anchor was measured against. A different one invalidates the counter. */
  readonly anchorBootId: string;
  readonly serverReceivedAt: Date;
}

export interface DeviceEntry {
  readonly deviceSequence: number;
  readonly occurredAtDevice: Date;
  readonly monotonicMs: number;
}

export interface ReconciledTime {
  readonly deviceSequence: number;
  readonly occurredAt: Date;
  readonly confidence: number;
  readonly flags: readonly ClockFlag[];
}

interface Reading {
  readonly at: number;
  readonly confidence: number;
  readonly flags: ClockFlag[];
}

function anchored(handshake: Handshake, entry: DeviceEntry): number {
  return handshake.serverReceivedAt.getTime() - (handshake.monotonicNowMs - entry.monotonicMs);
}

function fromAnchor(handshake: Handshake, entry: DeviceEntry): Reading {
  const trusted = anchored(handshake, entry);
  const drift = Math.abs(trusted - (entry.occurredAtDevice.getTime() + handshake.offsetMs));

  if (drift <= CLOSE_ENOUGH_MS) return { at: trusted, confidence: 1, flags: [] };
  if (drift <= RECONSTRUCTED_MS) {
    return { at: trusted, confidence: 0.8, flags: ["time_reconstructed"] };
  }
  return { at: trusted, confidence: 0.6, flags: ["device_clock_unreliable"] };
}

// With no usable counter there is nothing to anchor to, so the batch is spread evenly across the
// window that ends when the server received it. The order is right even though the times are not.
function estimated(handshake: Handshake, entries: readonly DeviceEntry[], index: number): Reading {
  const receivedAt = handshake.serverReceivedAt.getTime();
  const step = 1000;
  const at = receivedAt - (entries.length - 1 - index) * step;
  return { at, confidence: 0.4, flags: ["time_estimated"] };
}

function clampToServer(reading: Reading, receivedAt: number): Reading {
  if (reading.at <= receivedAt) return reading;
  return {
    at: receivedAt,
    confidence: reading.confidence,
    flags: [...reading.flags, "time_clamped"],
  };
}

// Two taps cannot happen out of order on one device, so a later entry never carries an earlier
// time however badly the clock behaved.
function keepMoving(reading: Reading, previous: number | undefined): Reading {
  if (previous === undefined || reading.at > previous) return reading;
  return {
    at: previous + 1,
    confidence: reading.confidence,
    flags: [...reading.flags, "time_clamped"],
  };
}

// The counter is meant to be monotonic. If it is not, the device is lying or broken, and the
// batch is treated the same as one from a device that rebooted.
function countsForward(entries: readonly DeviceEntry[]): boolean {
  return entries.every(
    (entry, index) => index === 0 || entry.monotonicMs >= (entries[index - 1]?.monotonicMs ?? 0),
  );
}

export function reconcile(handshake: Handshake, entries: readonly DeviceEntry[]): ReconciledTime[] {
  const inOrder = [...entries].sort((a, b) => a.deviceSequence - b.deviceSequence);
  const anchorValid = handshake.anchorBootId === handshake.deviceBootId && countsForward(inOrder);
  const receivedAt = handshake.serverReceivedAt.getTime();

  const reconciled: ReconciledTime[] = [];
  let previous: number | undefined;

  for (const [index, entry] of inOrder.entries()) {
    const raw = anchorValid ? fromAnchor(handshake, entry) : estimated(handshake, inOrder, index);
    const reading = keepMoving(clampToServer(raw, receivedAt), previous);

    previous = reading.at;
    reconciled.push({
      deviceSequence: entry.deviceSequence,
      occurredAt: new Date(reading.at),
      confidence: reading.confidence,
      flags: reading.flags,
    });
  }

  return reconciled;
}
