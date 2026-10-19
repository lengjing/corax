import { describe, expect, it } from "vitest";

import {
  readBaggageMember,
  readForwardedAudienceBaggage,
  readForwardedParentSessionBaggage,
  stripCoraxTraceBaggage,
  writeForwardedAudienceBaggage,
  writeForwardedParentSessionBaggage,
} from "#protocol/baggage.js";

const PUBLIC_OUTPUTS = {
  ceiling: { recordInputs: false, recordOutputs: true },
  originAudience: "public",
} as const;
const PARENT = {
  callId: "call-1",
  rootSessionId: "root-session",
  sessionId: "parent-session",
  turn: { id: "turn-1", sequence: 2 },
} as const;

describe("baggage member parsing", () => {
  it.each(["corax.audience", "corax.conversation.id"])("uses the same wire rules for %s", (key) => {
    expect(readBaggageMember(`${key} = public%2Fone+two ; flag ; source=a%3Db`, key)).toEqual({
      value: "public/one+two",
      properties: [{ key: "flag" }, { key: "source", value: "a=b" }],
    });
    expect(readBaggageMember(`${key}=a,${key}=a`, key)).toBe("malformed");
    expect(readBaggageMember(`${key}=%ZZ`, key)).toBe("malformed");
    expect(readBaggageMember(`${key}=value\n`, key)).toBe("malformed");
    expect(readBaggageMember(`${key}=value,vendor=${"a".repeat(8192)}`, key)).toBe("malformed");
    expect(readBaggageMember(`${key}=%FF`, key)).toEqual({ value: "\ufffd", properties: [] });
    expect(readBaggageMember(`${key}=%EF%BB%BFvalue`, key)).toEqual({
      value: "\ufeffvalue",
      properties: [],
    });
  });

  it("decodes audience and property values before applying the policy schema", () => {
    expect(readForwardedAudienceBaggage("corax.audience=%70ublic;ceiling=%691o0")).toEqual({
      originAudience: "public",
      ceiling: { recordInputs: true, recordOutputs: false },
    });
  });
});

describe("readForwardedAudienceBaggage", () => {
  it.each([
    ["public", true, true],
    ["private", true, false],
    ["unknown", false, false],
  ] as const)("reads a %s origin audience with its ceiling", (originAudience, inputs, outputs) => {
    expect(
      readForwardedAudienceBaggage(
        `vendor=value,corax.audience=${originAudience};ceiling=i${inputs ? "1" : "0"}o${outputs ? "1" : "0"}`,
      ),
    ).toEqual({
      ceiling: { recordInputs: inputs, recordOutputs: outputs },
      originAudience,
    });
  });

  it("accepts W3C optional whitespace around separators", () => {
    expect(
      readForwardedAudienceBaggage(
        "vendor=value\t,\t corax.audience \t=\t private \t;\t ceiling \t=\t i1o0 \t",
      ),
    ).toEqual({
      ceiling: { recordInputs: true, recordOutputs: false },
      originAudience: "private",
    });
  });

  it.each([null, "vendor=value", "corax.capture=i1o1"])('returns absent for "%s"', (value) => {
    expect(readForwardedAudienceBaggage(value)).toBe("absent");
  });

  it.each([
    "corax.audience=public",
    "corax.audience=private",
    "corax.audience=public,corax.audience=public;ceiling=i1o1",
    "corax.audience=public;ceiling=i1o1,corax.audience=private;ceiling=i0o0",
    "corax.audience=public;ceiling=i1o1;vendor=yes",
    "corax.audience=public;vendor=yes",
    "corax.audience=public;ceiling=i1o1;ceiling=i0o0",
    "corax.audience=public;ceiling=i2o1",
    "corax.audience=public;ceiling=o1i1",
    "corax.audience=public;ceiling=drop",
    "corax.audience=everyone;ceiling=i1o1",
    "corax.audience=public;ceiling",
    "corax.audience=public;bad property=i1o1",
    "corax.audience",
    "corax.audience=public;ceiling=i1o1\n",
    "corax.audience=public;\vceiling=i1o1",
    "corax.audience=public;\fceiling=i1o1",
    "corax.audience=public;\u00a0ceiling=i1o1",
  ])("fails closed for malformed Corax baggage %s", (value) => {
    expect(readForwardedAudienceBaggage(value)).toBe("malformed");
  });
});

describe("writeForwardedAudienceBaggage", () => {
  it("preserves the assertion at the byte limit and rejects overflow", () => {
    const assertion = "corax.audience=public;ceiling=i0o1";
    const baggage = `vendor=${"a".repeat(8192 - assertion.length - "vendor=,".length)}`;
    const result = writeForwardedAudienceBaggage(baggage, PUBLIC_OUTPUTS);
    expect(new TextEncoder().encode(result).byteLength).toBe(8192);
    expect(readForwardedAudienceBaggage(result!)).toEqual(PUBLIC_OUTPUTS);
    expect(() => writeForwardedAudienceBaggage(`${baggage}a`, PUBLIC_OUTPUTS)).toThrow(
      "Cannot forward baggage: header exceeds 8192 bytes",
    );
    expect(() => writeForwardedAudienceBaggage(`${baggage}\u00e9`, PUBLIC_OUTPUTS)).toThrow(
      "Cannot forward baggage: header exceeds 8192 bytes",
    );
  });

  it("preserves unrelated entries and replaces authored Corax assertions", () => {
    expect(
      writeForwardedAudienceBaggage(
        "first=1,corax.audience=private;ceiling=i1o1,second=2",
        PUBLIC_OUTPUTS,
      ),
    ).toBe("first=1,second=2,corax.audience=public;ceiling=i0o1");
    expect(
      writeForwardedAudienceBaggage("corax.audience=public,corax.capture=i1o1", PUBLIC_OUTPUTS),
    ).toBe("corax.capture=i1o1,corax.audience=public;ceiling=i0o1");
  });

  it("removes malformed authored Corax audience members", () => {
    expect(writeForwardedAudienceBaggage("corax.audience,vendor=value", PUBLIC_OUTPUTS)).toBe(
      "vendor=value,corax.audience=public;ceiling=i0o1",
    );
    expect(
      writeForwardedAudienceBaggage("corax.audience;property=x,vendor=value", PUBLIC_OUTPUTS),
    ).toBe("vendor=value,corax.audience=public;ceiling=i0o1");
  });

  it("removes authored Corax assertions when there is no sampled record decision", () => {
    expect(
      writeForwardedAudienceBaggage("corax.audience=public;ceiling=i1o1,vendor=value", undefined),
    ).toBe("vendor=value");
    expect(
      writeForwardedAudienceBaggage("corax.audience=public;ceiling=i1o1", undefined),
    ).toBeUndefined();
  });
});

describe("forwarded parent session baggage", () => {
  it("round-trips lineage while preserving unrelated members", () => {
    const baggage = writeForwardedParentSessionBaggage("vendor=value", PARENT);
    expect(baggage).toContain("vendor=value");
    expect(readForwardedParentSessionBaggage(baggage!)).toEqual(PARENT);
  });

  it.each([null, "vendor=value"])("returns absent for %s", (value) => {
    expect(readForwardedParentSessionBaggage(value)).toBe("absent");
  });

  it.each([
    "corax.parent_session=not-json",
    `corax.parent_session=${encodeURIComponent(JSON.stringify({ ...PARENT, callId: "" }))}`,
    `corax.parent_session=${encodeURIComponent(JSON.stringify({ ...PARENT, turn: { id: "turn-1" } }))}`,
    `corax.parent_session=${encodeURIComponent(JSON.stringify(PARENT))};extra=yes`,
  ])("rejects malformed lineage %s", (value) => {
    expect(readForwardedParentSessionBaggage(value)).toBe("malformed");
  });
});

describe("stripCoraxTraceBaggage", () => {
  it("removes Corax context while preserving unrelated baggage", () => {
    const carrier = {
      baggage:
        "vendor=value,corax.audience=private;ceiling=i0o0,corax.conversation.id=session-1,corax.parent_session=parent",
    };

    stripCoraxTraceBaggage(carrier);

    expect(carrier.baggage).toBe("vendor=value");
  });

  it("drops an oversized remainder", () => {
    const carrier = {
      baggage: `corax.audience=private,vendor=${"x".repeat(8_192)}`,
    };

    stripCoraxTraceBaggage(carrier);

    expect(carrier.baggage).toBeUndefined();
  });
});
