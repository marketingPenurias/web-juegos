import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useLeaderboard — top de jugadores REAL vía `/api/leaderboard`.
 *
 *   Lee los usuarios con más `token_balance` del tenant (server-truth).
 *   Sustituye al `store.leaderboard` mock.  Se monta sólo cuando se ve
 *   (Hub) y refresca con `reload()`.
 */

export type LeaderboardRow = {
	rank: number;
	name: string;
	tokens: number;
	is_me: boolean;
};

const ENDPOINT = "/api/leaderboard";

export function useLeaderboard(limit = 10) {
	const tenant = useTenant();
	const [rows, setRows] = useState<LeaderboardRow[]>([]);
	const [myRank, setMyRank] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const token = await getAccessToken();
			if (!token) {
				setError("unauthorized");
				setRows([]);
				return;
			}
			const res = await fetch(`${ENDPOINT}?limit=${limit}`, {
				method: "GET",
				cache: "no-store",
				headers: {
					Authorization: `Bearer ${token}`,
					"X-Tenant-Slug": tenant.slug,
				},
			});
			const payload = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				rows?: LeaderboardRow[];
				my_rank?: number | null;
				error?: string;
			};
			if (!res.ok || payload.ok === false) {
				setError(payload.error ?? `http_${res.status}`);
				setRows([]);
				return;
			}
			setRows(payload.rows ?? []);
			setMyRank(payload.my_rank ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "network_error");
			setRows([]);
		} finally {
			setLoading(false);
		}
	}, [tenant.slug, limit]);

	useEffect(() => {
		void reload();
	}, [reload]);

	return { rows, myRank, loading, error, reload };
}
