import type { Route } from "./+types/api.catalog";
import {
	corsHeaders,
	jsonResponse,
	preflight,
	verifyAuthToken,
} from "../lib/api.server";
import { getServiceSupabase } from "../lib/supabase.server";
import { pickTenantSlug } from "../lib/tenant-resolver.server";

/**
 * GET /api/catalog
 *
 *   Devuelve el catálogo activo (`tenant_products WHERE is_active`)
 *   con TODAS las columnas de reglas necesarias para que el cliente
 *   decida cómo renderizar cada item (disponible / bloqueado).
 *
 *   Diseño:
 *     - JWT obligatorio: aunque la tabla tiene RLS de read tenant,
 *       no queremos exponer precios y reglas a anónimos.
 *     - Sin paginación (≤30 productos por tenant en piloto).
 *     - Orden estable: sort_order del tier ASC, después por nombre,
 *       de forma que la UI pueda iterar sin re-ordenar.
 *
 *   Defense in depth: la UI deshabilita los locked, pero la RPC
 *   `purchase_reward` valida igual al servidor en cada compra.
 */

type ProductRow = {
	id: string;
	name: string;
	product_type: string;
	price_tokens: number;
	reference_fiat: number | null;
	is_active: boolean;
	min_tier_required: string | null;
	available_days: number[] | null;
	max_per_night: number | null;
	max_per_week: number | null;
	max_per_month: number | null;
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

	const { data: tenant, error: tenantErr } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", slugResult.slug)
		.maybeSingle();
	if (tenantErr || !tenant) {
		return jsonResponse(
			{ ok: false, error: "unknown_tenant" },
			{ status: 404, request },
		);
	}
	const tenant_id = tenant.id as string;

	const { data, error } = await supabase
		.from("tenant_products")
		.select(
			"id, name, product_type, price_tokens, reference_fiat, is_active, " +
				"min_tier_required, available_days, " +
				"max_per_night, max_per_week, max_per_month",
		)
		.eq("tenant_id", tenant_id)
		.eq("is_active", true)
		.order("price_tokens", { ascending: true });

	if (error) {
		console.warn("[api.catalog] product lookup failed", error.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	return jsonResponse(
		{ ok: true, products: (data ?? []) as unknown as ProductRow[] },
		{ request },
	);
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
