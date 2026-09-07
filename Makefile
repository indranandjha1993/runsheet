COMPOSE = docker compose -p runsheet -f infra/local/compose.yaml

.PHONY: install test lint typecheck up down logs ps clean

install:
	pnpm install --frozen-lockfile

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

up:
	$(COMPOSE) up -d --wait

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

clean: down
	$(COMPOSE) down -v

.PHONY: up-core
up-core:
	$(COMPOSE) up -d --wait postgres redis redpanda
