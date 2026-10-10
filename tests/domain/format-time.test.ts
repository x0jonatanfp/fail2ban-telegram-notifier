import { describe, expect, it } from "vitest";
import { formatLocalTime } from "../../src/domain/services/format-time.ts";

describe("formatLocalTime", () => {
  it("formatea a HH:MM:SS con ceros a la izquierda", () => {
    expect(formatLocalTime(new Date(2026, 9, 10, 3, 4, 5))).toBe("03:04:05");
  });
});
