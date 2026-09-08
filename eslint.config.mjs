import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      "apps/web/.next/**",
      "packages/db/generated/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  { settings: { next: { rootDir: "apps/web/" } } },
];
