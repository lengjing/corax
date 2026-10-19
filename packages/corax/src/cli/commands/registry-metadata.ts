import { z } from "#compiled/zod/index.js";

const RegistrySetupSchema = z.object({
  package: z.string().min(1),
  bin: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const ExactPackageNameSchema = z
  .string()
  .regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u);

const PnpmBuildScriptPolicySchema = z.object({
  packages: z.array(ExactPackageNameSchema).min(1),
  optional: z.literal(true),
  recommendedAction: z.literal("ignore-optional"),
  reason: z.string().min(1),
});

const CoraxRegistryMetadataSchema = z.object({
  requires: z.string().optional(),
  docs: z.string().min(1).optional(),
  implementation: z.enum(["native", "chat-sdk"]).optional(),
  hidden: z.literal(true).optional(),
  install: z
    .object({
      pnpm: z.object({ buildScripts: z.array(PnpmBuildScriptPolicySchema).min(1) }).optional(),
    })
    .optional(),
  setup: z
    .union([RegistrySetupSchema, z.array(RegistrySetupSchema).min(1)])
    .transform((setup) => (Array.isArray(setup) ? setup : [setup]))
    .optional(),
});

const CoraxRegistryItemMetadataSchema = z.object({
  meta: z.object({ corax: CoraxRegistryMetadataSchema.optional() }).optional(),
});

const OfficialRegistryCatalogSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1),
      meta: z.object({ corax: CoraxRegistryMetadataSchema.optional() }).optional(),
    }),
  ),
});

const RegistryPresentationManifestSchema = CoraxRegistryItemMetadataSchema.extend({
  title: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  files: z.array(z.object({ target: z.string() })).optional(),
});

export type RegistrySearchMetadata = Pick<
  z.infer<typeof CoraxRegistryMetadataSchema>,
  "docs" | "hidden" | "implementation"
>;

/** Parses corax-owned metadata from a registry item manifest. */
export function coraxMetadataFromRegistryItem(item: unknown) {
  return CoraxRegistryItemMetadataSchema.parse(item).meta?.corax;
}

/** Extracts search metadata from the corax-owned official registry catalog. */
export function parseOfficialRegistrySearchMetadata(
  input: unknown,
): ReadonlyMap<string, RegistrySearchMetadata> {
  const { items } = OfficialRegistryCatalogSchema.parse(input);
  const metadata = new Map<string, RegistrySearchMetadata>();
  for (const item of items) {
    const { docs, hidden, implementation } = item.meta?.corax ?? {};
    if (docs !== undefined || hidden !== undefined || implementation !== undefined) {
      metadata.set(item.name, { docs, hidden, implementation });
    }
  }
  return metadata;
}

/** Parses the fields used by the human-readable registry item view. */
export function parseRegistryPresentationManifest(input: unknown) {
  return RegistryPresentationManifestSchema.safeParse(input).data;
}
