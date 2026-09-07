# Contributing

## Getting set up

```sh
make setup    # .env, dependencies, infrastructure, migrations
make check    # tests, type check, linter
```

Everything configurable lives in `.env`; `.env.example` documents every variable. Never commit a
`.env`. Never hardcode a host, a port, or a URL: if it varies by deployment, it is configuration.

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

## Licence and contributions

The project is licensed under the GNU Affero General Public License v3.0.

Contributions are accepted under the Developer Certificate of Origin, which is in the `DCO` file
at the root. There is no contributor licence agreement to sign and no paperwork to send: you keep
the copyright in what you write, and you certify that you have the right to contribute it.

Sign off each commit in a pull request:

```sh
git commit -s -m "Add the thing"
```

That appends a single line to your commit message:

```
Signed-off-by: Your Name <you@example.com>
```

Use the name you would use on legal correspondence and an address that reaches you. Continuous
integration checks that every commit in a pull request carries one, and will tell you which
commits are missing it. `git rebase --signoff main` fixes a branch you forgot to sign.

Because the project keeps copyright with its contributors rather than pooling it, relicensing
would need every contributor to agree. That is the trade the certificate makes: a lower barrier
to contributing, in exchange for less freedom to change the licence later.
