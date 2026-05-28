import type { Route } from "./+types/api.history";
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
 * GET /api/history?limit=50&before=<iso>
 *
 *   Devuelve los últimos movimientos del `wallet_ledger` del usuario
 *   autenticado dentro del tenant resuelto.  Diseño:
 *
 *     · JWT obligatorio.
 *     · Tenant strict.
 *     · Sólo SELECT — sin RPC privilegiada (RLS por user_id
 *       garantiza el aislamiento).
 *     · Límite máximo 100 filas / petición para acotar payload.
 *     · `before` ISO opcional para paginación basada en cursor —
 *       el cliente envía el `created_at` de la fila más antigua que
 *       tiene y pide las anteriores.
 *
 *   La forma de respuesta intencionalmente preserva snapshots
 *   (product_name_at_time, price_tokens_at_time) cuando existen,
 *   para que la UI muestre "Copa Nacional 6€ — Plata · 700t" aunque
 *   el producto haya sido renombrado o desactivado posteriormente.
 */

type LedgerRow = {
	id: number;
	amount: number;
	reason: string;
	metadata: Record<string, unknown> | null;
	created_at: string;
	product_name_at_time: string | null;
	price_tokens_at_time: number | null;
	campaign_type: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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
	const { tenant_id, user_profile_id } = profileResult.data;

	const url = new URL(request.url);
	const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
	const limit = Math.min(
		Math.max(Number.isFinite(limitParam) ? Math.trunc(limitParam) : DEFAULT_LIMIT, 1),
		MAX_LIMIT,
	);
	const before = url.searchParams.get("before");

	let query = supabase
		.from("wallet_ledger")
		.select(
			"id, amount, reason, metadata, created_at, " +
				"product_name_at_time, price_tokens_at_time, campaign_type",
		)
		.eq("tenant_id", tenant_id)
		.eq("user_id", user_profile_id)
		.order("created_at", { ascending: false })
		.limit(limit);

	if (before) {
		query = query.lt("created_at", before);
	}

	const { data, error } = await query;
	if (error) {
		console.warn("[api.history] ledger lookup failed", error.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	return jsonResponse(
		{
			ok: true,
			rows: (data ?? []) as unknown as LedgerRow[],
			limit,
		},
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
