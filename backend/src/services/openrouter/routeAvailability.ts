/**
 * Which exact-model routes have shown they can answer (RJ-025 repair).
 *
 * A key on the server only says a provider could be asked. It does not say
 * the account behind it has credit, that the model is enabled for it, or that
 * the provider still serves that model. So a route is counted as usable only
 * after it has answered: a startup probe, the run readiness check, the admin
 * health check, or a real call. A route that refused for a reason about the
 * account or the provider (no credit, a rejected key, a route set up wrongly,
 * the model not served there, a rate limit, an outage) is counted as not
 * usable until its cool-down ends.
 *
 * The record is kept in memory, per server process. It holds no key and no
 * prompt: only the provider, the model id, what happened and when.
 *
 * A route is always named by its provider AND the id the model has there.
 * Every route of one role is the same model (see `providerRoutes.ts`), so this
 * file never decides which model a role uses.
 */
import type { ModelProviderName } from './providerRoutes';

/** What is known about one route. */
export type RouteState = 'usable' | 'not_usable' | 'unknown';

/**
 * Why a route was last refused, in the words of `ModelErrorClassification`,
 * plus `endpoint_not_found` for a provider that does not serve the model.
 * Kept as a string here so this file does not import the service.
 */
export type RouteRefusalReason = string;

export interface RouteAvailabilityRecord {
  provider: ModelProviderName;
  model: string;
  state: Exclude<RouteState, 'unknown'>;
  /** When the route last answered or was refused, ms since epoch. */
  at: number;
  /** Until when this record holds, ms since epoch. After it, the route reads as `unknown`. */
  until: number;
  /** Set when the route was refused. */
  reason?: RouteRefusalReason;
  /** Where the record came from. */
  source: 'probe' | 'call';
}

/** How long an answer counts as proof the route can answer. */
export const USABLE_FOR_MS = 30 * 60_000;

/**
 * How long a refusal keeps a route out, by reason. A rate limit or an outage
 * usually clears in minutes; no credit, a rejected key, a route set up wrongly
 * or a model the provider does not serve needs someone to change something.
 */
export const NOT_USABLE_FOR_MS: Readonly<Record<string, number>> = {
  rate_limited: 2 * 60_000,
  provider_unavailable: 2 * 60_000,
  network_error: 2 * 60_000,
  quota_exceeded: 15 * 60_000,
  auth_error: 15 * 60_000,
  route_config_error: 15 * 60_000,
  endpoint_not_found: 15 * 60_000,
};

/** Refusals that say something about the route, not about one request. Anything else leaves the record alone. */
export function isRouteRefusal(reason: string | undefined | null): boolean {
  return Boolean(reason && Object.prototype.hasOwnProperty.call(NOT_USABLE_FOR_MS, reason));
}

const records = new Map<string, RouteAvailabilityRecord>();

function keyFor(provider: ModelProviderName, model: string): string {
  return `${provider}\u0000${model.trim()}`;
}

/** Record that a route answered. */
export function recordRouteAnswered(
  provider: ModelProviderName,
  model: string,
  source: RouteAvailabilityRecord['source'],
  now: number = Date.now()
): void {
  records.set(keyFor(provider, model), {
    provider,
    model: model.trim(),
    state: 'usable',
    at: now,
    until: now + USABLE_FOR_MS,
    source,
  });
}

/**
 * Record that a route was refused. A refusal that is not about the route (a
 * malformed request, an unknown error) is not recorded: it says nothing about
 * whether the next request there can be answered.
 */
export function recordRouteRefused(
  provider: ModelProviderName,
  model: string,
  reason: RouteRefusalReason,
  source: RouteAvailabilityRecord['source'],
  now: number = Date.now()
): void {
  if (!isRouteRefusal(reason)) return;
  records.set(keyFor(provider, model), {
    provider,
    model: model.trim(),
    state: 'not_usable',
    at: now,
    until: now + NOT_USABLE_FOR_MS[reason],
    reason,
    source,
  });
}

/** The current record for a route, or `null` when none holds (never seen, or its time has run out). */
export function routeAvailability(
  provider: ModelProviderName,
  model: string,
  now: number = Date.now()
): RouteAvailabilityRecord | null {
  const record = records.get(keyFor(provider, model));
  if (!record) return null;
  if (now >= record.until) return null;
  return record;
}

/** `usable`, `not_usable`, or `unknown` when nothing current is known. */
export function routeState(provider: ModelProviderName, model: string, now: number = Date.now()): RouteState {
  return routeAvailability(provider, model, now)?.state ?? 'unknown';
}

/** Every current record, for the admin health check and the startup log. */
export function allRouteAvailability(now: number = Date.now()): RouteAvailabilityRecord[] {
  return Array.from(records.values()).filter((record) => now < record.until);
}

/** Tests only. */
export function resetRouteAvailabilityForTests(): void {
  records.clear();
}
