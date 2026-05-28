import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useHistory — fetch del histórico real (`wallet_ledger`) vía
 * `/api/history`.  Sólo se monta cuando se necesita ver (drawer
 * abierto), evitando un round-trip por sesión cuando el usuario
 * no abre el historial.
 */

export type LedgerEntry = {
	id: number;
	amount: number;
	reason: string;
	metadata: Record<string, unknown> | null;
	created_at: string;
	product_name_at_time: string | null;
	price_tokens_at_time: number | null;
	campaign_type: string | null;
};

const ENDPOINT = "/api/history";

export function useHistory(active: boolean) {
	const tenant = useTenant();
	const [rows, setRows] = useState<LedgerEntry[]>([]);
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
			const res = await fetch(`${ENDPOINT}?limit=50`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"X-Tenant-Slug": tenant.slug,
				},
			});
			if (!res.ok) {
				setError(`http_${res.status}`);
				setRows([]);
				return;
			}
			const payload = (await res.json()) as {
				ok?: boolean;
				rows?: LedgerEntry[];
				error?: string;
			};
			if (payload.ok === false) {
				setError(payload.error ?? "rpc_failed");
				setRows([]);
				return;
			}
			setRows(payload.rows ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "network_error");
			setRows([]);
		} finally {
			setLoading(false);
		}
	}, [tenant.slug]);

	useEffect(() => {
		if (!active) return;
		void reload();
	}, [active, reload]);

	return { rows, loading, error, reload };
}
