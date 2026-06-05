import { Outlet, useLoaderData, useNavigate } from "react-router";
import { Activity, Network, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Route } from "./+types/dashboard";
import { ANALYTICS_COOKIE } from "../lib/analytics-jwt";
import { parseCookies, verifySupabaseJwtLocally } from "../lib/api.server";
import { getBrowserSupabase } from "../lib/supabase.client";
import { NavLink } from "../components/dashboard/nav-link";
import { LogoutButton } from "../components/dashboard/logout-button";

type WorkerEnv = Env & { SUPABASE_JWT_PUBLIC_KEY?: string };

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env as WorkerEnv;
	const jwkKey = env.SUPABASE_JWT_PUBLIC_KEY;
	if (!jwkKey) return { needsAuth: true };

	const token = parseCookies(request)[ANALYTICS_COOKIE];
	if (!token) return { needsAuth: true };

	const payload = await verifySupabaseJwtLocally(token, jwkKey);
	return { needsAuth: !payload?.sub };
}

const navItems = [
	{
		to: "/dashboard/live-vibe",
		label: "Live Vibe",
		description: "Actividad en tiempo real",
		icon: <Activity size={15} />,
	},
	{
		to: "/dashboard/graph",
		label: "Audiencia & Grafo",
		description: "Usuarios alfa y referidos",
		icon: <Network size={15} />,
	},
	{
		to: "/dashboard/retention",
		label: "Retención & LTV",
		description: "Cohortes y token economy",
		icon: <TrendingUp size={15} />,
	},
];

export default function Dashboard() {
	const { needsAuth } = useLoaderData<typeof loader>();
	const navigate = useNavigate();
	const [exchanging, setExchanging] = useState(needsAuth);

	useEffect(() => {
		if (!needsAuth) return;

		let cancelled = false;

		const exchange = async () => {
			const supabase = getBrowserSupabase();
			if (!supabase) {
				navigate("/", { replace: true });
				return;
			}

			const {
				data: { session },
			} = await supabase.auth.getSession();
			if (cancelled) return;

			if (!session?.access_token) {
				navigate("/", { replace: true });
				return;
			}

			const res = await fetch("/api/auth/dashboard", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ access_token: session.access_token }),
			});

			if (cancelled) return;

			if (res.ok) {
				navigate(0);
			} else {
				navigate("/", { replace: true });
			}
		};

		exchange();
		return () => {
			cancelled = true;
		};
	}, [needsAuth, navigate]);

	if (exchanging || needsAuth) {
		return (
			<div className="ng-dashboard-root min-h-screen flex items-center justify-center">
				<div className="text-center">
					<div className="size-7 rounded-md bg-violet-500/20 ring-1 ring-violet-400/30 flex items-center justify-center mx-auto mb-3">
						<span className="text-violet-400 text-xs font-bold font-mono">
							NG
						</span>
					</div>
					<p className="text-sm text-violet-300/60 font-mono">
						Verificando acceso…
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="ng-dashboard-root flex h-screen overflow-hidden">
			<aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
				<div className="px-4 pt-5 pb-4 border-b border-border">
					<div className="flex items-center gap-2.5">
						<div className="size-7 rounded-md bg-primary/20 ring-1 ring-primary/30 flex items-center justify-center shrink-0">
							<span className="text-primary text-xs font-bold font-mono">
								NG
							</span>
						</div>
						<div>
							<p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest leading-none">
								NightGraph
							</p>
							<p className="text-sm font-semibold mt-0.5 text-foreground tracking-tight">
								The Grid
							</p>
						</div>
					</div>
				</div>
				<nav className="flex-1 p-2 space-y-0.5">
					{navItems.map((item) => (
						<NavLink key={item.to} {...item} />
					))}
				</nav>
				<div className="p-3 border-t border-border">
					<LogoutButton />
				</div>
			</aside>
			<main className="flex-1 overflow-auto bg-background">
				<Outlet />
			</main>
		</div>
	);
}
