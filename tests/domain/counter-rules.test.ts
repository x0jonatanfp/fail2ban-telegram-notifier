import { describe, expect, it } from "vitest";
import { applyBan, applyReset } from "../../src/domain/services/counter-rules.ts";
import { emptyCounterState } from "../../src/domain/entities/counter-state.ts";

const permanent = new Set(["recidive"]);

describe("counter-rules", () => {
  it("ban normal: daily+1 y last=ahora", () => {
    const next = applyBan(emptyCounterState(), "sshd", permanent, "10:00:00");
    expect(next).toEqual({ daily: 1, permanent: 0, total: 0, last: "10:00:00" });
  });

  it("ban recidive: permanent+1 y last=ahora (f2b.py:105,111)", () => {
    const next = applyBan(
      { daily: 2, permanent: 1, total: 5, last: "09:00:00" },
      "recidive",
      permanent,
      "10:00:00",
    );
    expect(next).toEqual({ daily: 2, permanent: 2, total: 5, last: "10:00:00" });
  });

  it("reset: total += daily, daily=0, permanent intacto, last=ahora", () => {
    const next = applyReset(
      { daily: 3, permanent: 2, total: 10, last: "09:00:00" },
      "00:00:00",
    );
    expect(next).toEqual({ daily: 0, permanent: 2, total: 13, last: "00:00:00" });
  });
});
