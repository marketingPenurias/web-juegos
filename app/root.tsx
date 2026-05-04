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
 * Root loader — resolves the tenant from the request hostname.  Skipped
 * for `/api/*` paths (those routes are POST-only resource routes; their
 * actions don't need tenant context from the parent).
 *
 *  - localhost / preview deploys default to slug "lapocha".
 *  - Real subdomains hit the `tenants` table; missing tenant → 404.
 *  - When Supabase isn't configured, falls back to the in-memory demo
 *    tenant ONLY for slug "lapocha" so the CEO presentation never
 *    breaks even before the keys are dropped in.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);

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
		.select("id, slug, name, theme, status")
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
		throw new Response("tenant_not_found", { status: 404 });
	}

	const tenant: Tenant = {
		id: data.id as string,
		slug: data.slug as string,
		name: data.name as string,
		status: (data.status as string) ?? undefined,
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
		<main className="pt-16 p-4 container mx-auto text-white bg-black min-h-[100dvh]">
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
