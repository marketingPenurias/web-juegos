import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { getSupabase } from "./lib/supabase.server";
import {
	DEFAULT_THEME,
	FALLBACK_TENANT,
	TenantProvider,
	extractSlugFromHost,
	type Tenant,
} from "./lib/tenant";

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
	},
];

/**
 * Root loader — two responsibilities, both pre-render:
 *
 *   1. **Attribution capture.**  If the URL carries a `?ref=CODE` query
 *      param (QR signage, WhatsApp promoter link, Tinder share — every
 *      acquisition source funnels through the same shape), set an
 *      HttpOnly `ng_tracking_ref` cookie that survives the OAuth round-
 *      trip and gets consumed by `/api/auth-sync` after SIGNED_IN.
 *      Then 303 redirect to the cleaned URL so the param doesn't end
 *      up in the user's history, in shared screenshots, or in logs.
 *
 *   2. **Tenant resolution** (existing behavior).  Skipped for
 *      `/api/*` resource routes; localhost / preview deploys default
 *      to slug "lapocha"; missing tenant → 404; Supabase unconfigured
 *      + slug != "lapocha" → 503.
 */

const REF_COOKIE = "ng_tracking_ref";
const REF_COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

function captureRefCookie(request: Request): Response | null {
	const url = new URL(request.url);
	const ref = url.searchParams.get("ref");
	if (!ref) return null;

	const cleaned = ref.trim().toUpperCase().slice(0, 64);
	if (!cleaned) return null;

	url.searchParams.delete("ref");
	const isHttps = url.protocol === "https:";
	const cookie = [
		`${REF_COOKIE}=${encodeURIComponent(cleaned)}`,
		"Path=/",
		`Max-Age=${REF_COOKIE_MAX_AGE}`,
		"SameSite=Lax",
		"HttpOnly",
		isHttps ? "Secure" : "",
	]
		.filter(Boolean)
		.join("; ");

	return new Response(null, {
		status: 303,
		headers: {
			Location: url.pathname + url.search + url.hash,
			"Set-Cookie": cookie,
		},
	});
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);

	// ── 1. Attribution capture ────────────────────────────────────────
	const refRedirect = captureRefCookie(request);
	if (refRedirect) throw refRedirect;

	if (url.pathname.startsWith("/api/")) {
		return { tenant: FALLBACK_TENANT };
	}

	const slug = extractSlugFromHost(url.hostname);
	if (!slug) {
		throw new Response("tenant_not_found", { status: 404 });
	}

	let supabase: ReturnType<typeof getSupabase>;
	try {
		supabase = getSupabase(context);
	} catch {
		// Demo mode (no Supabase keys) — accept "lapocha", reject everything
		// else so multi-tenant isolation stays meaningful.
		if (slug === "lapocha") {
			return { tenant: { ...FALLBACK_TENANT } as Tenant };
		}
		throw new Response("service_unavailable", { status: 503 });
	}

	const { data, error } = await supabase
		.from("tenants")
		.select("id, slug, name, theme, status, bg_video_url")
		.eq("slug", slug)
		.maybeSingle();

	if (error) {
		console.warn("[root.loader] tenant lookup failed", error.message);
		if (slug === "lapocha") {
			return { tenant: { ...FALLBACK_TENANT } as Tenant };
		}
		throw new Response("tenant_lookup_failed", { status: 500 });
	}

	if (!data) {
		// Same forgiving fallback as the lookup-error branch: when the
		// caller is the demo slug AND no row exists, paint the in-memory
		// FALLBACK_TENANT.  Saves new contributors from a confusing 404
		// before they've run `database/schema.sql` (which seeds the
		// lapocha row).  For any other slug, 404 stays strict — accidental
		// cross-tenant leaks are far worse than a confusing dev message.
		if (slug === "lapocha") {
			console.warn(
				"[root.loader] tenant row 'lapocha' missing — falling back to in-memory demo. " +
					"Run database/schema.sql to seed it.",
			);
			return { tenant: { ...FALLBACK_TENANT } as Tenant };
		}
		throw new Response("tenant_not_found", { status: 404 });
	}

	const tenant: Tenant = {
		id: data.id as string,
		slug: data.slug as string,
		name: data.name as string,
		status: (data.status as string) ?? undefined,
		bgVideoUrl: (data.bg_video_url as string | null) ?? null,
		theme: {
			...DEFAULT_THEME,
			...((data.theme as Record<string, string> | null) ?? {}),
		},
	};

	return { tenant };
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="es" className="bg-black">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
				/>
				<meta name="theme-color" content="#000000" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta
					name="apple-mobile-web-app-status-bar-style"
					content="black-translucent"
				/>
				<meta name="apple-mobile-web-app-title" content="La Pocha" />
				<meta name="format-detection" content="telephone=no" />
				<Meta />
				<Links />
			</head>
			<body className="bg-black text-white antialiased overscroll-none">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	const data = useLoaderData<typeof loader>();
	const tenant = data?.tenant ?? FALLBACK_TENANT;
	return (
		<TenantProvider tenant={tenant}>
			<Outlet />
		</TenantProvider>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "Ocurrió un error inesperado.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? "La página solicitada no existe."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="pt-16 p-4 container mx-auto text-white bg-black min-h-dvh">
			<h1>{message}</h1>
			<p>{details}</p>
			{stack && (
				<pre className="w-full p-4 overflow-x-auto">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
