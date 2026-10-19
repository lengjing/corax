# Corax core

This package contains the Corax runtime, based on the upstream eve framework.
The compiler, durable workflow execution, tools, channels, client APIs, and CLI
are retained from the upstream framework.

Build from the repository root with `bun run build:core`, or build the framework
and the application together with `bun run build`.

Built-in extensions are maintained in this package's `src` tree. No sibling
extension packages or reference repository are needed. Runtime documentation
ships in `docs/`; upstream license and attribution ship in `LICENSE` and `NOTICE`.
