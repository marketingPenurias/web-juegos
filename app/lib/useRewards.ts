import { useCallback, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useRewards — thin client over /api/rewards.
 *
 * The Edge worker does all the heavy lifting (auth, RLS, atomic RPC);
 * this hook is intentionally just a typed fetch wrapper that surfaces
 * loading + error states for the UI.
 */

const ENDPOINT = "/api/rewards";

export type RewardError =
	| "unauthorized"
	| "insufficient_funds"
	| "product_unavailable"
	| "product_wrong_day"
	| "tier_required"
	| "night_limit_reached"
	| "week_limit_reached"
	| "month_limit_reached"
	| "profile_not_found"
	| "reward_unavailable"
	| "missing_tenant"
	| "service_unavailable"
	| "network_error"
	| "rpc_failed";

export type PurchaseSuccess = {
	ok: true;
	action_type: "purchase";
	reward_id: string;
	balance: number;
};

export type RedeemSuccess = {
	ok: true;
	action_type: "redeem";
	reward_id: string;
	expires_at: string;
};

/** Una fila de "Mis Tickets" (reward comprado aún canjeable). */
export type MyReward = {
	id: string;
	status: "available" | "redeeming";
	expires_at: string | null;
	created_at: string;
	product_name: string;
	price_eur: number;
	price_tokens: number;
};

export type RewardResult<T> =
	| (T & { ok: true })
	| { ok: false; error: RewardError; detail?: string };

async function buildHeaders(): Promise<HeadersInit> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	try {
		const token = await getAccessToken();
		if (token) headers.Authorization = `Bearer ${token}`;
	} catch {
		// Supabase not configured — caller will see "unauthorized".
	}
	return headers;
}

async function postRewards<T>(body: unknown): Promise<RewardResult<T>> {
	let res: Response;
	try {
		const headers = await buildHeaders();
		res = await fetch(ENDPOINT, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
	} catch {
		return { ok: false, error: "network_error" };
	}

	let payload: unknown = {};
	try {
		payload = await res.json();
	} catch {
		// non-JSON response — fall through to status code mapping
	}

	if (res.ok && (payload as { ok?: boolean })?.ok !== false) {
		return payload as RewardResult<T>;
	}

	const err = (payload as { error?: string })?.error as RewardError | undefined;
	const detail = (payload as { detail?: string })?.detail;
	if (err) return { ok: false, error: err, detail };

	if (res.status === 401) return { ok: false, error: "unauthorized", detail };
	if (res.status === 503) return { ok: false, error: "service_unavailable", detail };
	return { ok: false, error: "rpc_failed", detail };
}

export function useRewards() {
	const tenant = useTenant();
	const [pending, setPending] = useState(false);
	const [lastError, setLastError] = useState<RewardError | null>(null);

	const purchase = useCallback(
		async (
			product_id: string,
			event_id?: string | null,
		): Promise<RewardResult<PurchaseSuccess>> => {
			setPending(true);
			setLastError(null);
			const result = await postRewards<PurchaseSuccess>({
				action_type: "purchase",
				tenant_slug: tenant.slug,
				product_id,
				event_id: event_id ?? undefined,
			});
			setPending(false);
			if (!result.ok) setLastError(result.error);
			return result;
		},
		[tenant.slug],
	);

	const redeem = useCallback(
		async (reward_id: string): Promise<RewardResult<RedeemSuccess>> => {
			setPending(true);
			setLastError(null);
			const result = await postRewards<RedeemSuccess>({
				action_type: "redeem",
				tenant_slug: tenant.slug,
				reward_id,
			});
			setPending(false);
			if (!result.ok) setLastError(result.error);
			return result;
		},
		[tenant.slug],
	);

	// GET /api/rewards — lista "Mis Tickets" (rewards aún canjeables).
	const list = useCallback(async (): Promise<
		{ ok: true; rows: MyReward[] } | { ok: false; error: RewardError }
	> => {
		try {
			const headers = await buildHeaders();
			const res = await fetch(ENDPOINT, {
				method: "GET",
				cache: "no-store",
				headers: { ...headers, "X-Tenant-Slug": tenant.slug },
			});
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				rows?: MyReward[];
				error?: string;
			};
			if (!res.ok || payload.ok === false) {
				return {
					ok: false,
					error: (payload.error as RewardError) ?? "rpc_failed",
				};
			}
			return { ok: true, rows: payload.rows ?? [] };
		} catch {
			return { ok: false, error: "network_error" };
		}
	}, [tenant.slug]);

	return { purchase, redeem, list, pending, lastError };
}
