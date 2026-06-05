import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	Cell,
} from "recharts";

type Economy = { tokens_issued: number; tokens_burned: number };

const BAR_COLORS = ["#10b981", "#f43f5e"];

export function TokenEconomyChart({ data }: { data: Economy }) {
	const chartData = [
		{ label: "Emitidos", value: Number(data.tokens_issued) },
		{ label: "Quemados", value: Number(data.tokens_burned) },
	];

	return (
		<ResponsiveContainer width="100%" height={220}>
			<BarChart
				data={chartData}
				margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
			>
				<XAxis
					dataKey="label"
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
				<Bar dataKey="value" name="Tokens" radius={[4, 4, 0, 0]}>
					{chartData.map((_, i) => (
						<Cell key={i} fill={BAR_COLORS[i]} />
					))}
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}
