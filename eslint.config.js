// ESLint flat config: solo eslint + typescript-eslint. Sin Prettier por decisión
// del proyecto (ver docs/PLAN.md §4, decisión 14).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // Los adaptadores lanzan Error con contexto; permitir `any` puntual en el
      // parseo de JSON de Telegram con un cast explícito está prohibido, así que
      // se exige el uso de `unknown` + narrowing.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
);
