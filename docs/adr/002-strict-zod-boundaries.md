# ADR 002: Strict Zod Validation Boundaries

## Context
Our API endpoints accept untrusted data (JSON bodies, query parameters, multipart form fields) from the React frontend. Without strict validation, malformed payloads can cause unhandled exceptions, prototype pollution, NoSQL/SQL manipulation, or business logic bypasses.

## Decision
We enforce a rigid validation layer using the `zod` library. Every route must validate its inputs using a Zod schema via a central `validate(schema)` middleware (or explicitly in the handler for multipart forms) before any domain logic executes. 

## Consequences
- **Positive:** Guarantees 100% structural safety. Controllers only deal with strongly-typed, sanitized inputs.
- **Positive:** Centralized error handling returns consistent 400 Bad Request responses containing clear, i18n-ready error codes (e.g. `invalid_voter_id`) mapped via our custom `ValidationError` class.
- **Negative:** Increased boilerplate (schema definitions for every endpoint). 
- **Mitigation:** Schemas serve as self-documenting code and can eventually be used to generate OpenAPI documentation.

## Status
Accepted
