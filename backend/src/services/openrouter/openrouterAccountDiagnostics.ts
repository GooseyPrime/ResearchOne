/**
 * OpenRouter checks that send no model request and cost nothing (RJ-025
 * repair). Used for a run on a caller's own OpenRouter key, where a probe
 * request would be charged to their account.
 *
 *   - `GET /api/v1/key`: whether the key is accepted, and its remaining
 *     spending limit when one is set (`limit_remaining`; `null` means no
 *     limit is set, which says nothing about the account's credit).
 *   - `GET /api/v1/models/<id>/endpoints`: whether OpenRouter lists at least
 *     one host for this exact model id right now.
 *
 * Neither proves a model request will be answered: the account's credit, its
 * provider filters and the host's state can still refuse one. A route that
 * passes both checks is therefore reported as `unverified`, never as usable.
 * The key is sent only to OpenRouter, only in the Authorization header, and
 * never logged.
 */
import axios from 'axios';
import { config } from '../../config';
import { buildOpenRouterAppHeaders } from './openrouterProviderBlock';

const TIMEOUT_MS = 10_000;

export type OpenRouterKeyStatus =
  /** Accepted, and no spending limit is used up. Credit is not known. */
  | 'accepted'
  /** 401 or 403: the key is not accepted. */
  | 'rejected'
  /** The key's spending limit is used up (`limit_remaining <= 0`). */
  | 'no_credit'
  /** The check could not be made (network, outage, unexpected answer). */
  | 'unknown';

export type OpenRouterCatalogStatus = 'listed' | 'not_listed' | 'unknown';

export interface OpenRouterDiagnostics {
  checkKey(apiKey: string): Promise<OpenRouterKeyStatus>;
  modelListed(model: string): Promise<OpenRouterCatalogStatus>;
}

type Getter = (url: string, options: Record<string, unknown>) => Promise<{ status?: number; data?: unknown }>;

function base(): string {
  return config.openrouter.baseUrl.replace(/\/+$/, '');
}

export function openRouterDiagnostics(get: Getter = axios.get as unknown as Getter): OpenRouterDiagnostics {
  return {
    async checkKey(apiKey) {
      try {
        const res = await get(`${base()}/key`, {
          headers: buildOpenRouterAppHeaders(apiKey, { 'X-ResearchOne-Call-Type': 'account-check' }),
          timeout: TIMEOUT_MS,
        });
        const data = (res.data as { data?: { limit_remaining?: unknown } } | undefined)?.data;
        if (!data) return 'unknown';
        const remaining = data.limit_remaining;
        if (typeof remaining === 'number' && remaining <= 0) return 'no_credit';
        return 'accepted';
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) return 'rejected';
        if (status === 402) return 'no_credit';
        return 'unknown';
      }
    },
    async modelListed(model) {
      try {
        const res = await get(`${base()}/models/${model.trim()}/endpoints`, { timeout: TIMEOUT_MS });
        const endpoints = (res.data as { data?: { endpoints?: unknown } } | undefined)?.data?.endpoints;
        if (!Array.isArray(endpoints)) return 'unknown';
        return endpoints.length > 0 ? 'listed' : 'not_listed';
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        return status === 404 ? 'not_listed' : 'unknown';
      }
    },
  };
}
