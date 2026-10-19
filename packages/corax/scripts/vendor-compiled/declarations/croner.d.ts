export declare class Cron {
  constructor(pattern: string, options?: { timezone?: string; paused?: boolean });
  nextRun(previous?: Date): Date | null;
  stop(): void;
}
