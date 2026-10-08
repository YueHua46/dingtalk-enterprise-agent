// Process-wide foreground-first DWS gate. Redis sync concurrency and per-user
// PostgreSQL advisory locks limit background scans across gateway replicas.
export class DwsReadGate {
  private active = 0;
  private foreground: Array<() => void> = [];
  private background: Array<() => void> = [];
  public constructor(private readonly limit = 2) {}
  public async run<T>(fn: () => Promise<T>, background = false): Promise<T> {
    await new Promise<void>((resolve) => {
      const start = () => { this.active++; resolve(); };
      if (this.active < this.limit) start();
      else (background ? this.background : this.foreground).push(start);
    });
    try { return await fn(); } finally {
      this.active--;
      (this.foreground.shift() ?? this.background.shift())?.();
    }
  }
}
export const dwsReadGate = new DwsReadGate();
