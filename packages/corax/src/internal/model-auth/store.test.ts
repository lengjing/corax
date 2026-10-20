import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("#compiled/just-secrets/index.js", () => ({ secrets: mocks }));
import { readModelSecret, writeModelSecret } from "./store.js";
beforeEach(() => vi.resetAllMocks());
it("round-trips a model secret through the OS secret store", async () => {
  mocks.set.mockResolvedValue(undefined);
  await writeModelSecret("openai-key", "sk-test");
  const stored = mocks.set.mock.calls[0]![0];
  expect(stored.service).toBe("corax");
  expect(stored.name).toBe("openai-key");
  mocks.get.mockResolvedValue("sk-test");
  expect(await readModelSecret("openai-key")).toBe("sk-test");
});
it("treats a missing secret as undefined", async () => {
  mocks.get.mockResolvedValue(null);
  expect(await readModelSecret("openai-key")).toBeUndefined();
});
it("does not leak credential values when secure storage fails", async () => {
  mocks.set.mockRejectedValue(new Error("secret-value"));
  await expect(writeModelSecret("openai-key", "secret-value")).rejects.toThrow(
    "Cannot save to the OS secret store",
  );
});
