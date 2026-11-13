# Pinned upstream build inputs

`workflow-world-local` contains the unmodified non-test TypeScript sources and license from
`vercel/workflow@c11fc40013681fef9afe0b315b1d22284579bbe0` (PR #5235, SQLite Local World).
The original manifest is `upstream-package.json`; the private local manifest resolves workspace/catalog
dependencies to fixed published versions and exposes the sources only to Corax's vendoring build.

Refresh explicitly with `node scripts/refresh-workflow-world-local.mjs` (requires `gh`). The refresh
verifies downloaded files against Git blob hashes and records SHA-256 checksums in `UPSTREAM.json`.
Normal builds use the checked-in files offline and verify every source checksum and the pinned commit.
Make Corax adaptations outside these sources so provenance remains verifiable.

Corax distributes only the bundled JavaScript, declarations, license and provenance. It uses Node's
built-in SQLite driver; no application conversation database or extra native addon is introduced.
