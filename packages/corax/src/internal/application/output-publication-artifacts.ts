import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { OutputPublicationJournal } from "#internal/application/output-publication-journal.js";
import { pathExists } from "#shared/path-exists.js";

export async function assertStagedPublicationExists(
  journal: OutputPublicationJournal,
): Promise<void> {
  await stat(journal.stagedOutputDir);
}

export async function prepareOutputPublication(journal: OutputPublicationJournal): Promise<void> {
  journal.hadOutput = await pathExists(journal.finalOutputDir);
  await mkdir(dirname(journal.finalOutputDir), { recursive: true });
}

export async function backupOutputPublication(journal: OutputPublicationJournal): Promise<void> {
  if (journal.hadOutput) {
    await rename(journal.finalOutputDir, journal.outputBackupPath);
  }
}

export async function installOutputPublication(
  journal: OutputPublicationJournal,
  afterOutputInstall: () => Promise<void>,
): Promise<void> {
  await rename(journal.stagedOutputDir, journal.finalOutputDir);
  await afterOutputInstall();
}

export async function rollbackOutputPublication(journal: OutputPublicationJournal): Promise<void> {
  const results = await Promise.allSettled([
    rollbackArtifact({
      backupPath: journal.outputBackupPath,
      finalPath: journal.finalOutputDir,
      hadPrevious: journal.hadOutput,
      stagedPath: journal.stagedOutputDir,
    }),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to restore the previous build publication.");
  }
}

export async function removeOutputPublicationBackups(
  journal: OutputPublicationJournal,
): Promise<void> {
  await rm(journal.outputBackupPath, { force: true, recursive: true });
}

async function rollbackArtifact(input: {
  readonly backupPath: string;
  readonly finalPath: string;
  readonly hadPrevious: boolean;
  readonly stagedPath: string;
}): Promise<void> {
  if (await pathExists(input.backupPath)) {
    if (!(await pathExists(input.stagedPath)) && (await pathExists(input.finalPath))) {
      await mkdir(dirname(input.stagedPath), { recursive: true });
      await rename(input.finalPath, input.stagedPath);
    } else {
      await rm(input.finalPath, { force: true, recursive: true });
    }
    await rename(input.backupPath, input.finalPath);
    return;
  }

  if (
    !input.hadPrevious &&
    !(await pathExists(input.stagedPath)) &&
    (await pathExists(input.finalPath))
  ) {
    await mkdir(dirname(input.stagedPath), { recursive: true });
    await rename(input.finalPath, input.stagedPath);
  }
}
