import { describe, expect, it } from "vitest";
import { KeyedJobQueue } from "../src/queue.js";

describe("keyed job queue", () => {
  it("preserves order per chat while allowing independent chats to run", async () => {
    const queue = new KeyedJobQueue(2);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
    queue.enqueue("chat-a", async () => { events.push("a1-start"); await firstDone; events.push("a1-end"); });
    queue.enqueue("chat-a", async () => { events.push("a2"); });
    queue.enqueue("chat-b", async () => { events.push("b1"); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["a1-start", "b1"]);
    releaseFirst();
    for (let attempt = 0; attempt < 20 && queue.stats().processing > 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["a1-start", "b1", "a1-end", "a2"]);
    expect(queue.stats()).toEqual({ pending: 0, processing: 0, failed: 0 });
  });

  it("tracks failed jobs without stopping later work", async () => {
    const queue = new KeyedJobQueue(1);
    queue.enqueue("chat", async () => { throw new Error("failed"); });
    queue.enqueue("chat", async () => {});
    for (let attempt = 0; attempt < 20 && queue.stats().processing > 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.stats()).toEqual({ pending: 0, processing: 0, failed: 1 });
  });
});
