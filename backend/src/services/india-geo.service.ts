import { logger } from '../utils/logger.js';

const COUNTRIES_NOW = 'https://countriesnow.space/api/v0.1';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;

let statesCache: CacheEntry<{ name: string; code: string }[]> | null = null;
const citiesCache = new Map<string, CacheEntry<string[]>>();

async function postJson<T>(path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${COUNTRIES_NOW}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`geo_fetch_failed:${res.status}`);
  const payload = (await res.json()) as { error?: boolean; msg?: string; data: T };
  if (payload.error) throw new Error(payload.msg || 'geo_fetch_failed');
  return payload.data;
}

/** Indian states/UTs via the public CountriesNow API. */
export async function getIndianStates(): Promise<{ name: string; code: string }[]> {
  if (statesCache && statesCache.expiresAt > Date.now()) {
    return statesCache.data;
  }
  try {
    const data = await postJson<{ states: { name: string; state_code: string }[] }>(
      '/countries/states',
      { country: 'India' },
    );
    const states = data.states
      .map((s) => ({ name: s.name, code: s.state_code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    statesCache = { data: states, expiresAt: Date.now() + TTL_MS };
    return states;
  } catch (err) {
    logger.error({
      action: 'india_geo_states_failed',
      error: err instanceof Error ? err.message : 'unknown',
    });
    throw new Error('geo_unavailable');
  }
}

/** Constituency options for a state (cities/districts from CountriesNow). */
export async function getConstituenciesForState(stateName: string): Promise<string[]> {
  const normalized = stateName.trim().toLowerCase();
  const cached = citiesCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const cities = await postJson<string[]>('/countries/state/cities', {
      country: 'India',
      state: stateName.trim(),
    });
    const names = [...new Set(cities.map((c) => c.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    citiesCache.set(normalized, { data: names, expiresAt: Date.now() + TTL_MS });
    return names;
  } catch (err) {
    logger.error({
      action: 'india_geo_constituencies_failed',
      state: stateName,
      error: err instanceof Error ? err.message : 'unknown',
    });
    throw new Error('geo_unavailable');
  }
}
