import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { build as buildNitro, copyPublicAssets, prepare, prerender } from "nitro/builder";
import type { Nitro } from "nitro/types";

import {
  resolveInstalledPackageInfo,
  resolvePackageSourceFilePath,
} from "#internal/application/package.js";
import {
  prepareCoraxVersionedCacheDirectory,
  writeCoraxVersionedCacheMetadata,
} from "#internal/application/cache-metadata.js";
import {
  createApplicationBuildWorkspace,
  removeApplicationBuildWorkspace,
  type ApplicationBuildWorkspace,
} from "#internal/application/build-workspace.js";
import {
  ApplicationBuildProfiler,
  createApplicationBuildProfile,
  measureApplicationBuildOutput,
  writeApplicationBuildProfile,
} from "#internal/application/build-profile.js";
import {
  publishApplicationBuildArtifacts,
  RecoverablePublicationError,
} from "#internal/application/output-publication.js";
import { stageProductionCompilerArtifacts } from "#internal/application/production-compiler-artifacts.js";
import { createProductionApplicationNitro } from "#internal/nitro/host/create-application-nitro.js";
import { tryReadExtensionBuildConfig } from "#internal/nitro/host/build-extension.js";
import {
  prepareProductionApplicationHost,
  refreshProductionCompiledArtifacts,
} from "#internal/nitro/host/prepare-application-host.js";
import { createProductionNitroArtifactsConfig } from "#internal/nitro/host/artifacts-config.js";
import { prewarmAppSandboxes } from "#execution/sandbox/prewarm.js";
import type { ApplicationBuildOptions } from "#internal/nitro/host/types.js";
import { toErrorMessage } from "#shared/errors.js";
import { resolveDiscoveryProject } from "#discover/project.js";
import { createDiskRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";

async function phase<T>(
  profiler: ApplicationBuildProfiler | undefined,
  name: string,
  task: () => T | Promise<T>,
): Promise<T> {
  return profiler ? profiler.measure(name, task) : task();
}

function assertProfileOutsideOutput(profile: string | undefined, output: string): void {
  if (profile === undefined) return;
  const path = relative(output, profile);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))) {
    throw new Error(
      `Build profile path ${profile} must be outside the published output directory ${output}.`,
    );
  }
}

/** Builds a standalone Bun service while preserving recoverable, atomic output publication. */
export async function buildApplication(
  rootDir: string,
  options: ApplicationBuildOptions,
): Promise<string> {
  const profilePath =
    options.profileOutputPath === undefined ? undefined : resolve(options.profileOutputPath);
  const profiler = profilePath === undefined ? undefined : new ApplicationBuildProfiler();
  const extension = await phase(profiler, "extension.check", () =>
    tryReadExtensionBuildConfig(rootDir),
  );
  if (extension)
    throw new Error(
      `Package "${extension.packageName}" is an corax extension. Run \`corax extension build\` instead of \`corax build\`.`,
    );
  const project = await phase(profiler, "project.resolve", () => resolveDiscoveryProject(rootDir));
  const workspace = await phase(profiler, "workspace.create", () =>
    createApplicationBuildWorkspace(project.appRoot),
  );
  let preserveWorkspace = false;
  let buildError: unknown;
  let output: string;
  try {
    output = await buildInWorkspace(workspace, options, profiler);
  } catch (error) {
    buildError = error;
    preserveWorkspace = error instanceof RecoverablePublicationError;
    throw error;
  } finally {
    if (!preserveWorkspace) {
      try {
        await phase(profiler, "workspace.remove", () => removeApplicationBuildWorkspace(workspace));
      } catch (cleanupError) {
        if (buildError !== undefined)
          throw new AggregateError([buildError, cleanupError], "Agent build and cleanup failed.");
        throw cleanupError;
      }
    }
  }
  if (profiler && profilePath) {
    try {
      assertProfileOutsideOutput(profilePath, output);
      const timing = profiler.finish();
      await writeApplicationBuildProfile(
        profilePath,
        createApplicationBuildProfile({
          target: "local",
          timing,
          output: await measureApplicationBuildOutput(output),
        }),
      );
    } catch (error) {
      console.warn(`corax: could not write optional build profile: ${toErrorMessage(error)}`);
    }
  }
  return output;
}

async function buildInWorkspace(
  workspace: ApplicationBuildWorkspace,
  options: ApplicationBuildOptions,
  profiler: ApplicationBuildProfiler | undefined,
): Promise<string> {
  const host = await phase(profiler, "host.prepare", () =>
    prepareProductionApplicationHost(workspace),
  );
  const sandboxScope = createProductionNitroArtifactsConfig(workspace.appRoot).sandboxScope;
  const nitro = await phase(profiler, "nitro.create", () =>
    createProductionApplicationNitro(host, {
      buildDir: workspace.nitro.buildDir,
      outputDir: workspace.publication.output.stagedDir,
      publicRoutePrefix: options.publicRoutePrefix,
      workspaceMember: options.workspaceMember,
    }),
  );
  try {
    if (!options.skipSandboxPrewarm) {
      await phase(profiler, "sandbox.prewarm", () =>
        prewarmAppSandboxes({
          appRoot: host.appRoot,
          compiledArtifactsSource: createDiskRuntimeCompiledArtifactsSource(
            workspace.compiler.rootDir,
            {
              moduleMapLoaderPath: resolvePackageSourceFilePath(
                "src/internal/authored-module-map-loader.ts",
              ),
              sandboxAppRoot: host.appRoot,
              sandboxScope,
            },
          ),
          log(message: string) {
            console.log(message);
          },
        }),
      );
      await refreshProductionCompiledArtifacts(host, workspace.host.artifactsDir);
    }
    await buildOutput(nitro, profiler);
    const manifest = host.compileResult.manifest;
    await mkdir(dirname(workspace.publication.summary.stagedPath), { recursive: true });
    await writeFile(
      workspace.publication.summary.stagedPath,
      JSON.stringify(
        {
          kind: "corax-agent",
          schemaVersion: 1,
          generatorVersion: resolveInstalledPackageInfo().version,
          agent: {
            name: manifest.config.name,
            description: manifest.config.description,
            model: manifest.config.model?.id,
          },
          tools: manifest.tools.map((tool) => tool.name),
          channels: manifest.channelRoutes.effective.map((channel) => channel.name),
          schedules: manifest.schedules.map((schedule) => schedule.name),
        },
        null,
        2,
      ),
    );
    await phase(profiler, "compiler-artifacts.stage", () =>
      stageProductionCompilerArtifacts({
        compilerArtifactsRoot: workspace.compiler.artifactsDir,
        outputDir: workspace.publication.output.stagedDir,
      }),
    );
  } finally {
    await phase(profiler, "nitro.close", () => nitro.close());
  }
  await phase(profiler, "output.publish", () =>
    publishApplicationBuildArtifacts({
      appRoot: workspace.appRoot,
      finalOutputDir: workspace.publication.output.finalDir,
      finalSummaryPath: workspace.publication.summary.finalPath,
      scratchDir: workspace.rootDir,
      stagedOutputDir: workspace.publication.output.stagedDir,
      stagedSummaryPath: workspace.publication.summary.stagedPath,
    }),
  );
  return workspace.publication.output.finalDir;
}

async function buildOutput(
  nitro: Nitro,
  profiler: ApplicationBuildProfiler | undefined,
): Promise<void> {
  const output = nitro.options.output.dir.replace(/[\\/]+$/, "");
  await phase(profiler, "nitro.cache.prepare", () => prepareCoraxVersionedCacheDirectory(output));
  await phase(profiler, "nitro.prepare", () => prepare(nitro));
  await phase(profiler, "nitro.public-assets", () => copyPublicAssets(nitro));
  await phase(profiler, "nitro.prerender", () => prerender(nitro));
  await phase(profiler, "nitro.bundle", () => buildNitro(nitro));
  await phase(profiler, "nitro.cache.write", () => writeCoraxVersionedCacheMetadata(output));
}
