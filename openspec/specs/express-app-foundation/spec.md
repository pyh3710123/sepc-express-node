# Backend Service Foundation Specification

## Purpose

Provide a standalone AImanju backend whose HTTP and WebSocket paths follow `docs/node/backend-generation-spec.md`.

## Requirements

### Requirement: Service starts with validated configuration

The project SHALL build under Node.js 22 and start the API with `npm start`. It SHALL reject production configuration without separate access and refresh secrets and SHALL forbid development mock adapters in production.

#### Scenario: Missing production secrets

- **WHEN** the service starts with `NODE_ENV=production` and no token secrets
- **THEN** startup SHALL fail before accepting requests

### Requirement: Service exposes health checks

The API SHALL return `{ "status": "ok" }` from `GET /health`; `GET /ready` SHALL verify PostgreSQL and Redis dependencies.

#### Scenario: Healthy API

- **WHEN** the client requests `/health`
- **THEN** the service SHALL return HTTP 200 and JSON `status=ok`

### Requirement: Business APIs use the client protocol

Business HTTP paths SHALL be under `/api`, use snake_case boundary fields, and return `{code,message,data}` on success and error. Authentication SHALL use Bearer access tokens, except `/api/auth/refresh`, which uses the refresh token.

#### Scenario: Unauthorized business request

- **WHEN** a client requests a protected `/api` route without an access token
- **THEN** the service SHALL return HTTP 401 and `code=401`

### Requirement: Graph writes are atomic

`POST /api/node/batch` SHALL verify account ownership and `expected_version`, validate all node and connection operations, and commit the graph, version increment, event, and outbox in one PostgreSQL transaction. A conflicting version SHALL return 409 with `data.current_version` and make no graph changes.

#### Scenario: Stale graph version

- **WHEN** a client submits a stale `expected_version`
- **THEN** the service SHALL reject the complete batch with the current version

### Requirement: Accepted generation is durable and idempotent

For a stable `request_id`, generation creation SHALL persist one intention and stable task IDs per account and endpoint. Deduction, tasks, and outbox SHALL commit atomically. A repeated ID with different semantics SHALL return 409; provider absence in production SHALL return an explicit service error.

#### Scenario: Lost response and retry

- **WHEN** a client repeats the same accepted request ID and payload
- **THEN** the service SHALL return the original task ID without a second deduction
