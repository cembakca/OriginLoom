export type MarketStreamLease = { release: () => void };
export type MarketStreamAdmissionResult =
  { kind: "accepted"; lease: MarketStreamLease } | { kind: "global_limit" | "ip_limit" };

/** Active-connection accounting; entries disappear when the last connection closes. */
export class MarketStreamAdmission {
  private active = 0;
  private readonly byIp = new Map<string, number>();

  constructor(
    private readonly globalLimit: number,
    private readonly perIpLimit: number,
  ) {}

  acquire(clientIp: string): MarketStreamAdmissionResult {
    if (this.active >= this.globalLimit) return { kind: "global_limit" };
    const ipCount = this.byIp.get(clientIp) ?? 0;
    if (ipCount >= this.perIpLimit) return { kind: "ip_limit" };

    this.active++;
    this.byIp.set(clientIp, ipCount + 1);
    let released = false;
    return {
      kind: "accepted",
      lease: {
        release: () => {
          if (released) return;
          released = true;
          this.active--;
          const current = this.byIp.get(clientIp) ?? 1;
          if (current <= 1) this.byIp.delete(clientIp);
          else this.byIp.set(clientIp, current - 1);
        },
      },
    };
  }

  get activeConnections(): number {
    return this.active;
  }
}
