import type { Route } from "./+types/api.leaderboard";
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
 * GET /api/leaderboard?limit=10
 *
 *   Top de jugadores por `token_balance` (saldo actual) dentro del
 *   tenant resuelto.  Diseño:
 *
 *     · JWT obligatorio · tenant strict.
 *     · Lectura con service-role (igual que /api/history); el aislamiento
 *       por tenant lo impone el `WHERE tenant_id` explícito.
 *     · PRIVACIDAD: nunca devolvemos email.  Mostramos `display_name`
 *       cuando existe; si no, un alias anónimo "Jefe #N".  El email es PII
 *       y no debe filtrarse a otros usuarios.
 *     · Marca `is_me` en la fila del usuario autenticado y devuelve su
 *       rango global aunque no esté en el top visible.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type ProfileRow = {
	id: string;
	display_name: string | null;
	token_balance: number;
	lifetime_earned: number;
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

	const { data, error } = await supabase
		.from("user_profiles")
		.select("id, display_name, token_balance, lifetime_earned")
		.eq("tenant_id", tenant_id)
		.order("token_balance", { ascending: false })
		.order("lifetime_earned", { ascending: false })
		.limit(limit);

	if (error) {
		console.warn("[api.leaderboard] lookup failed", error.message);
		return jsonResponse(
			{ ok: false, error: "lookup_failed" },
			{ status: 500, request },
		);
	}

	const top = (data ?? []) as ProfileRow[];

	const rows = top.map((p, i) => ({
		rank: i + 1,
		// Privacidad: display_name si lo hay; nunca el email.
		name: p.display_name?.trim() || `Jefe #${i + 1}`,
		tokens: Number(p.token_balance ?? 0),
		is_me: p.id === user_profile_id,
	}));

	// Rango global del usuario aunque no entre en el top visible.
	let myRank: number | null = rows.find((r) => r.is_me)?.rank ?? null;
	if (myRank === null) {
		const { data: me } = await supabase
			.from("user_profiles")
			.select("token_balance")
			.eq("id", user_profile_id)
			.maybeSingle();
		const myBalance = Number(me?.token_balance ?? 0);
		const { count } = await supabase
			.from("user_profiles")
			.select("id", { count: "exact", head: true })
			.eq("tenant_id", tenant_id)
			.gt("token_balance", myBalance);
		myRank = (count ?? 0) + 1;
	}

	return jsonResponse(
		{ ok: true, rows, my_rank: myRank, limit },
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
