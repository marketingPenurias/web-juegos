import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useCatalog — fetch del catálogo real (`tenant_products`) vía
 * `/api/catalog`.  No memoiza entre montajes — para el piloto el
 * número de productos es ≤30 y el catálogo cambia poco; un fetch al
 * abrir el menú es coste despreciable y simplifica invalidación.
 */

export type CatalogProduct = {
	id: string;
	name: string;
	product_type: string;
	price_tokens: number;
	reference_fiat: number | null;
	is_active: boolean;
	min_tier_required: "bronce" | "plata" | "oro" | "platino" | null;
	available_days: number[] | null;
	max_per_night: number | null;
	max_per_week: number | null;
	max_per_month: number | null;
};

const ENDPOINT = "/api/catalog";

export function useCatalog() {
	const tenant = useTenant();
	const [products, setProducts] = useState<CatalogProduct[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const token = await getAccessToken();
			const headers: Record<string, string> = {
				"X-Tenant-Slug": tenant.slug,
			};
			if (token) headers.Authorization = `Bearer ${token}`;
			const res = await fetch(ENDPOINT, { method: "GET", headers });
			if (!res.ok) {
				setError(`http_${res.status}`);
				setProducts([]);
				return;
			}
			const payload = (await res.json()) as {
				ok?: boolean;
				products?: CatalogProduct[];
				error?: string;
			};
			if (payload.ok === false) {
				setError(payload.error ?? "rpc_failed");
				setProducts([]);
				return;
			}
			setProducts(payload.products ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "network_error");
			setProducts([]);
		} finally {
			setLoading(false);
		}
	}, [tenant.slug]);

	useEffect(() => {
		void reload();
	}, [reload]);

	return { products, loading, error, reload };
}
