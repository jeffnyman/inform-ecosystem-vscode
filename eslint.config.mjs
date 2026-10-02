import globals from "globals";
import tsLint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
  },
  {
    plugins: {
      "@typescript-eslint": tsLint,
    },

    languageOptions: {
      globals: { ...globals.node },
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],

      curly: "warn",
      eqeqeq: "warn",
      semi: "warn",
      "no-undef": "warn",
      "no-unused-vars": "warn",
      "no-throw-literal": "warn",
    },
  },
];
