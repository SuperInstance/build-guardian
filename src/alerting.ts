/**
 * Alerting — configurable rules for CI integration.
 */

import type { AlertRule, AlertResult, EntryMetrics, HistoryEntry } from './types';
import { formatBytes } from './types';

export function evaluateAlertRules(
  rules: AlertRule[],
  currentMetrics: EntryMetrics[],
  history: HistoryEntry[],
): AlertResult[] {
  const results: AlertResult[] = [];
  for (const rule of rules) {
    const matched = evaluateRule(rule, currentMetrics, history);
    results.push(...matched);
  }
  return results;
}

function evaluateRule(
  rule: AlertRule,
  metrics: EntryMetrics[],
  history: HistoryEntry[],
): AlertResult[] {
  switch (rule.type) {
    case 'max-growth':
      return evaluateMaxGrowth(rule, metrics, history);
    case 'max-total-size':
      return evaluateMaxTotalSize(rule, metrics);
    case 'max-entry-size':
      return evaluateMaxEntrySize(rule, metrics);
    case 'max-build-time':
      return evaluateMaxBuildTime(rule, metrics);
    case 'consecutive-growth':
      return evaluateConsecutiveGrowth(rule, history);
    default:
      return [];
  }
}

function evaluateMaxGrowth(
  rule: AlertRule,
  metrics: EntryMetrics[],
  history: HistoryEntry[],
): AlertResult[] {
  if (history.length < 2) return [];
  const results: AlertResult[] = [];
  const previous = history[history.length - 2];
  const prevMap = new Map(previous.metrics.map((m: EntryMetrics) => [m.entry, m]));

  for (const current of metrics) {
    if (rule.entryPattern && !matchesGlob(rule.entryPattern, current.entry)) continue;
    const prev = prevMap.get(current.entry);
    if (!prev || prev.sizeBytes === 0) continue;
    const growth = (current.sizeBytes - prev.sizeBytes) / prev.sizeBytes;
    if (growth > rule.threshold) {
      results.push({
        rule,
        message: `Route "${current.entry}" grew ${(growth * 100).toFixed(1)}% (threshold: ${(rule.threshold * 100).toFixed(0)}%) — ${formatBytes(prev.sizeBytes)} → ${formatBytes(current.sizeBytes)}`,
        entries: [current.entry],
      });
    }
  }
  return results;
}

function evaluateMaxTotalSize(rule: AlertRule, metrics: EntryMetrics[]): AlertResult[] {
  const total = metrics.reduce((s: number, m: EntryMetrics) => s + m.sizeBytes, 0);
  if (total > rule.threshold) {
    return [{
      rule,
      message: `Total bundle size ${formatBytes(total)} exceeds threshold of ${formatBytes(rule.threshold)}`,
    }];
  }
  return [];
}

function evaluateMaxEntrySize(rule: AlertRule, metrics: EntryMetrics[]): AlertResult[] {
  const results: AlertResult[] = [];
  for (const m of metrics) {
    if (rule.entryPattern && !matchesGlob(rule.entryPattern, m.entry)) continue;
    if (m.sizeBytes > rule.threshold) {
      results.push({
        rule,
        message: `Entry "${m.entry}" size ${formatBytes(m.sizeBytes)} exceeds threshold of ${formatBytes(rule.threshold)}`,
        entries: [m.entry],
      });
    }
  }
  return results;
}

function evaluateMaxBuildTime(rule: AlertRule, metrics: EntryMetrics[]): AlertResult[] {
  const total = metrics.reduce((s: number, m: EntryMetrics) => s + m.buildTimeMs, 0);
  if (total > rule.threshold) {
    return [{
      rule,
      message: `Total build time ${(total / 1000).toFixed(1)}s exceeds threshold of ${(rule.threshold / 1000).toFixed(1)}s`,
    }];
  }
  return [];
}

function evaluateConsecutiveGrowth(rule: AlertRule, history: HistoryEntry[]): AlertResult[] {
  const requiredConsecutive = rule.consecutiveBuilds ?? 3;
  if (history.length < requiredConsecutive + 1) return [];
  const results: AlertResult[] = [];
  const entryNames = new Set<string>();
  for (const h of history) {
    for (const m of h.metrics) {
      entryNames.add(m.entry);
    }
  }

  for (const entry of entryNames) {
    if (rule.entryPattern && !matchesGlob(rule.entryPattern, entry)) continue;
    let consecutiveGrowth = 0;
    for (let i = history.length - 1; i >= 1; i--) {
      const curr = history[i].metrics.find((m: EntryMetrics) => m.entry === entry);
      const prev = history[i - 1].metrics.find((m: EntryMetrics) => m.entry === entry);
      if (curr && prev && curr.sizeBytes > prev.sizeBytes) {
        consecutiveGrowth++;
      } else {
        break;
      }
    }

    if (consecutiveGrowth >= requiredConsecutive) {
      const growths: number[] = [];
      for (let i = history.length - consecutiveGrowth; i < history.length; i++) {
        const curr = history[i].metrics.find((m: EntryMetrics) => m.entry === entry);
        const prev = history[i - 1].metrics.find((m: EntryMetrics) => m.entry === entry);
        if (curr && prev && prev.sizeBytes > 0) {
          growths.push(curr.sizeBytes - prev.sizeBytes);
        }
      }
      const avgGrowth = growths.length > 0 ? growths.reduce((a, b) => a + b, 0) / growths.length : 0;
      results.push({
        rule,
        message: `Route "${entry}" grew ${consecutiveGrowth} consecutive builds. Average: +${formatBytes(avgGrowth)}/build. Trend: growing.`,
        entries: [entry],
      });
    }
  }
  return results;
}

function matchesGlob(pattern: string, value: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(value);
}

export const presetRules = {
  failOnLargeGrowth: (): AlertRule => ({
    name: 'no-large-growth',
    type: 'max-growth',
    threshold: 0.20,
    severity: 'fail',
  }),
  warnTotalBundle500kb: (): AlertRule => ({
    name: 'total-bundle-size',
    type: 'max-total-size',
    threshold: 500 * 1024,
    severity: 'warning',
  }),
  failEntrySize250kb: (): AlertRule => ({
    name: 'max-entry-size',
    type: 'max-entry-size',
    threshold: 250 * 1024,
    severity: 'fail',
  }),
  warnBuildTime60s: (): AlertRule => ({
    name: 'max-build-time',
    type: 'max-build-time',
    threshold: 60_000,
    severity: 'warning',
  }),
  warnConsecutiveGrowth: (): AlertRule => ({
    name: 'consecutive-growth',
    type: 'consecutive-growth',
    threshold: 0,
    consecutiveBuilds: 3,
    severity: 'warning',
  }),
};
