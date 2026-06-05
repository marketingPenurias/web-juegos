import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	Legend,
	ResponsiveContainer,
} from "recharts";

type Row = {
	cohort_week: string;
	cohort_size: number;
	retention_pct_week_3: number;
};

export function RetentionChart({ data }: { data: Row[] }) {
	const chartData = data.map((r) => ({
		semana: new Date(r.cohort_week).toLocaleDateString("es", {
			day: "2-digit",
			month: "short",
		}),
		tamaño: Number(r.cohort_size),
		retención: Number(r.retention_pct_week_3),
	}));

	return (
		<ResponsiveContainer width="100%" height={220}>
			<LineChart
				data={chartData}
				margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
			>
				<XAxis
					dataKey="semana"
					tick={{ fontSize: 11, fill: "#6b5fa6" }}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					tick={{ fontSize: 11, fill: "#6b5fa6" }}
					tickLine={false}
					axisLine={false}
					tickFormatter={(v) => `${v}%`}
				/>
				<Tooltip
					contentStyle={{
						background: "#0e0c14",
						border: "1px solid rgba(139, 92, 246, 0.3)",
						borderRadius: 8,
						fontSize: 12,
					}}
					labelStyle={{ color: "#a78bfa" }}
					itemStyle={{ color: "#e9d5ff" }}
					formatter={(v) => [v != null ? `${v}%` : "—"]}
				/>
				<Legend wrapperStyle={{ fontSize: 11, color: "#a78bfa" }} />
				<Line
					type="monotone"
					dataKey="retención"
					name="Retención W3"
					stroke="#8b5cf6"
					strokeWidth={2}
					dot={false}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
