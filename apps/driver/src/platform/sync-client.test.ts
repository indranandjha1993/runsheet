import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, newQueue, type Queue } from "../domain/queue.js";
import { push, type Transport } from "./sync-client.js";

const at = new Date("2026-09-07T09:00:00.000Z");

const queue = (): Queue =>
  [1, 2].reduce(
    (q, n) =>
      enqueue(q, {
        commandId: `cmd-${String(n)}`,
        type: "stop.completed",
        payload: { stop_id: `s${String(n)}` },
        at,
        monotonicMs: n * 1000,
        media: [],
      }),
    newQueue({ deviceId: "d1", bootId: "b1", workerId: "w1", runId: "run-1", startedAt: at }),
  );

const accepted = {
  batch_id: "batch-1",
  results: [
    { command_id: "cmd-1", status: "accepted", event_id: "e1" },
    { command_id: "cmd-2", status: "accepted", event_id: "e2" },
  ],
  uploads: [],
};

const transport = (reply: unknown, ok = true): Transport => ({
  send: vi.fn((): Promise<{ ok: boolean; body: unknown }> => Promise.resolve({ ok, body: reply })),
});

let ids: () => string;

beforeEach(() => {
  let n = 0;
  ids = () => {
    n += 1;
    return `batch-${String(n)}`;
  };
});

describe("pushing what the driver did", () => {
  it("empties the queue when the server took it all", async () => {
    const result = await push(queue(), { transport: transport(accepted), ids, now: () => at });

    expect(result.queue.pending).toEqual([]);
    expect(result.sent).toBe(2);
  });

  it("sends nothing when there is nothing to send", async () => {
    const idle = newQueue({
      deviceId: "d1",
      bootId: "b1",
      workerId: "w1",
      runId: "run-1",
      startedAt: at,
    });
    const post = transport(accepted);

    const result = await push(idle, { transport: post, ids, now: () => at });

    expect(post.send).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("keeps everything when the network never answered", async () => {
    const dead: Transport = {
      send: vi.fn((): Promise<{ ok: boolean; body: unknown }> => Promise.reject(new Error("offline"))),
    };

    const result = await push(queue(), { transport: dead, ids, now: () => at });

    expect(result.queue.pending).toHaveLength(2);
    expect(result.error).toBe("offline");
  });

  it("keeps everything when the server answered with a failure", async () => {
    const result = await push(queue(), {
      transport: transport({ error: { message: "server on fire" } }, false),
      ids,
      now: () => at,
    });

    expect(result.queue.pending).toHaveLength(2);
    expect(result.sent).toBe(0);
  });

  it("keeps everything when the answer is not a shape it understands", async () => {
    const result = await push(queue(), {
      transport: transport({ something: "else" }),
      ids,
      now: () => at,
    });

    expect(result.queue.pending).toHaveLength(2);
    expect(result.error).toContain("could not read");
  });

  it("sends the same work again after a failure, under a new batch identifier", async () => {
    const post = transport(accepted);
    const first = await push(queue(), {
      transport: {
        send: vi.fn((): Promise<{ ok: boolean; body: unknown }> =>
          Promise.reject(new Error("offline")),
        ),
      },
      ids,
      now: () => at,
    });
    await push(first.queue, { transport: post, ids, now: () => at });

    const body = vi.mocked(post.send).mock.calls[0]?.[0] as { batch_id: string };
    expect(body.batch_id).toBe("batch-2");
  });

  it("passes back what the server wants uploaded", async () => {
    const withUploads = {
      ...accepted,
      uploads: [{ media_id: "m1", sha256: "a".repeat(64) }],
    };

    const result = await push(queue(), {
      transport: transport(withUploads),
      ids,
      now: () => at,
    });

    expect(result.uploads).toEqual([{ mediaId: "m1", sha256: "a".repeat(64) }]);
  });

  it("records what the server refused so the driver can be told", async () => {
    const refused = {
      batch_id: "batch-1",
      results: [
        { command_id: "cmd-1", status: "rejected", reason: "unknown action" },
        { command_id: "cmd-2", status: "accepted", event_id: "e2" },
      ],
      uploads: [],
    };

    const result = await push(queue(), { transport: transport(refused), ids, now: () => at });

    expect(result.queue.refused).toEqual([{ commandId: "cmd-1", reason: "unknown action" }]);
    expect(result.queue.pending).toEqual([]);
  });
});
