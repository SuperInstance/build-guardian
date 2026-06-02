/**
 * Prometheus export
 */

import type { BuildReport } from '../types';
import { formatBytes } from '../types';

export interface PrometheusMetric {
  name: string;
  help: string;
  type: 'gauge' | 'counter' | 'histogram';
  samples: Array<{
    labels: Record<string, string>;
    value: number;
  }>;
}

export function toPrometheus(report: BuildReport): string {
  const lines: string[] = [];

  lines.push('# HELP build_guardian_total_entries Total number of build entries');
  lines.push('# TYPE build_guardian_total_entries gauge');
  lines.push(`build_guardian_total_entries ${report.totalEntries}`);

  lines.push('# HELP build_guardian_total_build_time_ms Total build time in milliseconds');
  lines.push('# TYPE build_guardian_total_build_time_ms gauge');
  lines.push(`build_guardian_total_build_time_ms ${report.totalBuildTimeMs}`);

  lines.push('# HELP build_guardian_total_size_bytes Total output size in bytes');
  lines.push('# TYPE build_guardian_total_size_bytes gauge');
  lines.push(`build_guardian_total_size_bytes ${report.totalSizeBytes}`);

  lines.push('# HELP build_guardian_alerts_count Number of bloat alerts');
  lines.push('# TYPE build_guardian_alerts_count gauge');
  lines.push(`build_guardian_alerts_count ${report.alerts.length}`);

  lines.push('# HELP build_guardian_violations_count Number of budget violations');
  lines.push('# TYPE build_guardian_violations_count gauge');
  lines.push(`build_guardian_violations_count ${report.violations.length}`);

  lines.push('');

  lines.push('# HELP build_guardian_entry_size_bytes Output size per entry in bytes');
  lines.push('# TYPE build_guardian_entry_size_bytes gauge');
  for (const m of report.entryMetrics) {
    lines.push(`build_guardian_entry_size_bytes{entry="${escapeLabel(m.entry)}"} ${m.sizeBytes}`);
  }

  lines.push('');
  lines.push('# HELP build_guardian_entry_build_time_ms Build time per entry in milliseconds');
  lines.push('# TYPE build_guardian_entry_build_time_ms gauge');
  for (const m of report.entryMetrics) {
    lines.push(`build_guardian_entry_build_time_ms{entry="${escapeLabel(m.entry)}"} ${m.buildTimeMs}`);
  }

  lines.push('');
  lines.push('# HELP build_guardian_entry_memory_peak_bytes Peak memory per entry in bytes');
  lines.push('# TYPE build_guardian_entry_memory_peak_bytes gauge');
  for (const m of report.entryMetrics) {
    lines.push(`build_guardian_entry_memory_peak_bytes{entry="${escapeLabel(m.entry)}"} ${m.memoryPeakBytes}`);
  }

  if (report.alerts.length > 0) {
    lines.push('');
    lines.push('# HELP build_guardian_bloat_growth_percent Growth percentage for bloat-alerted entries');
    lines.push('# TYPE build_guardian_bloat_growth_percent gauge');
    for (const a of report.alerts) {
      lines.push(`build_guardian_bloat_growth_percent{entry="${escapeLabel(a.entry)}",severity="${a.severity}"} ${a.growthPercent.toFixed(4)}`);
    }
  }

  if (report.trends.length > 0) {
    lines.push('');
    lines.push('# HELP build_guardian_trend_slope_bytes_per_build Trend slope (bytes per build) for each entry');
    lines.push('# TYPE build_guardian_trend_slope_bytes_per_build gauge');
    for (const t of report.trends) {
      lines.push(`build_guardian_trend_slope_bytes_per_build{entry="${escapeLabel(t.entry)}",direction="${t.direction}"} ${t.slope.toFixed(2)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function toPrometheusMetrics(report: BuildReport): PrometheusMetric[] {
  return [
    {
      name: 'build_guardian_total_entries',
      help: 'Total number of build entries',
      type: 'gauge',
      samples: [{ labels: {}, value: report.totalEntries }],
    },
    {
      name: 'build_guardian_total_size_bytes',
      help: 'Total output size in bytes',
      type: 'gauge',
      samples: [{ labels: {}, value: report.totalSizeBytes }],
    },
    {
      name: 'build_guardian_entry_size_bytes',
      help: 'Output size per entry in bytes',
      type: 'gauge',
      samples: report.entryMetrics.map((m) => ({
        labels: { entry: m.entry },
        value: m.sizeBytes,
      })),
    },
  ];
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
