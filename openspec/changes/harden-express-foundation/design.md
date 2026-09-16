## Context

The existing service has a small `createApp` factory, a standalone `/health` router, centralized 404/500 responses, and a `server.ts` entrypoint. TypeScript is strict, the project is CommonJS-compiled, and `npm run check` is the local quality gate. See `proposal.md` and `specs/service-hardening/spec.md` for the motivation and behavior contract.

## Goals / Non-Goals

**Goals:**

- Keep application construction testable without binding a network port.
- Make all runtime behavior driven by one validated configuration object.
- Put security, CORS, request parsing, request logging, and error mapping in a predictable middleware order.
- Keep client-facing errors stable and free of internal diagnostics.
- Make the default development experience work without a `.env` file.

**Non-Goals:**

- Authentication, authorization, rate limiting, database integration, OpenAPI generation, or business-domain routes.
- A production log aggregation deployment or a custom logging transport.
- Changing the existing `/health` response contract.

## Decisions

### Configuration and environment loading

Create a small configuration module that accepts an environment-like record, validates it with Zod, normalizes numeric and comma-separated values, and returns an `AppConfig` object. `server.ts` loads `.env` through `dotenv` before calling the loader; tests can pass an explicit record so validation is deterministic and does not mutate global process state.

The loader will reject invalid ports, environment names, log levels, hosts, and CORS origins. CORS entries are exact `http`/`https` origins, not arbitrary URL paths or wildcard patterns. The empty string means no browser origins are trusted.

Alternatives considered: reading `process.env` throughout the application would make defaults inconsistent and tests brittle; a hand-written parser would duplicate validation rules and provide less useful error aggregation.

### Middleware and error boundary

`createApp` will accept optional `{ config, logger, registerRoutes }` options so tests can inject configuration and a silent logger. Middleware order will be request logging, Helmet, CORS, bounded JSON parsing, health/business routes, 404 handling, and the final error handler. Business routes remain supplied through the existing route registrar and are expected to mount under `/api/v1`.

The error handler will recognize body-parser errors for an oversized entity and invalid JSON, mapping them to 413 and 400 respectively. All other errors retain the existing safe 500 response. If headers were already sent, the error is delegated to Express rather than attempting a second response.

Alternatives considered: route-local parsing and error handling would allow inconsistent limits and response shapes; exposing Express's default error page would leak implementation details.

### Security and CORS policy

Use Helmet's default baseline headers. Use the CORS middleware with an exact allowlist callback: requests without an `Origin` header remain usable, while only configured origins receive an allow header. Credentials are not enabled because this foundation has no cookie-based authentication contract.

Alternatives considered: allowing `*` is convenient but unsafe once browser clients and authenticated APIs are introduced; enabling credentials now would create a stronger policy than the current service needs.

### Structured logging

Use Pino for the base logger and `pino-http` for request lifecycle logs. The base logger includes the service name and environment and redacts authorization, proxy-authorization, cookie, set-cookie, and API-key request headers plus response `Set-Cookie`; `pino-http` adds method, URL, status, response time, and a generated or accepted `X-Request-Id`. The error middleware writes server-side error objects through the request logger while returning only the safe JSON contract.

Alternatives considered: `console.log` is not reliably machine-readable and does not provide request correlation; a larger logging framework is unnecessary for this single-process foundation.

### CI and documentation

Add a GitHub Actions workflow using the committed lockfile, Node.js 20, `npm ci`, `npm run check`, and `npm run build`. Update the README and add `.env.example` as the source of discoverable local configuration. Generated output and real `.env` files remain ignored.

## Risks / Trade-offs

- [Risk] A strict CORS allowlist can surprise a browser client during local development → document `CORS_ORIGINS` and provide an explicit example origin; same-origin and non-browser requests remain unaffected.
- [Risk] A 100 KB limit may reject a future legitimate upload → keep this JSON-specific and require a deliberate, spec-backed change before increasing it.
- [Risk] JSON logs are less readable in a local terminal → retain concise startup/shutdown messages as structured records and document how to inspect them; machine-readable output is the operational contract.
- [Risk] CI depends on GitHub-hosted actions → keep the workflow limited to standard actions and the repository's existing npm scripts so it can be reproduced locally.

## Migration Plan

1. Install the runtime and type dependencies and commit the lockfile changes.
2. Deploy with the documented defaults; set `CORS_ORIGINS` explicitly for browser clients.
3. Verify `/health`, security headers, body-limit responses, and logs in the target environment.
4. Roll back by reverting the application and dependency change together if startup validation or middleware behavior is incompatible; existing `/health`, 404, and safe 500 contracts remain the compatibility baseline.
