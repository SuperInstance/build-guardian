/**
 * Slack export — Slack Block Kit blocks for CI notifications.
 */

import type { BuildReport } from '../types';
import { formatBytes } from '../types';

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text?: { type: string; text: string; emoji?: boolean }; url?: string; action_id?: string }>;
  accessory?: { type: string; image_url?: string; alt_text?: string };
}

export function toSlack(report: BuildReport): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const hasIssues = report.alerts.length > 0 || report.violations.length > 0;
  const headerEmoji = hasIssues ? '⚠️' : '✅';
  const headerText = hasIssues
    ? `${headerEmoji} *Build Guardian Report* — Issues Detected`
    : `${headerEmoji} *Build Guardian Report* — All Clear`;

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: headerText, emoji: true },
  });

  blocks.push({
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Entries:* ${report.totalEntries}` },
      { type: 'mrkdwn', text: `*Build Time:* ${formatDuration(report.totalBuildTimeMs)}` },
      { type: 'mrkdwn', text: `*Total Size:* ${formatBytes(report.totalSizeBytes)}` },
      { type: 'mrkdwn', text: `*Generated:* ${new Date(report.generatedAt).toISOString()}` },
    ],
  });

  if (report.alerts.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: *Bloat Alerts (${report.alerts.length})*` },
    });

    for (const alert of report.alerts.slice(0, 5)) {
      const pct = `${Math.round(alert.growthPercent * 100)}%`;
      const icon = alert.severity === 'critical' ? '🔴' : '🟡';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${alert.entry}*: ${formatBytes(alert.previousSizeBytes)} → ${formatBytes(alert.currentSizeBytes)} (+${pct})${alert.addedDependencies.length > 0 ? `\n  Added: ${alert.addedDependencies.slice(0, 3).join(', ')}` : ''}`,
        },
      });
    }
  }

  if (report.violations.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:no_entry_sign: *Budget Violations (${report.violations.length})*` },
    });
    for (const v of report.violations.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `• *${v.entry}*: ${v.reason}` },
      });
    }
  }

  if (report.ruleAlerts.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:rotating_light: *Rule Alerts (${report.ruleAlerts.length})*` },
    });
    for (const ra of report.ruleAlerts.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `• [${ra.rule.severity.toUpperCase()}] ${ra.message}` },
      });
    }
  }

  const growing = report.trends.filter((t) => t.direction === 'growing');
  if (growing.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:chart_with_upwards_trend: *Growing Trends (${growing.length})*` },
    });
    for (const t of growing.slice(0, 5)) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `• *${t.entry}*: ${t.summary}` },
      });
    }
  }

  blocks.push({ type: 'divider' });
  const topEntries = [...report.entryMetrics].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 5);
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: ':bar_chart: *Top 5 Largest Entries*' },
  });
  for (const m of topEntries) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `• *${m.entry}*: ${formatBytes(m.sizeBytes)} (${formatDuration(m.buildTimeMs)})` },
    });
  }

  return blocks;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
