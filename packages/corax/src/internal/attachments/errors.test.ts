import { describe, expect, it } from "vitest";

import { CoraxAttachmentError } from "#internal/attachments/errors.js";

describe("CoraxAttachmentError", () => {
  it("carries the kind discriminator and message through the Error base", () => {
    const error = new CoraxAttachmentError({
      kind: "resolver-threw",
      message: "active adapter resolver threw while staging an attachment",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CoraxAttachmentError");
    expect(error.kind).toBe("resolver-threw");
    expect(error.message).toBe("active adapter resolver threw while staging an attachment");
    expect(error.adapterKind).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("preserves the adapterKind and cause when provided", () => {
    const cause = new Error("upstream 503");
    const error = new CoraxAttachmentError({
      adapterKind: "slack",
      cause,
      kind: "resolver-threw",
      message: "slack attachment fetch failed",
    });

    expect(error.adapterKind).toBe("slack");
    expect(error.cause).toBe(cause);
  });

  it("is distinguishable from a plain Error via instanceof", () => {
    const error = new CoraxAttachmentError({ kind: "resolver-threw", message: "x" });
    expect(error instanceof CoraxAttachmentError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});
