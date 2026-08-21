import type { Route } from "./+types/api.catalog";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import {
	pickTenantSlug,
	resolveTenantProfile,
} from "../lib/tenant-resolver.server";

/**
 * GET /api/catalog
 *
 *   Devuelve el catálogo **resuelto para el usuario que pregunta**: qué puede
 *   pedir ahora, a qué precio en tokens y, si no puede, por qué.
 *
 *   Toda esa lógica vive en la RPC `get_promo_catalog` y NO se replica aquí:
 *     · el coste es `descuento € × tasa del nivel`, no una columna;
 *     · la disponibilidad depende de nivel, día, franja horaria, vigencia y
 *       stock, y una campaña activa puede sobrescribir precio y tasa.
 *   Duplicar cualquiera de esas reglas en el cliente garantizaría que un día
 *   dijeran cosas distintas.
 *
 *   Diseño:
 *     - JWT obligatorio: el catálogo es personal (depende del nivel y del
 *       consumo de la noche), no un listado público de precios.
 *     - Sin paginación (≤30 productos por sala).
 *     - Ya viene ordenado por coste ascendente desde la RPC.
 *
 *   Defense in depth: la UI deshabilita lo no disponible, pero
 *   `purchase_reward` revalida contra la MISMA regla en cada compra.
 */

type CatalogProduct = {
	product_id: string;
	name: string;
	type: string;
	redemption_type: "discount" | "free_product";
	list_price_eur: number | null;
	promo_price_eur: number | null;
	discount_eur: number | null;
	/** Coste real para ESTE usuario: descuento × tasa de su nivel. */
	cost_tokens: number;
	/** Lo que costaría en el nivel siguiente; null si ya es el mejor precio. */
	cost_at_next_tier: number | null;
	/** `available` | `not_now` (su nivel lo tiene, pero no ahora) | `locked_tier`. */
	status: "available" | "not_now" | "locked_tier";
	rule_id: string | null;
	campaign_code: string | null;
	kind: "base" | "flash_drop" | "happy_hour" | "campaign";
	label: string | null;
	/** Por qué no puede pedirlo y qué gana subiendo. */
	unlock_hint: string | null;
};

type PromoCatalog = {
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

export async function loader({ request, context }: Route.LoaderArgs) {
	const cors = preflight(request);
	if (cors) return cors;

	if (request.method !== "GET") {
		return jsonResponse(
			{ ok: false, error: "method_not_allowed" },
			{ status: 405, request },
		);
	}

	const verified = await verifyAuthToken(request, context);
	if (!verified) {
		return jsonResponse(
			{ ok: false, error: "unauthorized" },
			{ status: 401, request },
		);
	}

	const slugResult = pickTenantSlug(null, request);
	if (!slugResult.ok) {
		return jsonResponse(
			{ ok: false, error: slugResult.error },
			{ status: 400, request },
		);
	}

	let supabase: ReturnType<typeof getServiceSupabase>;
	try {
		supabase = getServiceSupabase(context);
	} catch (err) {
		if (err instanceof Response) return err;
		return jsonResponse(
			{ ok: false, error: "service_unavailable" },
			{ status: 503, request },
		);
	}

	// El catálogo es personal: hace falta el perfil de ESTE usuario en ESTA
	// sala para saber su nivel y los canjes que lleva en la noche.
	const profileResult = await resolveTenantProfile(
		supabase,
		slugResult.slug,
		verified.id,
	);
	if (!profileResult.ok) {
		return jsonResponse(
			{ ok: false, error: profileResult.error },
			{ status: 404, request },
		);
	}

	const { data, error } = await supabase.rpc("get_promo_catalog", {
		p_tenant_id: profileResult.data.tenant_id,
		p_user_id: profileResult.data.user_profile_id,
	});

	if (error) {
		console.warn("[api.catalog] get_promo_catalog failed", error.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	const catalog = data as unknown as PromoCatalog;
	return jsonResponse({ ok: true, ...catalog }, { request });
}

export function action({ request }: Route.ActionArgs) {
	const cors = preflight(request);
	if (cors) return cors;
	return new Response(
		JSON.stringify({ ok: false, error: "method_not_allowed" }),
		{
			status: 405,
			headers: {
				"Content-Type": "application/json",
				...corsHeaders(request.headers.get("origin")),
			},
		},
	);
}
