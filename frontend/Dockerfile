FROM node:22-alpine AS builder

# Vite inlines VITE_* at BUILD time, so these must be present here — a runtime
# environment variable arrives far too late. Docker does not inherit host
# variables, so each one needs an explicit ARG.
#
# VITE_CLERK_PUBLISHABLE_KEY has no default and cannot have one: a build
# without it produces an image whose every sign-in fails. `vite.config.ts`
# fails the build rather than emitting that image.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_BASE_URL
ARG VITE_SOCKET_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
