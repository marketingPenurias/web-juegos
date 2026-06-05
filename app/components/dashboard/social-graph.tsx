import { lazy, Suspense, useMemo, useEffect, useState } from "react";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

type GraphRow = {
	user_id: string;
	user_name: string;
	referral_count: number;
	user_tier: string;
};

const tierColor: Record<string, string> = {
	alpha: "#f59e0b",
	influencer: "#8b5cf6",
	standard: "#3d2060",
};

const EMPTY_NODES = [{ id: "empty", name: "Sin datos", tier: "standard", val: 1 }];

export function SocialGraph({ rows }: { rows: GraphRow[] }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const graphData = useMemo(() => {
		if (rows.length === 0) return { nodes: EMPTY_NODES, links: [] };

		const nodes = rows.map((r) => ({
			id: r.user_id,
			name: r.user_name ?? r.user_id,
			tier: r.user_tier,
			val: Math.max(1, r.referral_count),
		}));

		const alphaIds = new Set(
			rows.filter((r) => r.user_tier !== "standard").map((r) => r.user_id),
		);
		const standards = rows.filter((r) => r.user_tier === "standard");
		const links = standards.flatMap((r) => {
			const nearest = [...alphaIds][0];
			return nearest ? [{ source: nearest, target: r.user_id }] : [];
		});

		return { nodes, links };
	}, [rows]);

	if (!mounted) {
		return <div className="h-96 bg-muted/20 rounded-lg animate-pulse" />;
	}

	return (
		<Suspense
			fallback={<div className="h-96 bg-muted/20 rounded-lg animate-pulse" />}
		>
			<ForceGraph2D
				graphData={graphData}
				backgroundColor="transparent"
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				nodeColor={(node: any) => tierColor[node.tier ?? "standard"]}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				nodeVal={(node: any) => node.val ?? 1}
				linkColor={() => "rgba(139, 92, 246, 0.3)"}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				nodeLabel={(node: any) => node.name ?? ""}
				width={480}
				height={360}
			/>
		</Suspense>
	);
}
