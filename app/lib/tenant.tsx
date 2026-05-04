import { createContext, useContext, type ReactNode } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export type TenantTheme = {
	primary?: string;
	secondary?: string;
	accent?: string;
	background?: string;
};

export type Tenant = {
	id: string;
	slug: string;
	name: string;
	theme: TenantTheme;
	status?: string;
};

export const DEFAULT_THEME: Required<TenantTheme> = {
	primary: "#7DF9FF",
	secondary: "#39FF14",
	accent: "#FFD700",
	background: "#050505",
};

/**
 * In-memory fallback used while the loader hasn't resolved a tenant yet
 * (initial render, SSR splash, /api/* paths) and as the demo tenant
 * shape on `localhost` when Supabase isn't configured.
 */
export const FALLBACK_TENANT: Tenant = {
	id: "00000000-0000-0000-0000-000000000000",
	slug: "lapocha",
	name: "La Pocha",
	theme: { ...DEFAULT_THEME },
	status: "active",
};

// ── Slug extraction (shared by root loader, api.track, api.wallet) ───────

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Pull a tenant slug from a hostname.
 *
 * Strict rules:
 *   - localhost / 127.0.0.1            → "lapocha" (demo)
 *   - bare IPv4                        → "lapocha" (demo)
 *   - *.pages.dev                      → "lapocha" (Cloudflare preview)
 *   - foo.bar.es                       → "foo"
 *   - bar.es (no subdomain)            → "" (caller throws 404)
 */
export function extractSlugFromHost(hostname: string): string {
	const lower = (hostname || "").toLowerCase();
	if (!lower) return "";
	if (LOCAL_HOSTS.has(lower)) return "lapocha";
	if (/^\d+(\.\d+){3}$/.test(lower)) return "lapocha";
	if (lower.endsWith(".pages.dev")) return "lapocha";

	const parts = lower.split(".");
	if (parts.length < 3) return "";
	return parts[0];
}

export function resolveTheme(
	theme: TenantTheme | undefined | null,
): Required<TenantTheme> {
	return { ...DEFAULT_THEME, ...(theme || {}) };
}

// ── React context ────────────────────────────────────────────────────────

const TenantContext = createContext<Tenant>(FALLBACK_TENANT);

export function TenantProvider({
	tenant,
	children,
}: {
	tenant: Tenant;
	children: ReactNode;
}) {
	return (
		<TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
	);
}

export function useTenant(): Tenant {
	return useContext(TenantContext);
}
