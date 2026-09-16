## 1. Project Setup

- [x] 1.1 Create `package.json` with the Node.js engine constraint, Express runtime dependency, TypeScript/tsx/type-definition/Supertest development dependencies, and `build`, `start`, `dev`, and `test` scripts; verify `npm install` and `npm run build` succeed
- [x] 1.2 Add `tsconfig.json`, `.gitignore`, and README documentation for prerequisites, installation, build/startup commands, port configuration, and the health endpoint; verify the documented commands match `package.json`

## 2. Express Application

- [x] 2.1 Create the TypeScript Express app factory and health route; verify `GET /health` returns HTTP 200, JSON content type, and `{ "status": "ok" }`
- [ ] 2.2 Create the TypeScript server entry point with `PORT` environment-variable support and a `3000` default; verify the compiled service starts on both the default and a custom port
- [x] 2.3 Add JSON responses for unmatched routes and unexpected errors without exposing stack traces; verify 404 and 500 response contracts

## 3. Verification

- [x] 3.1 Add TypeScript automated HTTP contract tests for health, 404, and 500 behavior using the app without binding a persistent port; verify `npm test` exits successfully
- [x] 3.2 Run the full project smoke check (`npm test`, `npm run build`, then start the compiled service on a temporary custom port and request `/health`); verify all checks pass and the server can be stopped cleanly
