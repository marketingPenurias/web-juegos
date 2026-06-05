import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
} from "recharts";

type Row = { hour: number; minute: number; tokens_flow: number };

export function LiveVibeChart({ data }: { data: Row[] }) {
	const chartData = data.map((r) => ({
		time: `${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`,
		tokens: Number(r.tokens_flow),
	}));

	return (
		<ResponsiveContainer width="100%" height={220}>
			<AreaChart
				data={chartData}
				margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
			>
				<defs>
					<linearGradient id="tokensGrad" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.35} />
						<stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
					</linearGradient>
				</defs>
				<XAxis
					dataKey="time"
					tick={{ fontSize: 11, fill: "#6b5fa6" }}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					tick={{ fontSize: 11, fill: "#6b5fa6" }}
					tickLine={false}
					axisLine={false}
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
				/>
				<Area
					type="monotone"
					dataKey="tokens"
					stroke="#8b5cf6"
					strokeWidth={2}
					fill="url(#tokensGrad)"
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}
