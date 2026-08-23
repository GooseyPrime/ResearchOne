FROM node:22-alpine AS builder

# Vite inlines VITE_* at BUILD time, so these must be present here — a runtime
# environment variable arrives far too late. Docker does not inherit host
# variables, so each one needs an explicit ARG.
#
# VITE_CLERK_PUBLISHABLE_KEY has no default and cannot have one: a build
# without it produces an image whose every sign-in fails, and `vite.config.ts`
# fails the build rather than emitting that image.
#
# ARG only, deliberately no ENV. A build arg is already exported to RUN in the
# stage that declares it, and an arg that was never passed is simply absent.
# Re-declaring them with ENV set each to an EMPTY string when no build arg was
# supplied, and `loadEnv` gives process.env precedence over `.env` files — so
# the empty value masked a developer's configured `frontend/.env.local` and
# failed a build that would otherwise have worked (Codex, #220).
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_BASE_URL
ARG VITE_SOCKET_URL

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
