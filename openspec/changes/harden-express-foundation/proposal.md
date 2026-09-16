## Why

The current Express scaffold proves the basic health, 404, and error-response paths, but it does not yet provide the minimum operational protections expected of a service that will grow beyond a demo. Runtime settings, HTTP security behavior, request limits, observability, and automated quality checks should be explicit before business endpoints are added.

## What Changes

- Add validated environment configuration with documented defaults and an `.env.example` file.
- Add standard security headers, an explicit CORS allowlist, and a 100 KB JSON request-body limit.
- Return safe, consistent JSON responses for malformed or oversized JSON bodies while logging server-side error details.
- Add structured request, startup, shutdown, and error logging with request IDs.
- Establish `/api/v1` as the namespace for future business APIs while preserving `/health` as the liveness endpoint.
- Add a GitHub Actions quality gate that installs dependencies, runs the full check suite, and builds the service.
- Document the runtime configuration, hardening behavior, API convention, and local verification commands.

## Capabilities

### New Capabilities

- `service-hardening`: Validated runtime configuration, HTTP security policy, request protection, structured observability, and CI quality gates for the Express service.

### Modified Capabilities

<!-- Existing express-app-foundation behavior remains compatible, including /health, JSON 404s, and safe 500s. -->

## Impact

- Affected source: `src/app.ts`, `src/server.ts`, plus new configuration and logger modules.
- Affected tests: HTTP behavior and configuration validation coverage under `test/`.
- New runtime dependencies: `cors`, `dotenv`, `helmet`, `pino`, `pino-http`, and `zod`; new development types for CORS.
- New repository automation: `.github/workflows/ci.yml`.
- Existing `/health` behavior remains unchanged; future business routes are documented under `/api/v1`.
