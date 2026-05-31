# ADR 003: Transactional Database Writes

## Context
Many operations in our backend require modifying multiple tables simultaneously. For example, submitting a voter request involves inserting into `voting_requests`, `request_events`, and `audit_logs`. If the application crashes or a step fails midway, we risk leaving orphaned records or violating data integrity invariants (e.g., an action occurs without a corresponding audit log).

## Decision
All multi-step write operations must be wrapped in a database transaction using our custom `db.withTransaction` utility.

## Consequences
- **Positive:** Atomic operations. If an audit log insert fails, the preceding entity mutation is rolled back automatically. The database remains in a consistent state.
- **Negative:** Increased lock contention if transactions are held open for too long.
- **Mitigation:** We only perform lightweight database logic inside the transaction block. Slow operations (like calling the FastAPI service or encrypting documents) must be executed *before* or *after* the transaction, never during. 

## Status
Accepted
