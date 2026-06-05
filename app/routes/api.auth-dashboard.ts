import { createClient } from "@supabase/supabase-js";
import { data } from "react-router";
import type { Route } from "./+types/api.auth-dashboard";
import { ANALYTICS_COOKIE } from "../lib/analytics-jwt";
import { serializeCookie } from "../lib/api.server";

type DashboardEnv = Env & {
	SUPABASE_URL?: string;
	SUPABASE_PUBLISHABLE_KEY?: string;
	SUPABASE_SECRET_KEY?: string;
};

// POST /api/auth/dashboard — verifica que el usuario es tenant_staff y
// guarda el Supabase access_token como cookie HttpOnly.
// DELETE /api/auth/dashboard — borra la cookie (logout).
export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env as DashboardEnv;

	if (request.method === "DELETE") {
		return new Response(null, {
			headers: {
				"Set-Cookie": serializeCookie(ANALYTICS_COOKIE, "", { maxAge: 0 }),
			},
		});
	}

	if (request.method !== "POST") {
		return new Response(null, { status: 405 });
	}

	const { access_token } = await request.json<{ access_token: string }>();
	if (!access_token) {
		return data({ error: "Token requerido" }, { status: 400 });
	}

	const supabaseUrl = env.SUPABASE_URL;
	const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
	const secretKey = env.SUPABASE_SECRET_KEY;

	if (!supabaseUrl || !publishableKey || !secretKey) {
		return data({ error: "Servidor no configurado" }, { status: 503 });
	}

	// Verificar el token contra Supabase Auth (solo en el exchange — no en cada request)
	const supabaseAnon = createClient(supabaseUrl, publishableKey, {
		auth: { persistSession: false },
	});
	const {
		data: { user },
		error: userError,
	} = await supabaseAnon.auth.getUser(access_token);

	if (userError || !user) {
		return data({ error: "Token inválido" }, { status: 401 });
	}

	// Verificar que el usuario es tenant_staff activo
	const supabaseAdmin = createClient(supabaseUrl, secretKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const { data: staff, error: staffError } = await supabaseAdmin
		.from("tenant_staff")
		.select("tenant_id")
		.eq("user_id", user.id)
		.eq("is_active", true)
		.limit(1)
		.single();

	if (staffError || !staff) {
		return data({ error: "Usuario no autorizado como staff" }, { status: 403 });
	}

	// Guardamos el Supabase access_token en la cookie — mismo JWT que ya
	// usa el resto de la app, verificado en loaders con SUPABASE_JWT_PUBLIC_KEY.
	const isSecure = new URL(request.url).protocol === "https:";
	return data(
		{ ok: true },
		{
			headers: {
				"Set-Cookie": serializeCookie(ANALYTICS_COOKIE, access_token, {
					httpOnly: true,
					sameSite: "Lax",
					maxAge: 3600,
					secure: isSecure,
				}),
			},
		},
	);
}
