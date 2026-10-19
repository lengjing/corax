import { access, cp } from "node:fs/promises";

for (const name of ["LICENSE", "NOTICE"]) {
  const source = new URL(`../../../${name}`, import.meta.url);
  const target = new URL(`../${name}`, import.meta.url);
  try {
    await access(source);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await access(target);
    continue;
  }
  await cp(source, target);
}
