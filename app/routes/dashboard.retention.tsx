import { useLoaderData } from "react-router";
import { TrendingUp, Users, Wallet, Flame } from "lucide-react";
import type { Route } from "./+types/dashboard.retention";
import { requireAnalytics } from "../lib/analytics-jwt";
import { getServiceSupabase } from "../lib/supabase.server";
import { cn } from "../lib/utils";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../components/ui/card";
import { RetentionChart } from "../components/dashboard/retention-chart";
import { TokenEconomyChart } from "../components/dashboard/token-economy-chart";

type RetentionRow = {
	cohort_week: string;
	cohort_size: number;
	retained_week_3: number;
	retention_pct_week_3: number;
};

type EconomyRow = {
	tokens_issued: number;
	tokens_burned: number;
	token_delta: number;
	revenue_eur: number;
	estimated_cost_eur: number;
};

export async function loader({ request, context }: Route.LoaderArgs) {
	const tenantId = await requireAnalytics(request, context);
	const supabase = getServiceSupabase(context);

	const [retentionResult, economyResult] = await Promise.all([
		supabase.rpc("ng_get_cohort_retention", { p_tenant_id: tenantId }),
		supabase.rpc("ng_get_token_economy", { p_tenant_id: tenantId }),
	]);

	if (retentionResult.error)
		console.error("ng_get_cohort_retention:", retentionResult.error.message);
	if (economyResult.error)
		console.error("ng_get_token_economy:", economyResult.error.message);

	return {
		retentionRows: (retentionResult.data ?? []) as RetentionRow[],
		economy: ((economyResult.data ?? []) as EconomyRow[])[0] ?? null,
	};
}

export default function RetentionPage() {
	const { retentionRows, economy } = useLoaderData<typeof loader>();

	const lastCohort = retentionRows.at(-1);

	const kpis = [
		{
			label: "Retención semana 3",
			value: lastCohort ? `${lastCohort.retention_pct_week_3}%` : "—",
			sub: "última cohorte",
			Icon: TrendingUp,
			iconClass: "text-violet-400",
			accentClass: "border-l-violet-500/60",
		},
		{
			label: "Tamaño cohorte",
			value: lastCohort ? String(lastCohort.cohort_size) : "—",
			sub: "usuarios",
			Icon: Users,
			iconClass: "text-cyan-400",
			accentClass: "border-l-cyan-500/60",
		},
		{
			label: "Tokens emitidos",
			value: economy
				? `${(Number(economy.tokens_issued) / 1000).toFixed(1)}k`
				: "—",
			sub: "total acumulado",
			Icon: Wallet,
			iconClass: "text-emerald-400",
			accentClass: "border-l-emerald-500/60",
		},
		{
			label: "Tokens quemados",
			value: economy
				? `${(Number(economy.tokens_burned) / 1000).toFixed(1)}k`
				: "—",
			sub: "total acumulado",
			Icon: Flame,
			iconClass: "text-rose-400",
			accentClass: "border-l-rose-500/60",
		},
	];

	return (
		<div className="p-6 space-y-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">
					Retención & LTV
				</h1>
				<p className="text-sm text-muted-foreground">
					Cohortes semanales y economía de tokens
				</p>
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{kpis.map((kpi) => (
					<Card key={kpi.label} className={cn("border-l-2", kpi.accentClass)}>
						<CardHeader className="pb-1">
							<div className="flex items-center gap-1.5">
								<kpi.Icon size={13} className={kpi.iconClass} />
								<CardTitle className="text-xs font-normal text-muted-foreground">
									{kpi.label}
								</CardTitle>
							</div>
						</CardHeader>
						<CardContent>
							<span className="text-2xl font-semibold tabular-nums">
								{kpi.value}
							</span>
							<p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid grid-cols-2 gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Retención por cohorte semanal
						</CardTitle>
					</CardHeader>
					<CardContent>
						{retentionRows.length === 0 ? (
							<p className="text-sm text-muted-foreground py-16 text-center">
								Sin datos de cohortes
							</p>
						) : (
							<RetentionChart data={retentionRows} />
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Token economy — emisión vs quema
						</CardTitle>
					</CardHeader>
					<CardContent>
						{!economy ? (
							<p className="text-sm text-muted-foreground py-16 text-center">
								Sin datos de tokens
							</p>
						) : (
							<TokenEconomyChart data={economy} />
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
