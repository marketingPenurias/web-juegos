import { useLoaderData } from "react-router";
import { Zap, Users, MapPin, ArrowLeftRight } from "lucide-react";
import type { Route } from "./+types/dashboard.live-vibe";
import { requireAnalytics } from "../lib/analytics-jwt";
import { getServiceSupabase } from "../lib/supabase.server";
import { cn } from "../lib/utils";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { LiveVibeChart } from "../components/dashboard/live-vibe-chart";

type LiveVibeRow = {
	tenant_id: string;
	day: string;
	hour: number;
	minute: number;
	location_name: string | null;
	tokens_spent: number;
	tokens_awarded: number;
	tokens_flow: number;
	events_count: number;
};

export async function loader({ request, context }: Route.LoaderArgs) {
	const tenantId = await requireAnalytics(request, context);
	const supabase = getServiceSupabase(context);

	const { data, error } = await supabase.rpc("ng_get_live_vibe", {
		p_tenant_id: tenantId,
	});
	if (error) console.error("ng_get_live_vibe:", error.message);

	return { rows: (data ?? []) as LiveVibeRow[] };
}

export default function LiveVibePage() {
	const { rows } = useLoaderData<typeof loader>();

	const totalFlow = rows.reduce((s, r) => s + Number(r.tokens_flow), 0);
	const totalEvents = rows.reduce((s, r) => s + Number(r.events_count), 0);
	const tokensPerMinute =
		rows.length > 0 ? (totalFlow / rows.length).toFixed(1) : "—";

	const zoneMap: Record<string, number> = {};
	for (const r of rows) {
		const zone = r.location_name ?? "Sin zona";
		zoneMap[zone] = (zoneMap[zone] ?? 0) + Number(r.tokens_flow);
	}
	const zones = Object.entries(zoneMap)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const maxZone = zones[0]?.[1] ?? 1;

	const kpis = [
		{
			label: "Tokens / minuto",
			value: tokensPerMinute,
			Icon: Zap,
			iconClass: "text-violet-400",
			accentClass: "border-l-violet-500/60",
		},
		{
			label: "Usuarios activos",
			value: totalEvents > 0 ? String(totalEvents) : "—",
			Icon: Users,
			iconClass: "text-emerald-400",
			accentClass: "border-l-emerald-500/60",
		},
		{
			label: "Zona más activa",
			value: zones[0]?.[0] ?? "—",
			Icon: MapPin,
			iconClass: "text-amber-400",
			accentClass: "border-l-amber-500/60",
		},
		{
			label: "Transacciones (1h)",
			value: totalEvents > 0 ? String(totalEvents) : "—",
			Icon: ArrowLeftRight,
			iconClass: "text-cyan-400",
			accentClass: "border-l-cyan-500/60",
		},
	];

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Live Vibe</h1>
					<p className="text-sm text-muted-foreground">
						Actividad de la última hora
					</p>
				</div>
				<Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1.5">
					<span className="inline-block size-1.5 rounded-full bg-emerald-400 animate-pulse" />
					En directo
				</Badge>
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
						</CardContent>
					</Card>
				))}
			</div>

			<div className="grid grid-cols-3 gap-4">
				<Card className="col-span-2">
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Tokens por minuto — última hora
						</CardTitle>
					</CardHeader>
					<CardContent>
						{rows.length === 0 ? (
							<p className="text-sm text-muted-foreground py-16 text-center">
								Sin datos para este período
							</p>
						) : (
							<LiveVibeChart data={rows} />
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Actividad por zona
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{zones.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-4">
								Sin datos
							</p>
						) : (
							zones.map(([zone, flow], i) => (
								<div key={zone}>
									<div className="flex justify-between text-xs mb-1.5">
										<span className="text-muted-foreground">{zone}</span>
										<span className="font-mono text-foreground">{flow} tk</span>
									</div>
									<div className="h-1.5 bg-muted rounded-full overflow-hidden">
										<div
											className="h-full rounded-full"
											style={{
												width: `${(flow / maxZone) * 100}%`,
												background:
													i === 0
														? "linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)"
														: "linear-gradient(90deg, #6d28d9 0%, #7c3aed 100%)",
												opacity: 1 - i * 0.15,
											}}
										/>
									</div>
								</div>
							))
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
