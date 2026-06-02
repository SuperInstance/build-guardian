/**
 * Vite Plugin — auto-runs BuildGuardian after build.
 *
 * Usage:
 *   // vite.config.ts
 *   import { defineConfig } from 'vite';
 *   import { buildGuardianVitePlugin } from './examples/vite-plugin';
 *
 *   export default defineConfig({
 *     plugins: [
 *       buildGuardianVitePlugin({
 *         budgets: [{ entry: 'index', maxSizeBytes: 200 * 1024 }],
 *         persist: true,
 *       }),
 *     ],
 *   });
 */

import type { Plugin, Rollup } from 'vite';
import { BuildBudget, analyzeViteOutput, toMarkdown } from '../src/index';
import { PersistenceManager } from '../src/persistence';
import type { EntryBudget, AlertRule } from '../src/types';

export interface BuildGuardianVitePluginOptions {
  budgets?: EntryBudget[];
  alertRules?: AlertRule[];
  bloatThreshold?: number;
  persist?: boolean;
  historyFile?: string;
  failOnError?: boolean;
}

export function buildGuardianVitePlugin(options: BuildGuardianVitePluginOptions = {}): Plugin {
  return {
    name: 'build-guardian',
    apply: 'build',
    writeBundle(options: NormalizedOutputOptions, bundle: Rollup.OutputAsset[]) {
      const budget = new BuildBudget({ bloatThreshold: options.bloatThreshold });

      if ((options as BuildGuardianVitePluginOptions).budgets) {
        budget.setBudgets((options as BuildGuardianVitePluginOptions).budgets!);
      }

      // Convert Vite bundle to analysis format
      const output: import('../src/adapters/vite-rollup').ViteOutputChunk[] = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk') {
          output.push({
            type: 'chunk',
            fileName,
            name: chunk.name,
            isEntry: chunk.isEntry,
            isDynamicEntry: chunk.isDynamicEntry,
            facadeModuleId: chunk.facadeModuleId ?? undefined,
            modules: chunk.modules
              ? Object.fromEntries(
                  Object.entries(chunk.modules).map(([k, v]) => [k, { renderedLength: v.renderedLength, originalLength: 0 }])
                )
              : undefined,
            code: chunk.code,
          });
        }
      }

      const analyses = analyzeViteOutput(output);

      for (const chunk of analyses) {
        budget.recordEntry({
          entry: chunk.name,
          buildTimeMs: 0, // filled by Vite if available
          sizeBytes: chunk.totalSizeBytes,
          memoryPeakBytes: process.memoryUsage().rss,
          modules: chunk.modules,
          timestamp: Date.now(),
          isLazy: chunk.isLazy,
          hash: chunk.hash,
        });
      }

      if ((options as BuildGuardianVitePluginOptions).alertRules) {
        budget.setAlertRules((options as BuildGuardianVitePluginOptions).alertRules!);
      }

      const report = budget.finalizeBuild();
      console.log('\n' + toMarkdown(report));

      if ((options as BuildGuardianVitePluginOptions).failOnError &&
          (report.violations.length > 0 || report.ruleAlerts.some((r) => r.rule.severity === 'fail'))) {
        process.exit(1);
      }
    },
  };
}

// Type stub for Vite compatibility
interface NormalizedOutputOptions {
  dir?: string;
  format?: string;
}
