/**
 * Bundle Analyzer — extracts per-module sizes from bundler stats.
 */

import type { ModuleEntry, ChunkAnalysis } from './types';

export type { ChunkAnalysis };

// Re-export WebpackStatsJson for external use
export interface WebpackStatsJson {
  chunks?: Array<{
    id: number;
    names?: string[];
    size?: number;
    parents?: number[];
    children?: number[];
    initial?: boolean;
    rendered?: boolean;
    hash?: string;
    entry?: boolean;
    reason?: string;
  }>;
  modules?: Array<{
    name?: string;
    size?: number;
    chunks?: number[];
    modules?: Array<{
      name?: string;
      size?: number;
    }>;
  }>;
  assets?: Array<{
    name?: string;
    chunks?: number[];
    size?: number;
  }>;
  chunksByEntryPoint?: Record<string, number[]>;
}

interface EsbuildMetafile {
  outputs: Record<string, {
    bytes: number;
    inputs?: Record<string, {
      bytesInOutput?: number;
    }>;
    entryPoint?: string;
  }>;
}

/**
 * Analyze webpack compilation stats — supports multi-compiler, code-split
 * chunks, and lazy-loaded routes.
 */
export function analyzeWebpackStats(statsJson: WebpackStatsJson | WebpackStatsJson[]): ChunkAnalysis[] {
  if (Array.isArray(statsJson)) {
    return statsJson.flatMap((s) => analyzeWebpackStatsSingle(s));
  }
  return analyzeWebpackStatsSingle(statsJson);
}

function analyzeWebpackStatsSingle(statsJson: WebpackStatsJson): ChunkAnalysis[] {
  const chunkMap = new Map<number, ChunkAnalysis>();

  if (statsJson.chunks) {
    for (const chunk of statsJson.chunks) {
      const isLazy = !!(chunk.initial === false || chunk.rendered === false);
      chunkMap.set(chunk.id, {
        name: chunk.names?.[0] ?? String(chunk.id),
        totalSizeBytes: chunk.size ?? 0,
        modules: [],
        parents: chunk.parents ?? [],
        isLazy,
        hash: chunk.hash,
        children: chunk.children ?? [],
        chunkType: chunk.entry ? 'entry' : (chunk.initial ? 'initial' : 'chunk'),
      });
    }
  }

  if (statsJson.chunksByEntryPoint) {
    for (const [entryName, chunkIds] of Object.entries(statsJson.chunksByEntryPoint)) {
      for (const cid of chunkIds) {
        const chunk = chunkMap.get(cid);
        if (chunk) {
          chunk.entryOrigin = entryName;
          if (chunk.name === String(cid)) {
            chunk.name = entryName;
          }
        }
      }
    }
  }

  if (statsJson.modules) {
    for (const mod of statsJson.modules) {
      if (!mod.chunks) continue;

      const subModules = mod.modules;
      if (subModules) {
        for (const sub of subModules) {
          const subEntry: ModuleEntry = {
            name: cleanModuleName(sub.name ?? ''),
            sizeBytes: sub.size ?? 0,
          };
          for (const chunkId of mod.chunks) {
            const analysis = chunkMap.get(chunkId);
            if (analysis) {
              analysis.modules.push(subEntry);
            }
          }
        }
      } else {
        const entry: ModuleEntry = {
          name: cleanModuleName(mod.name ?? ''),
          sizeBytes: mod.size ?? 0,
        };
        for (const chunkId of mod.chunks) {
          const analysis = chunkMap.get(chunkId);
          if (analysis) {
            analysis.modules.push(entry);
          }
        }
      }
    }
  }

  if (statsJson.assets) {
    const assetChunkMap = new Map<number, string>();
    for (const asset of statsJson.assets) {
      if (asset.chunks) {
        for (const cid of asset.chunks) {
          assetChunkMap.set(cid, asset.name ?? '');
        }
      }
    }
    for (const [chunkId, analysis] of chunkMap) {
      analysis.assetFile = assetChunkMap.get(chunkId);
    }
  }

  return Array.from(chunkMap.values());
}

export function analyzeEsbuildMetafile(metafile: EsbuildMetafile): ChunkAnalysis[] {
  const results: ChunkAnalysis[] = [];

  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    const modules: ModuleEntry[] = Object.entries(output.inputs || {}).map(
      ([inputPath, input]) => ({
        name: inputPath,
        sizeBytes: input.bytesInOutput ?? 0,
      }),
    );

    results.push({
      name: outputPath.replace(/\.\w+$/, ''),
      totalSizeBytes: output.bytes,
      modules,
      assetFile: outputPath,
      entryOrigin: output.entryPoint,
    });
  }

  return results;
}

export function normalizeEntryName(name: string): string {
  return name
    .replace(/^pages\//, '')
    .replace(/^src\/pages\//, '')
    .replace(/^src\//, '')
    .replace(/^dist\//, '')
    .replace(/^build\//, '')
    .replace(/\.js$/, '')
    .replace(/\.jsx$/, '')
    .replace(/\.ts$/, '')
    .replace(/\.tsx$/, '')
    .replace(/\.mjs$/, '')
    .replace(/\.cjs$/, '')
    .replace(/\/index$/, '') || 'index';
}

export function isThirdParty(moduleName: string): boolean {
  return (
    moduleName.startsWith('node_modules/') ||
    moduleName.startsWith('./node_modules/') ||
    moduleName.startsWith('../node_modules/') ||
    moduleName.startsWith('external ') ||
    (!moduleName.startsWith('.') && !moduleName.startsWith('/'))
  );
}

export function getTopModules(analyses: ChunkAnalysis[], n: number = 10): ModuleEntry[] {
  const all = analyses.flatMap((a) => a.modules);
  const merged = new Map<string, number>();
  for (const m of all) {
    merged.set(m.name, (merged.get(m.name) ?? 0) + m.sizeBytes);
  }
  return Array.from(merged.entries())
    .map(([name, sizeBytes]) => ({ name, sizeBytes }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, n);
}

export function buildChunkTree(analyses: ChunkAnalysis[]): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  for (const a of analyses) {
    tree.set(a.name, []);
  }
  return tree;
}

function cleanModuleName(raw: string): string {
  return raw
    .replace(/^.\/\s*/, '')
    .replace(/^external\s+/, '')
    .replace(/\s+\d+\s*:\d+$/, '')
    .trim();
}
