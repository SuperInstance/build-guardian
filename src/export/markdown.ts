/**
 * Markdown export — refined markdown format.
 */

import type { BuildReport } from '../types';
import { formatBytes } from '../types';

export function toMarkdown(report: BuildReport): string {
  const lines: string[] = [];

  lines.push('# Build Budget Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`**Entries:** ${report.totalEntries}`);
  lines.push(`**Total build time:** ${formatDuration(report.totalBuildTimeMs)}`);
  lines.push(`**Total output size:** ${formatBytes(report.totalSizeBytes)}`);
  lines.push('');

  const summary = buildSummary(report);
  lines.push(`> ${summary}`);
  lines.push('');

  if (report.alerts.length > 0) {
    lines.push('## ⚠️ Bloat Alerts');
    lines.push('');
    for (const alert of report.alerts) {
      const pct = `${Math.round(alert.growthPercent * 100)}%`;
      const icon = alert.severity === 'critical' ? '🔴' : '🟡';
      let line = `${icon} **${alert.entry}**: ${formatBytes(alert.previousSizeBytes)} → ${formatBytes(alert.currentSizeBytes)} (**+${pct}**)`;
      if (alert.addedDependencies.length > 0) {
        line += `. Added: ${alert.addedDependencies.join(', ')}`;
      }
      lines.push(`- ${line}`);
    }
    lines.push('');
  }

  if (report.violations.length > 0) {
    lines.push('## 🚫 Budget Violations');
    lines.push('');
    for (const v of report.violations) {
      lines.push(`- **${v.entry}**: ${v.reason}`);
    }
    lines.push('');
  }

  if (report.ruleAlerts.length > 0) {
    lines.push('## 🚨 Rule Alerts');
    lines.push('');
    for (const ra of report.ruleAlerts) {
      lines.push(`- **[${ra.rule.severity.toUpperCase()}]** ${ra.rule.name}: ${ra.message}`);
    }
    lines.push('');
  }

  const significant = report.trends.filter((t) => t.direction !== 'stable');
  if (significant.length > 0) {
    lines.push('## 📈 Trend Analysis');
    lines.push('');
    for (const t of significant) {
      const icon = t.direction === 'growing' ? '📈' : '📉';
      lines.push(`- ${icon} **${t.entry}**: ${t.summary}`);
    }
    lines.push('');
  }

  if (report.scores.length > 0) {
    lines.push('## Conservation Scores');
    lines.push('');
    lines.push('Higher score = bigger optimization target (size × frequency × complexity).');
    lines.push('');
    lines.push('| Entry | Score | Size | Freq | Modules |');
    lines.push('|-------|------:|-----:|-----:|--------:|');
    for (const s of report.scores.slice(0, 20)) {
      const metric = report.entryMetrics.find((m) => m.entry === s.entry);
      lines.push(
        `| ${s.entry} | ${s.score.toFixed(1)} | ${metric ? formatBytes(metric.sizeBytes) : '—'} | ${s.frequency}/day | ${s.complexity} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Per-Entry Breakdown');
  lines.push('');
  lines.push('| Entry | Build Time | Output Size | Memory Peak | Type |');
  lines.push('|-------|-----------:|------------:|------------:|------|');
  for (const m of report.entryMetrics) {
    const type = m.chunkType ?? (m.isLazy ? 'lazy' : 'entry');
    lines.push(`| ${m.entry} | ${formatDuration(m.buildTimeMs)} | ${formatBytes(m.sizeBytes)} | ${formatBytes(m.memoryPeakBytes)} | ${type} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function buildSummary(report: BuildReport): string {
  const parts: string[] = [];
  parts.push(`Your build takes ${formatDuration(report.totalBuildTimeMs)}.`);

  const sortedByTime = [...report.entryMetrics].sort((a, b) => b.buildTimeMs - a.buildTimeMs);
  if (sortedByTime.length >= 3 && report.totalBuildTimeMs > 0) {
    const top3 = sortedByTime.slice(0, 3);
    const top3Pct = Math.round((top3.reduce((s, m) => s + m.buildTimeMs, 0) / report.totalBuildTimeMs) * 100);
    parts.push(`${top3.length} entries account for ${top3Pct}% of that time.`);
  }

  const sortedBySize = [...report.entryMetrics].sort((a, b) => b.sizeBytes - a.sizeBytes);
  if (sortedBySize.length > 0) {
    parts.push(`${sortedBySize[0].entry} is the largest at ${formatBytes(sortedBySize[0].sizeBytes)}.`);
  }

  if (report.alerts.length > 0) {
    const worst = report.alerts.sort((a, b) => b.growthPercent - a.growthPercent)[0];
    parts.push(
      `${worst.entry} grew ${Math.round(worst.growthPercent * 100)}% from last build${
        worst.addedDependencies.length > 0 ? ` — added: ${worst.addedDependencies.slice(0, 3).join(', ')}` : ''
      }.`,
    );
  }

  if (report.violations.length > 0) {
    parts.push(`${report.violations.length} entry/entries exceed their budget.`);
  }

  return parts.join(' ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
