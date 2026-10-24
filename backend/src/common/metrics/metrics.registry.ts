import { processMetrics } from './process-metrics.js';

export type Labels = Record<string, string>;

interface Series<T> {
  labels: Labels;
  value: T;
}

interface MetricFamily<T> {
  help: string;
  series: Map<string, Series<T>>;
}

interface HistogramValue {
  buckets: number[];
  count: number;
  sum: number;
}

export const DEFAULT_BUCKETS = [0.05, 0.1, 0.3, 1, 3, 5, 10];

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

/**
 * 极简 Prometheus 指标注册表（OPS-04 / T277）。
 *
 * 不引入 prom-client：当前只需要 counter/gauge/histogram 与文本输出，
 * 自己实现可避免多一个生产依赖，也便于单测。
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, MetricFamily<number>>();
  private readonly gauges = new Map<string, MetricFamily<number>>();
  private readonly histograms = new Map<string, MetricFamily<HistogramValue> & { buckets: number[] }>();

  inc(name: string, help: string, labels: Labels = {}, value = 1): void {
    const family = this.family(this.counters, name, help);
    const key = labelKey(labels);
    const existing = family.series.get(key);
    if (existing) existing.value += value;
    else family.series.set(key, { labels: { ...labels }, value });
  }

  setGauge(name: string, help: string, value: number, labels: Labels = {}): void {
    const family = this.family(this.gauges, name, help);
    family.series.set(labelKey(labels), { labels: { ...labels }, value });
  }

  observe(name: string, help: string, value: number, labels: Labels = {}, buckets = DEFAULT_BUCKETS): void {
    let family = this.histograms.get(name);
    if (!family) {
      family = { help, series: new Map(), buckets: [...buckets].sort((a, b) => a - b) };
      this.histograms.set(name, family);
    }
    const key = labelKey(labels);
    const existing = family.series.get(key);
    const target =
      existing ?? { labels: { ...labels }, value: { buckets: family.buckets.map(() => 0), count: 0, sum: 0 } };
    for (let index = 0; index < family.buckets.length; index += 1) {
      if (value <= family.buckets[index]) target.value.buckets[index] += 1;
    }
    target.value.count += 1;
    target.value.sum += value;
    if (!existing) family.series.set(key, target);
  }

  /** 导出全部指标；process 指标在渲染时读取实时值。 */
  render(): string {
    this.setGauge('app_process_uptime_seconds', '进程运行时长（秒）', processMetrics().uptimeSeconds);
    this.setGauge(
      'app_process_resident_memory_bytes',
      '进程常驻内存（字节）',
      processMetrics().residentMemoryBytes,
    );

    const lines: string[] = [];
    for (const [name, family] of this.counters) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} counter`);
      for (const { labels, value } of family.series.values()) {
        lines.push(`${name}${renderLabels(labels)} ${value}`);
      }
    }
    for (const [name, family] of this.gauges) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} gauge`);
      for (const { labels, value } of family.series.values()) {
        lines.push(`${name}${renderLabels(labels)} ${value}`);
      }
    }
    for (const [name, family] of this.histograms) {
      lines.push(`# HELP ${name} ${family.help}`, `# TYPE ${name} histogram`);
      for (const { labels, value } of family.series.values()) {
        let cumulative = 0;
        family.buckets.forEach((bucket, index) => {
          cumulative = value.buckets[index];
          const bucketLabels = { ...labels, le: String(bucket) };
          lines.push(`${name}_bucket${renderLabels(bucketLabels)} ${cumulative}`);
        });
        const infLabels = { ...labels, le: '+Inf' };
        lines.push(`${name}_bucket${renderLabels(infLabels)} ${value.count}`);
        lines.push(`${name}_sum${renderLabels(labels)} ${value.sum}`);
        lines.push(`${name}_count${renderLabels(labels)} ${value.count}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  /** 仅供单测断言，返回指标快照。 */
  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; sum: number }>;
  } {
    const counters: Record<string, number> = {};
    for (const [name, family] of this.counters) {
      for (const { labels, value } of family.series.values()) {
        counters[`${name}${renderLabels(labels)}`] = value;
      }
    }
    const gauges: Record<string, number> = {};
    for (const [name, family] of this.gauges) {
      for (const { labels, value } of family.series.values()) {
        gauges[`${name}${renderLabels(labels)}`] = value;
      }
    }
    const histograms: Record<string, { count: number; sum: number }> = {};
    for (const [name, family] of this.histograms) {
      for (const { labels, value } of family.series.values()) {
        histograms[`${name}${renderLabels(labels)}`] = { count: value.count, sum: value.sum };
      }
    }
    return { counters, gauges, histograms };
  }

  private family<T>(store: Map<string, MetricFamily<T>>, name: string, help: string): MetricFamily<T> {
    let family = store.get(name);
    if (!family) {
      family = { help, series: new Map() };
      store.set(name, family);
    }
    return family;
  }
}
