import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";

/**
 * useCatalog — el menú **ya resuelto para este usuario** vía `/api/catalog`.
 *
 *   El servidor decide qué puede pedir, cuánto le cuesta y por qué no puede
 *   pedir el resto.  Aquí no se calcula ni un precio ni una disponibilidad:
 *   el coste depende del nivel, de la franja horaria y de si hay una campaña
 *   activa, y replicar esas reglas en el cliente solo garantiza que un día
 *   digan cosas distintas que la BD.
 *
 *   No memoiza entre montajes: el catálogo cambia poco y un Flash Drop puede
 *   aparecer en cualquier momento, así que conviene releerlo al abrir el menú.
 */

export type ProductStatus =
	/** Puede pedirlo ahora mismo. */
	| "available"
	/** Su nivel lo tiene, pero no a esta hora o no hoy. */
	| "not_now"
	/** Solo a partir de un nivel superior. */
	| "locked_tier";

export type PromoKind = "base" | "flash_drop" | "happy_hour" | "campaign";

export type CatalogProduct = {
	product_id: string;
	name: string;
	type: string;
	redemption_type: "discount" | "free_product";
	/** Precio de barra sin promoción. */
	list_price_eur: number | null;
	/** Lo que pagará en barra al usar la promoción. */
	promo_price_eur: number | null;
	discount_eur: number | null;
	/** Coste real para este usuario: descuento × tasa de su nivel. */
	cost_tokens: number;
	/** Coste en el nivel siguiente; null si no hay mejora que prometer. */
	cost_at_next_tier: number | null;
	status: ProductStatus;
	rule_id: string | null;
	/** Identifica la campaña, para poder medirla. */
	campaign_code: string | null;
	kind: PromoKind;
	label: string | null;
	/** "Hoy de 22:00 a 00:00", "Desde Plata"… */
	unlock_hint: string | null;
};

export type Catalog = {
	tier: string;
	tokens_per_euro: number;
	balance: number;
	lifetime: number;
	next_tier: string | null;
	next_tier_rate: number | null;
	tokens_to_next_tier: number | null;
	/** Canjes que le quedan esta noche; null = sin límite. */
	redemptions_left: number | null;
	products: CatalogProduct[];
};

const EMPTY: Catalog = {
	tier: "bronce",
	tokens_per_euro: 0,
	balance: 0,
	lifetime: 0,
	next_tier: null,
	next_tier_rate: null,
	tokens_to_next_tier: null,
	redemptions_left: null,
	products: [],
};

const ENDPOINT = "/api/catalog";

export function useCatalog() {
	const tenant = useTenant();
	const [catalog, setCatalog] = useState<Catalog>(EMPTY);
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
				setCatalog(EMPTY);
				return;
			}
			const payload = (await res.json()) as
				| ({ ok: true } & Catalog)
				| { ok: false; error?: string };
			if (payload.ok === false) {
				setError(payload.error ?? "rpc_failed");
				setCatalog(EMPTY);
				return;
			}
			const { ok: _ok, ...rest } = payload;
			setCatalog({ ...EMPTY, ...rest });
		} catch (err) {
			setError(err instanceof Error ? err.message : "network_error");
			setCatalog(EMPTY);
		} finally {
			setLoading(false);
		}
	}, [tenant.slug]);

	useEffect(() => {
		void reload();
	}, [reload]);

	return { catalog, products: catalog.products, loading, error, reload };
}
