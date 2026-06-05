import { redirect } from "react-router";
import type { AppLoadContext } from "react-router";
import { parseCookies, verifySupabaseJwtLocally } from "./api.server";
import { getServiceSupabase } from "./supabase.server";

export const ANALYTICS_COOKIE = "ng_dashboard_token";

type WorkerEnv = { SUPABASE_JWT_PUBLIC_KEY?: string };

// Verifica la cookie de dashboard y devuelve el tenant_id.
// Lanza redirect("/") si falta, es inválida o el usuario no es staff activo.
export async function requireAnalytics(
	request: Request,
	context: AppLoadContext,
): Promise<string> {
	const cookies = parseCookies(request);
	const token = cookies[ANALYTICS_COOKIE];
	if (!token) throw redirect("/");

	const env = context.cloudflare.env as WorkerEnv;
	const jwkKey = env.SUPABASE_JWT_PUBLIC_KEY;
	if (!jwkKey) throw new Response("Servidor no configurado", { status: 503 });

	const payload = await verifySupabaseJwtLocally(token, jwkKey);
	if (!payload?.sub) throw redirect("/");

	const supabase = getServiceSupabase(context);
	const { data: staff } = await supabase
		.from("tenant_staff")
		.select("tenant_id")
		.eq("user_id", payload.sub)
		.eq("is_active", true)
		.limit(1)
		.single();

	if (!staff) throw redirect("/");
	return staff.tenant_id;
}
