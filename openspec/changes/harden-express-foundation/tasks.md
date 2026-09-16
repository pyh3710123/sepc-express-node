## 1. Dependencies and configuration

- [x] 1.1 Add `cors`, `dotenv`, `helmet`, `pino`, `pino-http`, and `zod` runtime dependencies plus `@types/cors`, and verify `npm install` updates `package.json` and `package-lock.json` successfully
- [x] 1.2 Implement validated environment loading with documented defaults, normalized CORS origins, and fail-fast errors, and verify configuration unit tests cover defaults and invalid values
- [x] 1.3 Add `.env.example` for all supported runtime variables and verify real `.env` files remain ignored by `.gitignore`

## 2. Application hardening

- [x] 2.1 Implement the Pino base logger with sensitive-header redaction and request correlation, and verify structured logs contain method, URL, status, duration, and request ID without credential or cookie values
- [x] 2.2 Update the Express app factory to apply Helmet, hide the Express fingerprint header, exact CORS allowlisting, and a 100 KB JSON parser limit, and verify allowed/denied origins and security headers with HTTP tests
- [x] 2.3 Extend centralized error handling for malformed and oversized JSON while preserving safe 404/500 responses, and verify status codes and response bodies never expose internal details
- [x] 2.4 Update the server entrypoint to load validated configuration, use structured startup/shutdown/fatal logs, and preserve graceful signal handling; verify a custom-port live smoke test starts and stops cleanly

## 3. Regression and contract tests

- [x] 3.1 Expand the test suite for configuration, CORS, security headers, request-body limits, malformed JSON, request IDs, and existing health/404/500 behavior, and verify all tests pass
- [x] 3.2 Document `/api/v1` for future business routes while retaining `/health` as the liveness endpoint, and verify the README, project context, and route tests reflect both contracts

## 4. Automation and final verification

- [x] 4.1 Add GitHub Actions CI for pushes and pull requests using `npm ci`, `npm run check`, and `npm run build`, and verify the workflow references the committed lockfile and supported Node.js version
- [x] 4.2 Run the full local quality gate and production build, then validate the OpenSpec change and repository health with `npm run check`, `npm run build`, `openspec validate --all`, and `openspec doctor`
