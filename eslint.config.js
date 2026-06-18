import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  // Ignore generated / library files
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/components/ui/**",
      "src/lib/utils.js",
    ],
  },

  // Base JS rules (eslint v10 / @eslint/js v10)
  pluginJs.configs.recommended,

  // React rules
  pluginReact.configs.flat.recommended,

  // react-hooks v7 flat config (spread the recommended entry)
  pluginReactHooks.configs.flat["recommended"],

  // Main config for all source files
  {
    files: ["src/**/*.{js,mjs,jsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      // react-refresh v0.5: default export is the plugin object
      "react-refresh": pluginReactRefresh,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      // Turn off base rule in favour of unused-imports version
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
];
