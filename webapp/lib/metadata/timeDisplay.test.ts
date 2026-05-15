import { describe, expect, it } from "vitest";
import { formatRawTime } from "./timeDisplay";

describe("formatRawTime", () => {
  it("formats sub-hour timestamps", () => {
    expect(formatRawTime(61_234)).toBe("1:01.234");
  });

  it("formats hour-plus timestamps", () => {
    expect(formatRawTime(3_661_234)).toBe("1:01:01.234");
  });

  it("clamps negative timestamps to zero", () => {
    expect(formatRawTime(-10)).toBe("0:00.000");
  });
});
