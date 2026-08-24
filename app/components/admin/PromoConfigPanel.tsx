import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	Clock,
	Plus,
	Settings2,
	Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * PromoConfigPanel — lo que la SALA configura sin que nadie toque código.
 *
 *   Precios en €, tasa de tokens por € de cada nivel, umbrales y las ventanas
 *   de disponibilidad (nivel, días, franja horaria).  Es lo que permite abrir
 *   una segunda discoteca con otra carta y otra escalera sin desplegar nada.
 *
 *   **Regla de oro**: nadie puede quedarse sin promociones a ninguna hora.  Es
 *   trivial romperla tocando un horario, así que el servidor recalcula la
 *   cobertura en cada guardado y el aviso sale aquí arriba — no un sábado a las
 *   dos de la mañana con la sala llena.
 */

type Product = {
	id: string;
	name: string;
	product_type: string;
	list_price_eur: number | null;
	promo_price_eur: number | null;
	redemption_type: "discount" | "free_product";
	price_tokens: number;
	is_active: boolean;
};

type Tier = {
	tier_code: string;
	display_name: string;
	min_lifetime: number;
	tokens_per_euro: number | null;
	max_redemptions_per_night: number | null;
	badge_emoji: string | null;
	sort_order: number;
};

type Availability = {
	id: string;
	product_id: string;
	tier_code: string | null;
	days: number[] | null;
	hour_from: number | null;
	hour_to: number | null;
	promo_price_eur: number | null;
	max_per_night: number | null;
	label: string | null;
	is_active: boolean;
};

type Gap = {
	tier_code: string;
	display_name: string;
	dow: number;
	hour_local: number;
};

type Call = (
	op: string,
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const DAY_NAMES = ["", "L", "M", "X", "J", "V", "S", "D"];
const DAY_LONG = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function hh(h: number | null): string {
	return h === null ? "—" : `${String(h).padStart(2, "0")}:00`;
}

/** Describe una regla en una línea legible por el encargado. */
function describeRule(r: Availability): string {
	const when =
		r.hour_from === null
			? "toda la noche"
			: `de ${hh(r.hour_from)} a ${hh(r.hour_to)}`;
	const days =
		!r.days || r.days.length === 0
			? "todos los días"
			: r.days.map((d) => DAY_NAMES[d]).join(" ");
	return `${days} · ${when}`;
}

export function PromoConfigPanel({
	call,
	onToast,
}: {
	call: Call;
	onToast: (msg: string) => void;
}) {
	const [products, setProducts] = useState<Product[]>([]);
	const [tiers, setTiers] = useState<Tier[]>([]);
	const [availability, setAvailability] = useState<Availability[]>([]);
	const [gaps, setGaps] = useState<Gap[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [openProduct, setOpenProduct] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		const d = await call("promo_config");
		if (d.ok === true) {
			setProducts((d.products as Product[]) ?? []);
			setTiers((d.tiers as Tier[]) ?? []);
			setAvailability((d.availability as Availability[]) ?? []);
			setGaps((d.gaps as Gap[]) ?? []);
			const w = (d.warnings as string[]) ?? [];
			if (w.length > 0) onToast(`⚠️ No se pudo cargar: ${w.join(", ")}`);
		} else {
			onToast("⚠️ No se pudo cargar la configuración");
		}
		setLoading(false);
	}, [call, onToast]);

	useEffect(() => {
		void load();
	}, [load]);

	const run = async (op: string, payload: Record<string, unknown>, okMsg: string) => {
		if (busy) return;
		setBusy(true);
		const r = await call(op, payload);
		setBusy(false);
		if (r.ok === true) {
			onToast(okMsg);
			if (Array.isArray(r.gaps)) setGaps(r.gaps as Gap[]);
			await load();
		} else {
			onToast(`⚠️ ${(r.detail as string) ?? errorText(String(r.error ?? ""))}`);
		}
	};

	const byProduct = useMemo(() => {
		const map = new Map<string, Availability[]>();
		for (const a of availability) {
			const list = map.get(a.product_id) ?? [];
			list.push(a);
			map.set(a.product_id, list);
		}
		return map;
	}, [availability]);

	// El aviso agrupa por nivel: "Bronce no tiene nada el viernes de 00:00 a
	// 06:00" se lee; 24 filas sueltas no.
	const gapSummary = useMemo(() => {
		const byTier = new Map<string, Gap[]>();
		for (const g of gaps) {
			const list = byTier.get(g.display_name) ?? [];
			list.push(g);
			byTier.set(g.display_name, list);
		}
		return [...byTier.entries()].map(([tier, list]) => {
			const days = [...new Set(list.map((g) => g.dow))].sort();
			const hours = list.map((g) => g.hour_local);
			return {
				tier,
				text: `${days.map((d) => DAY_LONG[d]).join(", ")} · de ${hh(Math.min(...hours))} a ${hh(Math.max(...hours) + 1)}`,
			};
		});
	}, [gaps]);

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-5">
			<header className="flex items-center gap-2">
				<Settings2 className="w-4 h-4 text-cyan-400" aria-hidden="true" />
				<h2 className="font-black text-sm uppercase tracking-widest text-zinc-200">
					Configuración de promociones
				</h2>
			</header>

			{/* ── Regla de oro ── */}
			{gapSummary.length > 0 && (
				<div className="rounded-2xl border border-rose-500/60 bg-rose-950/30 p-4 flex gap-3">
					<AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" aria-hidden="true" />
					<div className="flex-1 min-w-0">
						<p className="font-black text-sm text-rose-200">
							Hay clientes sin ninguna promoción
						</p>
						<ul className="mt-1 flex flex-col gap-0.5">
							{gapSummary.map((g) => (
								<li key={g.tier} className="text-[11px] text-rose-300/90">
									<strong>{g.tier}</strong>: {g.text}
								</li>
							))}
						</ul>
						<p className="text-[10px] text-rose-400/70 mt-1.5">
							Deja al menos una promoción barata sin límite de hora para ese
							nivel.
						</p>
					</div>
				</div>
			)}
			{!loading && gapSummary.length === 0 && (
				<p className="inline-flex items-center gap-1.5 text-[11px] text-lime-400/90">
					<Check className="w-3.5 h-3.5" aria-hidden="true" />
					Todos los niveles tienen promociones a cualquier hora.
				</p>
			)}

			{/* ── Niveles ── */}
			<div className="flex flex-col gap-2">
				<h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black">
					Niveles
				</h3>
				<div className="overflow-x-auto">
					<table className="w-full text-[11px] min-w-[420px]">
						<thead>
							<tr className="text-zinc-500 uppercase tracking-widest text-[9px]">
								<th className="text-left font-black py-1">Nivel</th>
								<th className="text-right font-black py-1">Puntos</th>
								<th className="text-right font-black py-1">tk / €</th>
								<th className="text-right font-black py-1">Canjes</th>
								<th className="text-right font-black py-1">Copa</th>
							</tr>
						</thead>
						<tbody>
							{tiers.map((t) => (
								<TierRow
									key={t.tier_code}
									tier={t}
									busy={busy}
									onSave={(patch) =>
										run("update_tier", { tier_code: t.tier_code, ...patch }, "Nivel actualizado")
									}
								/>
							))}
						</tbody>
					</table>
				</div>
				<p className="text-[10px] text-zinc-500">
					«tk / €» es lo que cuesta cada euro de descuento. Menos = mejor
					precio. La última columna muestra el efecto sobre una copa de 3 € de
					descuento.
				</p>
			</div>

			{/* ── Productos y sus ventanas ── */}
			<div className="flex flex-col gap-2">
				<h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black">
					Carta
				</h3>
				{loading && <p className="text-[11px] text-zinc-500">Cargando…</p>}
				{products.map((p) => (
					<ProductRow
						key={p.id}
						product={p}
						rules={byProduct.get(p.id) ?? []}
						tiers={tiers}
						open={openProduct === p.id}
						busy={busy}
						onToggle={() => setOpenProduct(openProduct === p.id ? null : p.id)}
						onSaveProduct={(patch) =>
							run("update_product", { product_id: p.id, ...patch }, "Producto actualizado")
						}
						onSaveRule={(rule) =>
							run("save_availability", { product_id: p.id, ...rule }, "Disponibilidad guardada")
						}
						onDeleteRule={(id) =>
							run("delete_availability", { availability_id: id }, "Regla eliminada")
						}
					/>
				))}
			</div>
		</section>
	);
}

function errorText(code: string): string {
	switch (code) {
		case "promo_not_cheaper":
			return "El precio con la app tiene que ser menor que el de barra";
		case "invalid_price":
			return "Precio no válido";
		case "invalid_rate":
			return "La tasa debe estar entre 1 y 1000 tokens por euro";
		case "invalid_threshold":
			return "Umbral no válido";
		case "invalid_hour":
			return "Las horas van de 0 a 23";
		case "incomplete_window":
			return "Indica las dos horas o ninguna";
		default:
			return "No se pudo guardar";
	}
}

function TierRow({
	tier,
	busy,
	onSave,
}: {
	tier: Tier;
	busy: boolean;
	onSave: (patch: Record<string, unknown>) => void;
}) {
	const [min, setMin] = useState(String(tier.min_lifetime));
	const [rate, setRate] = useState(String(tier.tokens_per_euro ?? ""));
	const [max, setMax] = useState(
		tier.max_redemptions_per_night === null ? "" : String(tier.max_redemptions_per_night),
	);

	const dirty =
		min !== String(tier.min_lifetime) ||
		rate !== String(tier.tokens_per_euro ?? "") ||
		max !== (tier.max_redemptions_per_night === null ? "" : String(tier.max_redemptions_per_night));

	// El efecto sobre la copa: la cifra que de verdad entiende el encargado.
	const copa = rate ? Math.round(3 * Number(rate)) : null;

	return (
		<tr className="border-t border-zinc-800/70">
			<td className="py-1.5 font-bold text-zinc-200">
				{tier.badge_emoji} {tier.display_name}
			</td>
			<td className="py-1.5 text-right">
				<Num value={min} onChange={setMin} disabled={busy} />
			</td>
			<td className="py-1.5 text-right">
				<Num value={rate} onChange={setRate} disabled={busy} />
			</td>
			<td className="py-1.5 text-right">
				<Num value={max} onChange={setMax} disabled={busy} placeholder="∞" />
			</td>
			<td className="py-1.5 text-right tabular-nums text-cyan-300 font-black">
				{copa ?? "—"}
				{dirty && (
					<button
						type="button"
						onClick={() =>
							onSave({
								min_lifetime: Number(min),
								tokens_per_euro: Number(rate),
								max_redemptions_per_night: max.trim() === "" ? null : Number(max),
							})
						}
						disabled={busy}
						className="ml-2 h-7 px-2 rounded-lg bg-cyan-500 text-black text-[10px] font-black uppercase active:scale-95"
					>
						Guardar
					</button>
				)}
			</td>
		</tr>
	);
}

function Num({
	value,
	onChange,
	disabled,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	return (
		<input
			type="number"
			inputMode="numeric"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			disabled={disabled}
			placeholder={placeholder}
			className="w-16 h-8 rounded-lg bg-zinc-950 border border-zinc-700 px-2 text-right text-[11px] text-zinc-100 tabular-nums"
		/>
	);
}

function ProductRow({
	product,
	rules,
	tiers,
	open,
	busy,
	onToggle,
	onSaveProduct,
	onSaveRule,
	onDeleteRule,
}: {
	product: Product;
	rules: Availability[];
	tiers: Tier[];
	open: boolean;
	busy: boolean;
	onToggle: () => void;
	onSaveProduct: (patch: Record<string, unknown>) => void;
	onSaveRule: (rule: Record<string, unknown>) => void;
	onDeleteRule: (id: string) => void;
}) {
	const [list, setList] = useState(String(product.list_price_eur ?? ""));
	const [promo, setPromo] = useState(String(product.promo_price_eur ?? ""));
	const dirty =
		list !== String(product.list_price_eur ?? "") ||
		promo !== String(product.promo_price_eur ?? "");
	const isDiscount = product.redemption_type === "discount";

	return (
		<div className="rounded-2xl border border-zinc-800 bg-zinc-950/50">
			<div className="flex items-center gap-2 p-3">
				<button
					type="button"
					onClick={onToggle}
					className="flex-1 min-w-0 flex items-center gap-2 text-left"
				>
					<ChevronDown
						className={cn(
							"w-4 h-4 text-zinc-500 transition-transform shrink-0",
							open && "rotate-180",
						)}
						aria-hidden="true"
					/>
					<span
						className={cn(
							"font-bold text-sm truncate",
							product.is_active ? "text-zinc-100" : "text-zinc-600 line-through",
						)}
					>
						{product.name}
					</span>
					<span className="text-[10px] text-zinc-500 shrink-0">
						{rules.length} {rules.length === 1 ? "regla" : "reglas"}
					</span>
				</button>

				{isDiscount && (
					<div className="flex items-center gap-1 shrink-0">
						<Num value={list} onChange={setList} disabled={busy} />
						<span className="text-zinc-600 text-[10px]">→</span>
						<Num value={promo} onChange={setPromo} disabled={busy} />
						<span className="text-[10px] text-zinc-500">€</span>
						{dirty && (
							<button
								type="button"
								onClick={() =>
									onSaveProduct({
										list_price_eur: Number(list),
										promo_price_eur: Number(promo),
									})
								}
								disabled={busy}
								className="h-8 px-2 rounded-lg bg-cyan-500 text-black text-[10px] font-black uppercase active:scale-95"
							>
								OK
							</button>
						)}
					</div>
				)}
			</div>

			{open && (
				<div className="border-t border-zinc-800 p-3 flex flex-col gap-2">
					{rules.map((r) => (
						<RuleEditor
							key={r.id}
							rule={r}
							tiers={tiers}
							busy={busy}
							onSave={(patch) => onSaveRule({ availability_id: r.id, ...patch })}
							onDelete={() => onDeleteRule(r.id)}
						/>
					))}
					<RuleEditor
						key="new"
						rule={null}
						tiers={tiers}
						busy={busy}
						onSave={(patch) => onSaveRule(patch)}
					/>
				</div>
			)}
		</div>
	);
}

function RuleEditor({
	rule,
	tiers,
	busy,
	onSave,
	onDelete,
}: {
	rule: Availability | null;
	tiers: Tier[];
	busy: boolean;
	onSave: (patch: Record<string, unknown>) => void;
	onDelete?: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [tier, setTier] = useState(rule?.tier_code ?? "");
	const [days, setDays] = useState<number[]>(rule?.days ?? []);
	const [from, setFrom] = useState(rule?.hour_from === null || rule === null ? "" : String(rule.hour_from));
	const [to, setTo] = useState(rule?.hour_to === null || rule === null ? "" : String(rule.hour_to));

	if (!rule && !editing) {
		return (
			<button
				type="button"
				onClick={() => setEditing(true)}
				className="h-10 rounded-xl border border-dashed border-zinc-700 text-zinc-500 text-[11px] font-black uppercase tracking-widest inline-flex items-center justify-center gap-1.5 active:scale-95"
			>
				<Plus className="w-3.5 h-3.5" aria-hidden="true" />
				Añadir ventana
			</button>
		);
	}

	if (rule && !editing) {
		return (
			<div className="flex items-center gap-2 px-1">
				<span className="text-[11px] font-black text-zinc-300 w-16 shrink-0">
					{rule.tier_code
						? (tiers.find((t) => t.tier_code === rule.tier_code)?.display_name ?? rule.tier_code)
						: "Todos"}
				</span>
				<span className="flex-1 text-[11px] text-zinc-400 truncate inline-flex items-center gap-1.5">
					<Clock className="w-3 h-3 text-zinc-600" aria-hidden="true" />
					{describeRule(rule)}
					{rule.promo_price_eur !== null && (
						<span className="text-amber-300">· {rule.promo_price_eur}€</span>
					)}
				</span>
				<button
					type="button"
					onClick={() => setEditing(true)}
					disabled={busy}
					className="h-7 px-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-black uppercase active:scale-95"
				>
					Editar
				</button>
				{onDelete && (
					<button
						type="button"
						onClick={onDelete}
						disabled={busy}
						aria-label="Eliminar regla"
						className="h-7 w-7 rounded-lg bg-zinc-800 border border-zinc-700 text-rose-400 inline-flex items-center justify-center active:scale-95"
					>
						<Trash2 className="w-3 h-3" aria-hidden="true" />
					</button>
				)}
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-cyan-800/60 bg-cyan-950/10 p-3 flex flex-col gap-2">
			<div className="flex gap-2">
				<select
					value={tier}
					onChange={(e) => setTier(e.target.value)}
					aria-label="Nivel"
					className="flex-1 h-9 rounded-lg bg-zinc-900 border border-zinc-700 px-2 text-[11px] text-zinc-100"
				>
					<option value="">Todos los niveles</option>
					{tiers.map((t) => (
						<option key={t.tier_code} value={t.tier_code}>
							{t.display_name}
						</option>
					))}
				</select>
				<div className="flex items-center gap-1">
					<Num value={from} onChange={setFrom} disabled={busy} placeholder="—" />
					<span className="text-zinc-600 text-[10px]">a</span>
					<Num value={to} onChange={setTo} disabled={busy} placeholder="—" />
				</div>
			</div>

			<div className="flex gap-1">
				{[1, 2, 3, 4, 5, 6, 7].map((d) => (
					<button
						key={d}
						type="button"
						onClick={() =>
							setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])
						}
						className={cn(
							"flex-1 h-8 rounded-lg text-[10px] font-black transition-colors",
							days.includes(d)
								? "bg-cyan-500 text-black"
								: "bg-zinc-900 border border-zinc-700 text-zinc-500",
						)}
					>
						{DAY_NAMES[d]}
					</button>
				))}
			</div>
			<p className="text-[10px] text-zinc-500">
				Sin días marcados = todos. Sin horas = toda la noche. Si la hora de fin
				es menor que la de inicio, la ventana cruza medianoche (22 → 02 es
				«hasta las dos»).
			</p>

			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => {
						onSave({
							tier_code: tier || null,
							days,
							hour_from: from.trim() === "" ? null : Number(from),
							hour_to: to.trim() === "" ? null : Number(to),
						});
						setEditing(false);
					}}
					disabled={busy}
					className="flex-1 h-9 rounded-lg bg-cyan-500 text-black text-[11px] font-black uppercase tracking-widest active:scale-95"
				>
					Guardar
				</button>
				<button
					type="button"
					onClick={() => setEditing(false)}
					className="h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] font-black uppercase active:scale-95"
				>
					Cancelar
				</button>
			</div>
		</div>
	);
}
