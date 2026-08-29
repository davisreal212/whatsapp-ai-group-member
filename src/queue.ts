export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
}

interface Job {
  key: string;
  run: () => Promise<void>;
}

export class KeyedJobQueue {
  private readonly pending = new Map<string, Job[]>();
  private readonly running = new Set<string>();
  private processing = 0;
  private pendingCount = 0;
  private failed = 0;

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Queue concurrency must be positive");
  }

  enqueue(key: string, run: () => Promise<void>): void {
    const jobs = this.pending.get(key) ?? [];
    jobs.push({ key, run });
    this.pending.set(key, jobs);
    this.pendingCount += 1;
    this.pump();
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
        .catch(() => { this.failed += 1; })
        .finally(() => {
          this.running.delete(job.key);
          this.processing -= 1;
          this.pump();
        });
    }
  }
}
