import { describe, expect, it } from "vitest";

import { nextSingleScheduleTime } from "#shared/schedule-time.js";

const before = Date.parse("2027-01-01T00:00:00Z");

describe("nextSingleScheduleTime", () => {
  it.each([
    [undefined, "2030-01-01T12:00:00.000Z"],
    ["UTC", "2030-01-01T12:00:00.000Z"],
    ["Asia/Shanghai", "2030-01-01T04:00:00.000Z"],
    ["America/New_York", "2030-01-01T17:00:00.000Z"],
  ])("resolves the declared zone %s", (timezone, expected) => {
    const actual = nextSingleScheduleTime(
      { type: "single", at: "2030-01-01T12:00", timezone },
      before,
    );
    expect(actual).toBe(Date.parse(expected));
  });

  it("uses an explicit offset rather than reinterpreting it in the declared zone", () => {
    expect(
      nextSingleScheduleTime(
        { type: "single", at: "2030-01-01T12:00:00Z", timezone: "Asia/Shanghai" },
        before,
      ),
    ).toBe(Date.parse("2030-01-01T12:00:00Z"));
  });

  it.each([
    ["2027-03-14T02:30", "2027-03-14T07:30:00Z"],
    ["2027-11-07T01:30", "2027-11-07T05:30:00Z"],
  ])("uses the recurring scheduler's DST policy for %s", (at, expected) => {
    expect(
      nextSingleScheduleTime({ type: "single", at, timezone: "America/New_York" }, before),
    ).toBe(Date.parse(expected));
  });

  it("does not rerun a past or already due instant", () => {
    const expression = { type: "single", at: "2030-01-01T12:00", timezone: "UTC" } as const;
    const instant = Date.parse("2030-01-01T12:00:00Z");
    expect(nextSingleScheduleTime(expression, instant)).toBeNull();
    expect(nextSingleScheduleTime(expression, instant + 60_000)).toBeNull();
  });

  it("preserves milliseconds for direct provider callers with ISO instants", () => {
    const at = "2030-01-01T12:00:00.123Z";
    const instant = Date.parse(at);
    expect(nextSingleScheduleTime({ type: "single", at }, instant - 100)).toBe(instant);
    expect(nextSingleScheduleTime({ type: "single", at }, instant)).toBeNull();
  });

  it.each(["05:30", "05:45", "06:00", "06:30", "07:00"])(
    "does not repeat a one-time schedule during the DST fold at %sZ",
    (time) => {
      expect(
        nextSingleScheduleTime(
          { type: "single", at: "2027-11-07T01:30", timezone: "America/New_York" },
          Date.parse(`2027-11-07T${time}:00Z`),
        ),
      ).toBeNull();
    },
  );
});
