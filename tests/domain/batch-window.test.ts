import { describe, expect, it } from "vitest";
import { msUntilWindowEnd, windowFor } from "../../src/domain/services/batch-window.ts";

describe("windowFor", () => {
  it("alinea ventanas de 3600 a la hora en punto", () => {
    const { start, end } = windowFor(new Date(2026, 9, 10, 14, 23, 11), 3600);
    expect(start).toEqual(new Date(2026, 9, 10, 14, 0, 0));
    expect(end).toEqual(new Date(2026, 9, 10, 15, 0, 0));
  });

  it("alinea ventanas de 900 a cuartos de hora", () => {
    const a = windowFor(new Date(2026, 9, 10, 14, 23, 11), 900);
    expect(a.start).toEqual(new Date(2026, 9, 10, 14, 15, 0));
    expect(a.end).toEqual(new Date(2026, 9, 10, 14, 30, 0));

    // En el borde exacto empieza la ventana nueva.
    const b = windowFor(new Date(2026, 9, 10, 14, 0, 0), 900);
    expect(b.start).toEqual(new Date(2026, 9, 10, 14, 0, 0));
    expect(b.end).toEqual(new Date(2026, 9, 10, 14, 15, 0));
  });

  it("el fin de ventana puede caer a medianoche del día siguiente", () => {
    const { start, end } = windowFor(new Date(2026, 9, 10, 23, 30, 0), 3600);
    expect(start).toEqual(new Date(2026, 9, 10, 23, 0, 0));
    expect(end).toEqual(new Date(2026, 9, 11, 0, 0, 0));
  });

  it("msUntilWindowEnd mide lo que falta para el fin alineado", () => {
    expect(msUntilWindowEnd(new Date(2026, 9, 10, 14, 30, 0), 3600)).toBe(30 * 60 * 1000);
  });
});
