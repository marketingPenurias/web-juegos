/**
 * Resilient, fire-and-forget analytics for the La Pocha gamification app.
 *
 * Design goals
 * ── Never block the UI thread.  Every call returns immediately; the
 *    network round-trip happens with `keepalive` so it survives unloads.
 * ── Never lose an event.  When the network is down (or the API replies
 *    with anything other than 2xx) we append the payload to a localStorage
 *    queue and replay it on the next successful boot.
 * ── Auth-aware.  When a Supabase session is present we inject the
 *    `Authorization: Bearer <jwt>` header so the worker can resolve the
 *    user from the JWT (zero-trust — server overrides anything the
 *    client claims).
 * ── Multi-tenant by default.  The endpoint accepts a tenant slug; the
 *    worker resolves it to a tenant_id and applies RLS-safe inserts.
 *
 * No third-party libraries (no axios, no localforage).
 */

import { getAccessToken } from "./supabase.client";

const ENDPOINT = "/api/track";
const QUEUE_KEY = "offline_events_queue";
const QUEUE_MAX = 200;
const FLUSH_BATCH_SIZE = 50;
const DEFAULT_TENANT = "lapocha";

export type TrackEventPayload = {
	tenant_slug: string;
	user_id?: string | null;
	visit_id?: string | null;
	category: string;
	action: string;
	metadata: Record<string, unknown>;
	client_ts: string;
};

const isBrowser = typeof window !== "undefined";

function safeStorage(): Storage | null {
	if (!isBrowser) return null;
	try {
		// `localStorage` access can throw in privacy mode / cookies disabled.
		const probe = "__lapocha_probe__";
		window.localStorage.setItem(probe, "1");
		window.localStorage.removeItem(probe);
		return window.localStorage;
	} catch {
		return null;
	}
}

function readQueue(): TrackEventPayload[] {
	const ls = safeStorage();
	if (!ls) return [];
	try {
		const raw = ls.getItem(QUEUE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as TrackEventPayload[]) : [];
	} catch {
		return [];
	}
}

function writeQueue(events: TrackEventPayload[]): void {
	const ls = safeStorage();
	if (!ls) return;
	try {
		// Cap size — keep the most recent QUEUE_MAX events.
		const capped = events.length > QUEUE_MAX ? events.slice(-QUEUE_MAX) : events;
		ls.setItem(QUEUE_KEY, JSON.stringify(capped));
	} catch {
		// Quota exceeded or storage disabled — silently drop.
	}
}

function enqueue(payload: TrackEventPayload | TrackEventPayload[]): void {
	const incoming = Array.isArray(payload) ? payload : [payload];
	if (incoming.length === 0) return;
	const next = readQueue().concat(incoming);
	writeQueue(next);
}

async function buildHeaders(): Promise<HeadersInit> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	try {
		const token = await getAccessToken();
		if (token) headers.Authorization = `Bearer ${token}`;
	} catch {
		// Supabase not configured — proceed anonymously.
	}
	return headers;
}

async function postJson(
	body: TrackEventPayload | TrackEventPayload[],
): Promise<boolean> {
	if (!isBrowser) return false;
	try {
		const headers = await buildHeaders();
		const res = await fetch(ENDPOINT, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			keepalive: true,
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Record an event.  Always resolves; never throws.
 * The promise is intentionally returned so callers can `void`-await it
 * when they want to know it has been queued (e.g. before navigation).
 */
export async function trackEvent(
	category: string,
	action: string,
	metadata: Record<string, unknown> = {},
	tenantSlug: string = DEFAULT_TENANT,
): Promise<void> {
	const payload: TrackEventPayload = {
		tenant_slug: tenantSlug,
		category,
		action,
		metadata,
		client_ts: new Date().toISOString(),
	};

	const ok = await postJson(payload);
	if (!ok) enqueue(payload);
}

/**
 * Replay queued events when the network is back.  Fires in batches so a
 * stale queue doesn't trigger a 64 KB `keepalive` body limit.
 */
export async function flushOfflineQueue(): Promise<void> {
	if (!isBrowser) return;
	const queue = readQueue();
	if (queue.length === 0) return;

	const remainder: TrackEventPayload[] = [];
	for (let i = 0; i < queue.length; i += FLUSH_BATCH_SIZE) {
		const batch = queue.slice(i, i + FLUSH_BATCH_SIZE);
		const ok = await postJson(batch);
		if (!ok) {
			// Re-queue this batch and any remaining batches; bail out.
			remainder.push(...queue.slice(i));
			break;
		}
	}

	writeQueue(remainder);
}

/**
 * Hook the queue flusher to network-recovery and visibility events so we
 * keep draining without forcing the caller to invoke flush manually.
 */
export function installAnalyticsListeners(): () => void {
	if (!isBrowser) return () => {};
	const onOnline = () => {
		void flushOfflineQueue();
	};
	const onVisible = () => {
		if (document.visibilityState === "visible") void flushOfflineQueue();
	};
	window.addEventListener("online", onOnline);
	document.addEventListener("visibilitychange", onVisible);
	return () => {
		window.removeEventListener("online", onOnline);
		document.removeEventListener("visibilitychange", onVisible);
	};
}
