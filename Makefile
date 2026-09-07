COMPOSE = docker compose -p runsheet -f infra/local/compose.yaml

.PHONY: help setup install up up-core down logs ps migrate dev test lint typecheck check clean

help:
	@echo "Runsheet"
	@echo ""
	@echo "  make setup      first run: copy .env, install, start infrastructure, migrate"
	@echo "  make up         start infrastructure (database, cache, broker, analytics)"
	@echo "  make up-core    start only the database, cache, and broker"
	@echo "  make down       stop infrastructure, keeping data"
	@echo "  make clean      stop infrastructure and delete its data"
	@echo "  make migrate    apply every service's migrations"
	@echo "  make check      run tests, type check, and linter"
	@echo "  make logs       follow infrastructure logs"
	@echo ""
	@echo "Ports and every other setting live in .env; see .env.example."

setup:
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")
	pnpm install
	$(MAKE) up
	$(MAKE) migrate
	@echo ""
	@echo "Ready. Run 'make check' to verify, or 'make help' for what else is here."

install:
	pnpm install --frozen-lockfile

up:
	$(COMPOSE) up -d --wait

up-core:
	$(COMPOSE) up -d --wait postgres redis redpanda

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

migrate:
	pnpm -r --if-present migrate

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

check: test typecheck lint

clean:
	$(COMPOSE) down -v
