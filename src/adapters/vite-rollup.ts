/**
 * Vite / Rollup adapter
 */

import type { ModuleEntry, ChunkAnalysis } from '../types';

export interface ViteBuildOutput {
  output: ViteOutputChunk[];
}

export interface ViteOutputChunk {
  type: 'chunk' | 'asset';
  fileName: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  facadeModuleId?: string;
  moduleIds?: string[];
  modules?: Record<string, { renderedLength: number; originalLength: number }>;
  imports?: string[];
  dynamicImports?: string[];
  referencedFiles?: string[];
  viteMetadata?: {
    importedCss?: string[];
    importedAssets?: string[];
  };
  code?: string;
}

export interface RollupPluginMeta {
  chunks?: Array<{
    fileName: string;
    name?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    facadeModuleId?: string;
    modules?: Record<string, { renderedLength: number }>;
    imports?: string[];
    dynamicImports?: string[];
  }>;
  assets?: Array<{
    fileName: string;
    name?: string;
    source: string | Buffer;
    type: 'asset';
  }>;
}

export function analyzeViteOutput(output: ViteBuildOutput | ViteOutputChunk[]): ChunkAnalysis[] {
  const chunks = Array.isArray(output) ? output : output.output;
  const results: ChunkAnalysis[] = [];

  for (const chunk of chunks) {
    if (chunk.type === 'asset') continue;

    const modules: ModuleEntry[] = [];
    if (chunk.modules) {
      for (const [modulePath, moduleData] of Object.entries(chunk.modules)) {
        modules.push({
          name: cleanViteModulePath(modulePath),
          sizeBytes: moduleData.renderedLength ?? 0,
        });
      }
    }

    results.push({
      name: chunk.name ?? chunk.fileName.replace(/\.\w+$/, ''),
      totalSizeBytes: chunk.code?.length ?? modules.reduce((s, m) => s + m.sizeBytes, 0),
      modules,
      assetFile: chunk.fileName,
      isLazy: chunk.isDynamicEntry ?? false,
      chunkType: chunk.isEntry ? 'entry' : 'chunk',
      hash: extractHashFromFilename(chunk.fileName),
      entryOrigin: chunk.facadeModuleId
        ? chunk.facadeModuleId.replace(/.*\//, '').replace(/\.\w+$/, '')
        : undefined,
    });
  }

  return results;
}

export function analyzeRollupOutput(meta: RollupPluginMeta | RollupPluginMeta[]): ChunkAnalysis[] {
  const metas = Array.isArray(meta) ? meta : [meta];
  const results: ChunkAnalysis[] = [];

  for (const m of metas) {
    if (m.chunks) {
      for (const chunk of m.chunks) {
        const modules: ModuleEntry[] = [];
        if (chunk.modules) {
          for (const [modulePath, moduleData] of Object.entries(chunk.modules)) {
            modules.push({
              name: cleanViteModulePath(modulePath),
              sizeBytes: moduleData.renderedLength ?? 0,
            });
          }
        }

        results.push({
          name: chunk.name ?? chunk.fileName.replace(/\.\w+$/, ''),
          totalSizeBytes: modules.reduce((s, mod) => s + mod.sizeBytes, 0),
          modules,
          assetFile: chunk.fileName,
          isLazy: chunk.isDynamicEntry ?? false,
          chunkType: chunk.isEntry ? 'entry' : 'chunk',
          entryOrigin: chunk.facadeModuleId
            ? chunk.facadeModuleId.replace(/.*\//, '').replace(/\.\w+$/, '')
            : undefined,
        });
      }
    }
  }

  return results;
}

function cleanViteModulePath(p: string): string {
  return p.replace(/^\/?/, '').replace(/^\.\//, '').replace(/^node_modules\/\.vite\//, '').replace(/\?v=[\da-f]+$/, '').trim();
}

function extractHashFromFilename(filename: string): string | undefined {
  const match = filename.match(/[.-]([a-f0-9]{4,})\.\w+$/);
  return match?.[1];
}
