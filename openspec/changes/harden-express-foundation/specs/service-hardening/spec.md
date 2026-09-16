## Purpose

Provides the Express service with explicit runtime configuration, baseline HTTP protections, safe request handling, structured operational visibility, and an automated quality gate before business APIs are introduced.

## ADDED Requirements

### Requirement: Runtime configuration is validated before startup

The service SHALL load configuration from the process environment and SHALL apply these defaults when values are absent: `NODE_ENV=development`, `HOST=0.0.0.0`, `PORT=3000`, `LOG_LEVEL=info`, and an empty CORS origin allowlist. `PORT` MUST be an integer from 0 through 65535, `NODE_ENV` MUST be `development`, `test`, or `production`, and every configured CORS origin MUST be an absolute `http` or `https` origin. Invalid configuration SHALL prevent the server from starting with a non-zero exit status.

#### Scenario: Service starts with documented defaults

- **WHEN** the service starts without optional environment variables
- **THEN** it listens on `0.0.0.0:3000` with development mode, info logging, and no cross-origin browser access configured

#### Scenario: Invalid configuration fails fast

- **WHEN** the service starts with an invalid port, environment name, or CORS origin
- **THEN** startup fails with a configuration error and the HTTP server is not started

### Requirement: HTTP responses include baseline security headers

The service SHALL add standard security headers to HTTP responses, including a header that prevents MIME-type sniffing, without exposing implementation stack traces to clients.

#### Scenario: Health response contains security headers

- **WHEN** a client requests `GET /health`
- **THEN** the 200 JSON response includes `X-Content-Type-Options: nosniff` and other configured baseline security headers

### Requirement: Cross-origin access is controlled by an allowlist

The service SHALL allow browser CORS responses only for origins listed in `CORS_ORIGINS`, which is a comma-separated list of origins. With an empty allowlist, requests without an `Origin` header SHALL continue to work and requests with any `Origin` header SHALL receive no CORS allow header. A denied origin SHALL not be reflected in `Access-Control-Allow-Origin`.

#### Scenario: Configured origin is allowed

- **WHEN** a request includes an `Origin` header matching a configured CORS origin
- **THEN** the response includes `Access-Control-Allow-Origin` set to that exact origin

#### Scenario: Unconfigured origin is denied

- **WHEN** a request includes an `Origin` header that is absent from the allowlist
- **THEN** the response does not include `Access-Control-Allow-Origin` for that origin

### Requirement: JSON request bodies are bounded and parse errors are safe

The service SHALL accept JSON request bodies up to 100 KB. An oversized JSON body SHALL receive HTTP 413 with `{ "error": "Payload Too Large" }`, and malformed JSON SHALL receive HTTP 400 with `{ "error": "Invalid JSON" }`. Neither response SHALL expose parser internals or a stack trace.

#### Scenario: Oversized JSON body is rejected

- **WHEN** a client sends a JSON body larger than 100 KB
- **THEN** the service returns HTTP 413 with the safe JSON error response

#### Scenario: Malformed JSON body is rejected

- **WHEN** a client sends invalid JSON with `Content-Type: application/json`
- **THEN** the service returns HTTP 400 with the safe JSON error response

### Requirement: Operational events are emitted as structured logs

The service SHALL emit machine-readable JSON logs for startup, graceful shutdown, completed requests, and unhandled request errors. Request logs SHALL include the HTTP method, request URL, status code, response time, and a request ID. Sensitive request headers, including authorization and cookie headers, and response `Set-Cookie` headers SHALL be redacted from logs. Unhandled errors SHALL be logged with server-side diagnostic details while the client receives only a generic safe error response.

#### Scenario: Completed request is traceable

- **WHEN** the service completes an HTTP request
- **THEN** it emits a JSON log record containing the request method, URL, status code, response time, and request ID

#### Scenario: Internal failure does not leak diagnostics

- **WHEN** an unexpected route error occurs
- **THEN** the service logs the error details with its request ID and returns `{ "error": "Internal Server Error" }` without the private error message or stack trace in the response

### Requirement: Business API routes use a versioned namespace

Future business endpoints SHALL be registered below `/api/v1`. `/health` SHALL remain a top-level liveness endpoint and SHALL not be moved under the versioned business API namespace.

#### Scenario: Versioned business route is discoverable

- **WHEN** a business route is added to the service
- **THEN** its public path begins with `/api/v1`, while `GET /health` remains available at its existing path

### Requirement: Continuous integration runs the project quality gate

The repository SHALL run dependency installation, `npm run check`, and `npm run build` in CI for pushes and pull requests so formatting, linting, type checking, tests, and compilation are validated before changes are merged.

#### Scenario: Pull request is validated

- **WHEN** a pull request targets the repository
- **THEN** CI installs the lockfile dependencies and runs the complete check and build commands
