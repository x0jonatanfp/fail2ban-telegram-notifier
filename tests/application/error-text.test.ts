import { describe, expect, it } from "vitest";
import { errText } from "../../src/application/error-text.ts";

describe("errText", () => {
  it("devuelve el mensaje de un Error", () => {
    expect(errText(new Error("algo falló"))).toBe("algo falló");
    expect(errText(new TypeError("tipo inválido"))).toBe("tipo inválido");
  });

  it("convierte a texto cualquier valor no-Error", () => {
    expect(errText("texto plano")).toBe("texto plano");
    expect(errText(42)).toBe("42");
    expect(errText(undefined)).toBe("undefined");
    expect(errText({ code: "EIO" })).toBe("[object Object]");
  });
});
