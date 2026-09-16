## 1. Tooling Setup

- [x] 1.1 Add ESLint, TypeScript ESLint, Prettier, and Prettier compatibility development dependencies plus `lint`, `format`, `format:check`, `typecheck`, and `check` scripts; verify `npm install` and the scripts are present in `package.json`
- [x] 1.2 Add the ESLint flat config, Prettier config/ignore files, and a full TypeScript check config covering `src/` and `test/`; verify all configuration files are loaded by their respective tools
- [x] 1.3 Add the Node.js/TypeScript/Express project conventions to `openspec/config.yaml` under `context`; verify OpenSpec artifact instructions receive the project context

## 2. Existing Code Adoption

- [x] 2.1 Format the existing source, tests, README, and root configuration files with Prettier; verify `npm run format:check` passes without modifying files
- [x] 2.2 Run ESLint and full TypeScript checking against the existing code, fixing any violations without changing runtime behavior; verify `npm run lint` and `npm run typecheck` pass

## 3. Verification

- [x] 3.1 Run the unified quality gate `npm run check`; verify formatting, linting, type checking, and HTTP tests all pass
