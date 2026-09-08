# One image for every service and the web app. The command chooses which one runs, so a
# deployment is one build and thirteen containers that differ only in their command.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY contracts ./contracts
COPY api ./api
COPY spec ./spec
COPY services ./services
COPY apps ./apps
COPY tsconfig.base.json tsconfig.json tsconfig.eslint.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
# There is no terminal in an image build; pnpm asks before it prunes unless told it is in CI.
ENV NODE_ENV=production CI=true
RUN corepack enable
# The whole built workspace, links intact. Pruning to production dependencies is not done: in a
# workspace it rebuilds the module directory from the root alone and every service loses its own.
COPY --from=build /app ./
# Every service applies its own migrations at start and needs the SQL files beside its build.
EXPOSE 14000 14100
CMD ["node", "services/gateway/dist/main.js"]
