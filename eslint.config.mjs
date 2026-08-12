import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      ".pnpm-store/",
      "node_modules/",
      "dist/",
      "coverage/",
      ".wrangler/",
      ".dev.vars*",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  eslintConfigPrettier,
];
