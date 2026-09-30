import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["public/vendor/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["public/assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, JSZip: "readonly" },
    },
  },
  {
    // Loaded with a classic <script> tag so it runs before the app.
    files: ["public/assets/js/analytics.js"],
    languageOptions: { sourceType: "script" },
  },
  {
    files: ["tests/**/*.js", "scripts/**/*.js", "*.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: globals.node },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-shadow": ["error", { builtinGlobals: false }],
      "no-use-before-define": ["error", { functions: false, classes: false, variables: true }],
    },
  },
];
