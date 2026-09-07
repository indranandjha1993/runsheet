# Contributing

## Branches and history

- `main` is the trunk and always green. Cut a branch per change: `rs-123-short-name`.
- Merge back with a merge commit that names the change. `git log --first-parent main` should
  read as the story of the product.
- Never rewrite `main`. Amend or squash only on an unmerged branch.

## Commits

- Subject: one plain sentence under 72 characters describing what changed.
- No type prefixes, no tags, no emoji, no trailers, no bullet lists. An optional short
  paragraph says why when the why is not obvious.
- One logical change per commit, with the tests that cover it.

## Code

- Test first: write the failing test, make it pass, refactor. A change that touches source
  without touching tests is rejected.
- Each service uses a hexagonal layout: `domain/` (pure), `application/` (use cases and ports),
  `adapters/` (HTTP, broker, repositories), `infra/` (wiring). Dependencies point inward.
- Rich domain model: state transitions are aggregate methods that return events. Value objects
  for anything with rules. Commands and queries are separate. Writes go through the outbox.
- Comments explain why, not what. Names follow the domain vocabulary.
- Strict linting and formatting run before every commit.

## Contracts

API and event schemas in `contracts/` are the source of truth. Code is generated or validated
against them, and a breaking change bumps the version.
