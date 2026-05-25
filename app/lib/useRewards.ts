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
	if (err) return { ok: false, error: err };

	if (res.status === 401) return { ok: false, error: "unauthorized" };
	if (res.status === 503) return { ok: false, error: "service_unavailable" };
	return { ok: false, error: "rpc_failed" };
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

	return { purchase, redeem, pending, lastError };
}
