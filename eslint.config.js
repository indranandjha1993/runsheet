import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

const layerBoundaries = {
  "import/no-restricted-paths": [
    "error",
    {
      zones: [
        { target: "./services/*/src/domain", from: "./services/*/src/application" },
        { target: "./services/*/src/domain", from: "./services/*/src/adapters" },
        { target: "./services/*/src/domain", from: "./services/*/src/infra" },
        { target: "./services/*/src/application", from: "./services/*/src/adapters" },
        { target: "./services/*/src/application", from: "./services/*/src/infra" },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "contracts/scripts/**",
      "spec/scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { defaultProject: "tsconfig.eslint.json" },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      ...layerBoundaries,
      complexity: ["error", 10],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "max-depth": ["error", 3],
      "no-console": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
  { files: ["**/*.test.ts"], rules: { "max-lines-per-function": "off" } },
  {
    files: ["*.js", "*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: null } },
  },
);
