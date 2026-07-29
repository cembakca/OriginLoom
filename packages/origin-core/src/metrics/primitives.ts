export type CounterMap = Map<string, number>;

export class Histogram {
  private readonly values = new Map<string, { count: number; sum: number; buckets: number[] }>();

  constructor(private readonly boundaries: number[]) {}

  observe(labels: string, value: number): void {
    const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
    const current = this.values.get(labels) ?? {
      count: 0,
      sum: 0,
      buckets: this.boundaries.map(() => 0),
    };
    current.count++;
    current.sum += safeValue;
    // Keep non-cumulative buckets on the request path: one increment instead
    // of one per matching Prometheus boundary. Cumulative values are expanded
    // only when /metrics is scraped.
    const bucket = this.boundaries.findIndex((boundary) => safeValue <= boundary);
    if (bucket >= 0) {
      current.buckets[bucket] = (current.buckets[bucket] ?? 0) + 1;
    }
    this.values.set(labels, current);
  }

  lines(name: string, help: string): string[] {
    const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
    for (const [labels, value] of [...this.values.entries()].sort()) {
      let cumulative = 0;
      for (let index = 0; index < this.boundaries.length; index++) {
        cumulative += value.buckets[index] ?? 0;
        lines.push(`${name}_bucket{${labels},le="${this.boundaries[index]}"} ${cumulative}`);
      }
      lines.push(`${name}_bucket{${labels},le="+Inf"} ${value.count}`);
      lines.push(`${name}_sum{${labels}} ${finite(value.sum)}`);
      lines.push(`${name}_count{${labels}} ${value.count}`);
    }
    return lines;
  }
}

export function increment(map: CounterMap, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function counterLines(name: string, help: string, map: CounterMap): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [labels, value] of [...map.entries()].sort()) {
    lines.push(`${name}{${labels}} ${value}`);
  }
  return lines;
}

export function gauge(name: string, help: string, value: number, labels?: string): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}${labels ? `{${labels}}` : ""} ${finite(value)}`,
  ];
}

export function counter(name: string, help: string, value: number, labels?: string): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    `${name}${labels ? `{${labels}}` : ""} ${finite(value)}`,
  ];
}

export function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function finite(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}
