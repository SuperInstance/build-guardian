/**
 * BuildBudget — main class for tracking build metrics and enforcing budgets.
 */

import type {
  EntryMetrics, EntryBudget, AlertRule, ConservationScore,
  BloatAlert, BudgetViolation, AlertResult, TrendAnalysis,
  BuildReport, HistoryEntry,
} from './types';
import { evaluateAlertRules } from './alerting';
import { analyzeTrends } from './trends';
import { formatBytes } from './types';

export class BuildBudget {
  private currentMetrics: Map<string, EntryMetrics> = new Map();
  private history: HistoryEntry[] = [];
  private budgets: EntryBudget[] = [];
  private alertRules: AlertRule[] = [];
  private frequencyEstimates: Map<string, number> = new Map();

  public bloatThreshold: number = 0.20;

  constructor(opts?: { bloatThreshold?: number }) {
    if (opts?.bloatThreshold !== undefined) {
      this.bloatThreshold = opts.bloatThreshold;
    }
  }

  recordEntry(metrics: EntryMetrics): void {
    this.currentMetrics.set(metrics.entry, {
      ...metrics,
      timestamp: metrics.timestamp || Date.now(),
    });
  }

  finalizeBuild(label?: string): BuildReport {
    const metrics = Array.from(this.currentMetrics.values());
    const snapshot: HistoryEntry = { timestamp: Date.now(), metrics, label };
    this.history.push(snapshot);

    const alerts = this.detectBloat();
    const violations = this.enforceBudgets();
    const scores = this.computeConservationScores();
    const ruleAlerts = evaluateAlertRules(this.alertRules, metrics, this.history);
    const trends = analyzeTrends(this.history);

    const report: BuildReport = {
      generatedAt: snapshot.timestamp,
      totalEntries: metrics.length,
      totalBuildTimeMs: metrics.reduce((s, m) => s + m.buildTimeMs, 0),
      totalSizeBytes: metrics.reduce((s, m) => s + m.sizeBytes, 0),
      alerts,
      violations,
      scores,
      entryMetrics: metrics,
      ruleAlerts,
      trends,
    };

    return report;
  }

  setBudgets(budgets: EntryBudget[]): void {
    this.budgets = budgets;
  }

  addBudget(budget: EntryBudget): void {
    this.budgets.push(budget);
  }

  setAlertRules(rules: AlertRule[]): void {
    this.alertRules = rules;
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  setFrequencyEstimates(estimates: Map<string, number>): void {
    this.frequencyEstimates = estimates;
  }

  detectBloat(): BloatAlert[] {
    const alerts: BloatAlert[] = [];
    if (this.history.length < 2) return alerts;

    const previous = this.history[this.history.length - 2];
    const prevMap = new Map(previous.metrics.map((m) => [m.entry, m]));

    for (const current of this.currentMetrics.values()) {
      const prev = prevMap.get(current.entry);
      if (!prev || prev.sizeBytes === 0) continue;

      const growth = (current.sizeBytes - prev.sizeBytes) / prev.sizeBytes;
      if (growth <= this.bloatThreshold) continue;

      const prevModuleNames = new Set((prev.modules ?? []).map((m) => m.name));
      const addedDeps = (current.modules ?? [])
        .filter((m) => !prevModuleNames.has(m.name))
        .map((m) => m.name);

      alerts.push({
        entry: current.entry,
        previousSizeBytes: prev.sizeBytes,
        currentSizeBytes: current.sizeBytes,
        growthPercent: growth,
        addedDependencies: addedDeps,
        severity: growth > 0.5 ? 'critical' : 'warning',
      });
    }

    return alerts;
  }

  enforceBudgets(): BudgetViolation[] {
    const violations: BudgetViolation[] = [];

    for (const budget of this.budgets) {
      const metric = this.findMatchingMetric(budget.entry);
      if (!metric) continue;

      if (metric.sizeBytes > budget.maxSizeBytes) {
        violations.push({
          entry: metric.entry,
          budget,
          actual: {
            sizeBytes: metric.sizeBytes,
            buildTimeMs: metric.buildTimeMs,
            memoryPeakBytes: metric.memoryPeakBytes,
          },
          reason: `Output size ${formatBytes(metric.sizeBytes)} exceeds budget of ${formatBytes(budget.maxSizeBytes)}`,
        });
      }

      if (budget.maxBuildTimeMs && budget.maxBuildTimeMs > 0 && metric.buildTimeMs > budget.maxBuildTimeMs) {
        violations.push({
          entry: metric.entry,
          budget,
          actual: {
            sizeBytes: metric.sizeBytes,
            buildTimeMs: metric.buildTimeMs,
            memoryPeakBytes: metric.memoryPeakBytes,
          },
          reason: `Build time ${metric.buildTimeMs}ms exceeds budget of ${budget.maxBuildTimeMs}ms`,
        });
      }

      if (budget.maxMemoryBytes && budget.maxMemoryBytes > 0 && metric.memoryPeakBytes > budget.maxMemoryBytes) {
        violations.push({
          entry: metric.entry,
          budget,
          actual: {
            sizeBytes: metric.sizeBytes,
            buildTimeMs: metric.buildTimeMs,
            memoryPeakBytes: metric.memoryPeakBytes,
          },
          reason: `Memory peak ${formatBytes(metric.memoryPeakBytes)} exceeds budget of ${formatBytes(budget.maxMemoryBytes)}`,
        });
      }
    }

    return violations;
  }

  computeConservationScores(): ConservationScore[] {
    const metrics = Array.from(this.currentMetrics.values());
    if (metrics.length === 0) return [];

    const maxSize = Math.max(...metrics.map((m) => m.sizeBytes), 1);

    return metrics
      .map((m) => {
        const sizeNormalized = m.sizeBytes / maxSize;
        const frequency = this.frequencyEstimates.get(m.entry) ?? 100;
        const complexity = m.modules?.length ?? 1;
        return {
          entry: m.entry,
          score: sizeNormalized * frequency * complexity,
          sizeNormalized,
          frequency,
          complexity,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  compareEntry(entry: string): string | null {
    if (this.history.length < 1) return null;

    const prev = this.history[this.history.length - 1].metrics.find((m) => m.entry === entry);
    const curr = this.currentMetrics.get(entry);
    if (!prev || !curr) return null;

    const growth = prev.sizeBytes > 0
      ? ((curr.sizeBytes - prev.sizeBytes) / prev.sizeBytes) * 100
      : 0;

    const prevModuleNames = new Set((prev.modules ?? []).map((m) => m.name));
    const addedDeps = (curr.modules ?? [])
      .filter((m) => !prevModuleNames.has(m.name))
      .map((m) => m.name);

    const direction = growth >= 0 ? 'grew' : 'shrank';
    const parts = [
      `Entry ${entry} ${direction} from ${formatBytes(prev.sizeBytes)} to ${formatBytes(curr.sizeBytes)} (${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%).`,
    ];

    if (addedDeps.length > 0) {
      parts.push(`Added dependencies: ${addedDeps.join(', ')}.`);
    }

    return parts.join(' ');
  }

  async loadHistory(pm: import('./persistence').PersistenceManager): Promise<void> {
    this.history = await pm.load();
  }

  async saveHistory(pm: import('./persistence').PersistenceManager): Promise<void> {
    await pm.save(this.history);
  }

  private findMatchingMetric(entryPattern: string): EntryMetrics | undefined {
    const exact = this.currentMetrics.get(entryPattern);
    if (exact) return exact;

    const regex = globToRegex(entryPattern);
    for (const [entry, metric] of this.currentMetrics) {
      if (regex.test(entry)) return metric;
    }
    return undefined;
  }

  getEntryMetrics(entry: string): EntryMetrics | undefined {
    return this.currentMetrics.get(entry);
  }

  getHistory(): ReadonlyArray<HistoryEntry> {
    return this.history;
  }

  setHistory(history: HistoryEntry[]): void {
    this.history = history;
  }

  reset(): void {
    this.currentMetrics.clear();
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
