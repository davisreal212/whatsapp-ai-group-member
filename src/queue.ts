export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
}

interface Job {
  key: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class KeyedJobQueue {
  private readonly pending = new Map<string, Job[]>();
  private readonly running = new Set<string>();
  private processing = 0;
  private pendingCount = 0;
  private failed = 0;
  private readonly idleWaiters: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Queue concurrency must be positive");
  }

  enqueue(key: string, run: () => Promise<void>): void {
    void this.enqueueAndWait(key, run).catch(() => undefined);
  }

  enqueueAndWait(key: string, run: () => Promise<void>): Promise<void> {
    const completion = new Promise<void>((resolve, reject) => {
      const jobs = this.pending.get(key) ?? [];
      jobs.push({ key, run, resolve, reject });
      this.pending.set(key, jobs);
      this.pendingCount += 1;
      this.pump();
    });
    return completion;
  }

  async waitForIdle(): Promise<void> {
    if (this.pendingCount === 0 && this.processing === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  stats(): QueueStats {
    return { pending: this.pendingCount, processing: this.processing, failed: this.failed };
  }

  private pump(): void {
    while (this.processing < this.concurrency) {
      const entry = [...this.pending.entries()].find(([key, jobs]) => jobs.length > 0 && !this.running.has(key));
      if (!entry) return;
      const [key, jobs] = entry;
      const job = jobs.shift();
      if (!job) continue;
      if (!jobs.length) this.pending.delete(key);
      this.pendingCount -= 1;
      this.running.add(key);
      this.processing += 1;
      void job.run()
        .then(() => job.resolve())
        .catch((error) => {
          this.failed += 1;
          job.reject(error);
        })
        .finally(() => {
          this.running.delete(job.key);
          this.processing -= 1;
          this.pump();
          if (this.pendingCount === 0 && this.processing === 0) {
            for (const resolve of this.idleWaiters.splice(0)) resolve();
          }
        });
    }
  }
}
