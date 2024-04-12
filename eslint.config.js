import globals from "globals";
import pluginJs from "@eslint/js";
import pluginTs from "typescript-eslint";

export default [
  { ignores: ["client/dist"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...pluginTs.configs.recommended,
];
