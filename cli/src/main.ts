import { stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";

/** Select the target before importing the framework or evaluating user modules. */
export async function main(argv: string[]): Promise<void> {
  let root = process.cwd();
  const args: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--root requires a project directory.");
      root = resolve(value);
    } else if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) throw new Error("--root requires a project directory.");
      root = resolve(value);
    } else {
      args.push(arg);
    }
  }

  const help = args.includes("--help") || args.includes("-h");
  if (args.length === 0) args.push("--help");
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a project directory: ${root}`);
  if (!help && ["dev", "build"].includes(args[0]!)) {
    if (!(await Bun.file(join(root, "agent.ts")).exists())) {
      throw new Error(`Missing ${join(root, "agent.ts")}. Point --root to your agent project.`);
    }
  }

  const environment = Bun.file(join(root, ".env"));
  const fileValues = await environment.exists() ? parseEnv(await environment.text()) : {};
  // Leave full loading to the framework so dev-mode reload can refresh file-owned values.
  process.env.CORAX_CONFIG_ROOT = root;
  process.env.CORAX_DATA_DIR = resolve(root, process.env.CORAX_DATA_DIR || fileValues.CORAX_DATA_DIR || "data");
  process.chdir(root);

  if (["dev", "start"].includes(args[0]!) && !help) {
    if (!args.some((arg) => arg === "--host" || arg.startsWith("--host=")))
      args.push("--host", process.env.CORAX_HOST || fileValues.CORAX_HOST || "127.0.0.1");
    if (!args.some((arg) => arg === "--port" || arg.startsWith("--port=")))
      args.push("--port", process.env.CORAX_PORT || fileValues.CORAX_PORT || "2000");
    if (args[0] === "dev") args.push("--no-default-extensions");
  }

  const { runCoraxCli } = await import("corax/bin");
  await runCoraxCli(args);
}
