import { defineConfig } from "vitest/config";

// Los tests nunca hablan con Telegram real: todos los adaptadores se prueban
// contra servidores HTTP falsos en 127.0.0.1. Ver tests/test/helpers.ts.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // El composition root es puro wiring (monta adaptadores y arranca): no
      // tiene lógica propia que testear. Ver docs/PLAN.md §7.
      exclude: ["src/index.ts"],
    },
  },
});
