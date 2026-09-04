import { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, Timer, Package, Ban, TrendingDown } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * FlashDropPanel — la palanca del DJ para animar una sala fría.
 *
 *   Un Flash Drop es una promoción agresiva con caducidad y stock: "copa a 4 €
 *   durante 30 minutos, 20 unidades".  Por dentro no es una feature aparte,
 *   solo una regla de disponibilidad con vigencia corta — pero lleva su propio
 *   `campaign_code` (FD-20260821-01) para poder medir CADA activación por
 *   separado y decidir si repetirla.
 *
 *   El drop también baja la TASA, no solo el precio.  Si mantuviera la del
 *   nivel, más descuento saldría por más tokens con el mismo valor por token:
 *   una oferta que no es oferta.  Bajándola equivale a "durante media hora
 *   todos pagáis como un Platino".
 */

type Product = {
	id: string;
	name: string;
	list_price_eur: number | null;
	promo_price_eur: number | null;
};

/**
 * Lo que un cliente del nivel de entrada paga AHORA MISMO por cada producto.
 *
 *   Lo calcula el servidor con el mismo criterio que el catálogo del móvil.
 *   Sin este dato el DJ lanza a ciegas: el 3 de septiembre puso una Copa a
 *   8 € cuando la carta ya la tenía a 7, y el drop quedó por detrás.
 */
type CurrentPrice = {
	product_id: string;
	kind: string;
	label: string | null;
	promo_price_eur: number | null;
	cost_tokens: number | null;
};

type Campaign = {
	id: string;
	campaign_code: string | null;
	label: string | null;
	promo_price_eur: number | null;
	tokens_per_euro: number | null;
	valid_from: string | null;
	valid_to: string | null;
	stock_total: number | null;
	stock_used: number;
	is_active: boolean;
	product: { name: string } | { name: string }[] | null;
};

type Call = (
	op: string,
	payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const DURATIONS = [15, 30, 45, 60];

function productName(c: Campaign): string {
	const p = Array.isArray(c.product) ? c.product[0] : c.product;
	return p?.name ?? "—";
}

/** Milisegundos que le quedan a un drop; ≤0 = terminado. */
function msLeft(validTo: string | null, now = Date.now()): number {
	if (!validTo) return 0;
	return new Date(validTo).getTime() - now;
}

/**
 * Minutos para pintar.  Se redondea hacia ABAJO —un drop de 30 minutos recién
 * lanzado pone "30 min", no "31"— pero nunca por debajo de 1 mientras siga
 * vivo, para que el último minuto no aparezca como "0 min".
 */
function minutesLabel(ms: number): number {
	return ms <= 0 ? 0 : Math.max(1, Math.floor(ms / 60000));
}

export function FlashDropPanel({
	call,
	onToast,
}: {
	call: Call;
	onToast: (msg: string) => void;
}) {
	const [products, setProducts] = useState<Product[]>([]);
	const [current, setCurrent] = useState<CurrentPrice[]>([]);
	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	const [productId, setProductId] = useState("");
	const [price, setPrice] = useState("");
	const [minutes, setMinutes] = useState(30);
	const [stock, setStock] = useState("");

	// Reloj de un minuto: los drops caducan solos y la cuenta atrás tiene que
	// bajar sin recargar, que es justo cuando el DJ está mirando el panel.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(id);
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		const data = await call("promo_panel");
		if (data.ok === true) {
			setProducts((data.products as Product[]) ?? []);
			setCurrent((data.current as CurrentPrice[]) ?? []);
			setCampaigns((data.campaigns as Campaign[]) ?? []);
			const warnings = (data.warnings as string[]) ?? [];
			if (warnings.length > 0) {
				onToast(`⚠️ No se pudo cargar: ${warnings.join(", ")}`);
			}
		} else {
			onToast("⚠️ No se pudieron cargar las promociones");
		}
		setLoading(false);
	}, [call, onToast]);

	useEffect(() => {
		void load();
	}, [load]);

	const selected = products.find((p) => p.id === productId) ?? null;

	// Vista previa de lo que va a costar, para que el DJ vea el efecto ANTES de
	// lanzarlo.  La tasa la fija el servidor (la más baja de la casa), aquí se
	// estima solo para enseñarla.
	// Lo que cuesta HOY ese producto, para poder comparar.
	const vigente = current.find((c) => c.product_id === productId) ?? null;

	const preview = useMemo(() => {
		if (!selected?.list_price_eur) return null;
		const p = Number(price);
		if (!Number.isFinite(p) || p < 0 || p >= Number(selected.list_price_eur)) return null;
		const discount = Number(selected.list_price_eur) - p;
		const cost = Math.round(discount * 75);
		// Un drop que no baja el precio en fichas no lo va a ver nadie: el
		// catálogo enseña siempre la oferta más barata para el cliente, y si
		// la que ya había gana, el drop queda invisible.
		const actual = vigente?.cost_tokens ?? null;
		const mejora = actual === null ? null : actual - cost;
		return { discount, cost, actual, mejora };
	}, [selected, price, vigente]);

	const launch = async () => {
		if (!productId || !preview || busy) return;
		setBusy(true);
		const res = await call("create_flash_drop", {
			product_id: productId,
			promo_price_eur: Number(price),
			minutes,
			stock: stock.trim() ? Number(stock) : undefined,
		});
		setBusy(false);
		if (res.ok === true) {
			onToast(`⚡ ${res.campaign_code} lanzado · ${res.cost_tokens} tokens`);
			setPrice("");
			setStock("");
			setProductId("");
			void load();
		} else {
			onToast(`⚠️ ${(res.detail as string) ?? (res.error as string) ?? "No se pudo lanzar"}`);
		}
	};

	const stop = async (ruleId: string) => {
		if (busy) return;
		setBusy(true);
		const res = await call("end_flash_drop", { rule_id: ruleId });
		setBusy(false);
		onToast(res.ok === true ? "⏹ Drop cortado" : "⚠️ No se pudo cortar");
		void load();
	};

	// La vigencia se decide con los milisegundos exactos, no con los minutos
	// redondeados: si no, un drop con 30 segundos de vida se iría al histórico.
	const live = campaigns.filter((c) => c.is_active && msLeft(c.valid_to, now) > 0);
	const past = campaigns.filter((c) => !c.is_active || msLeft(c.valid_to, now) <= 0);

	return (
		<section className="rounded-3xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col gap-4">
			<header className="flex items-center gap-2">
				<Zap className="w-4 h-4 text-fuchsia-400" aria-hidden="true" />
				<h2 className="font-black text-sm uppercase tracking-widest text-zinc-200">
					Flash Drops
				</h2>
			</header>
			<p className="text-[11px] text-zinc-500 -mt-2">
				Promoción con caducidad y stock. Durante el drop, todo el mundo paga
				como un Platino.
			</p>

			{/* ── Drops en marcha ── */}
			{live.length > 0 && (
				<div className="flex flex-col gap-2">
					{live.map((c) => {
						const left = minutesLabel(msLeft(c.valid_to, now));
						return (
							<div
								key={c.id}
								className="rounded-2xl border border-fuchsia-500/50 bg-fuchsia-950/20 p-3 flex items-center gap-3"
							>
								<div className="flex-1 min-w-0">
									<p className="font-black text-sm text-white truncate">
										{c.label ?? productName(c)}
									</p>
									<div className="flex flex-wrap items-center gap-3 mt-1 text-[11px]">
										{/* El código es lo que permite medirlo después. */}
										<span className="font-mono text-fuchsia-300">
											{c.campaign_code}
										</span>
										<span className="inline-flex items-center gap-1 text-amber-300 tabular-nums">
											<Timer className="w-3 h-3" aria-hidden="true" />
											{left} min
										</span>
										{c.stock_total !== null && (
											<span className="inline-flex items-center gap-1 text-cyan-300 tabular-nums">
												<Package className="w-3 h-3" aria-hidden="true" />
												{c.stock_used}/{c.stock_total}
											</span>
										)}
									</div>
								</div>
								<button
									type="button"
									onClick={() => void stop(c.id)}
									disabled={busy}
									className="h-9 px-3 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] font-black uppercase tracking-widest active:scale-95 disabled:opacity-50 inline-flex items-center gap-1"
								>
									<Ban className="w-3 h-3" aria-hidden="true" />
									Cortar
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* ── Lanzar uno nuevo ── */}
			<div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 flex flex-col gap-3">
				<select
					value={productId}
					onChange={(e) => setProductId(e.target.value)}
					disabled={loading || busy}
					aria-label="Producto"
					className="h-11 rounded-xl bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-100"
				>
					<option value="">
						{loading ? "Cargando…" : "Elige el producto…"}
					</option>
					{products.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name} · barra {Number(p.list_price_eur ?? 0).toFixed(0)}€
						</option>
					))}
				</select>

				<div className="flex gap-2">
					<label className="flex-1 flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-black">
							Precio del drop
						</span>
						<input
							type="number"
							inputMode="numeric"
							min={0}
							step={1}
							value={price}
							onChange={(e) => setPrice(e.target.value)}
							disabled={busy}
							placeholder={selected ? "4" : "—"}
							className="h-11 rounded-xl bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-100 tabular-nums"
						/>
					</label>
					<label className="flex-1 flex flex-col gap-1">
						<span className="text-[10px] uppercase tracking-widest text-zinc-500 font-black">
							Stock (opcional)
						</span>
						<input
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={stock}
							onChange={(e) => setStock(e.target.value)}
							disabled={busy}
							placeholder="sin límite"
							className="h-11 rounded-xl bg-zinc-900 border border-zinc-700 px-3 text-sm text-zinc-100 tabular-nums"
						/>
					</label>
				</div>

				<div className="flex gap-1">
					{DURATIONS.map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => setMinutes(m)}
							disabled={busy}
							className={cn(
								"flex-1 h-10 rounded-xl font-black text-[11px] uppercase tracking-widest transition-colors",
								minutes === m
									? "bg-fuchsia-500 text-black"
									: "bg-zinc-900 border border-zinc-700 text-zinc-400",
							)}
						>
							{m} min
						</button>
					))}
				</div>

				{/* Que vea el efecto antes de regalar dinero. */}
				{/* Con qué compite el drop. Se enseña en cuanto hay producto
				    elegido, ANTES de teclear el precio: es el dato que evita
				    poner una copa a 8 € teniéndola ya a 7. */}
				{selected && vigente?.cost_tokens != null && (
					<p className="text-[11px] text-zinc-400">
						Ahora mismo esa {selected.name.toLowerCase()} les cuesta{" "}
						<strong className="text-zinc-200 tabular-nums">
							{vigente.cost_tokens}
						</strong>{" "}
						tokens
						{vigente.promo_price_eur != null && (
							<> (a {Number(vigente.promo_price_eur).toFixed(0)}€)</>
						)}
						{vigente.label && <> · {vigente.label}</>}.
					</p>
				)}

				{preview && selected && (
					<p className="text-[11px] text-zinc-400 inline-flex items-center gap-1.5">
						<TrendingDown className="w-3 h-3 text-lime-400" aria-hidden="true" />
						Regalas{" "}
						<strong className="text-lime-300">
							{preview.discount.toFixed(0)}€
						</strong>{" "}
						por copa y les cuesta{" "}
						<strong className="text-cyan-300 tabular-nums">
							{preview.cost}
						</strong>{" "}
						tokens.
					</p>
				)}

				{/* El aviso que faltaba. El catálogo enseña siempre la oferta más
				    barata para el cliente, así que un drop que no mejore la que
				    ya hay sencillamente no aparece — y desde el panel parece que
				    no se ha lanzado. */}
				{preview && preview.mejora !== null && preview.mejora <= 0 && (
					<p className="rounded-xl border border-amber-500/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
						<strong>Este drop no se va a ver.</strong> Cuesta{" "}
						<span className="tabular-nums">{preview.cost}</span> tokens y la
						oferta que ya hay puesta cuesta{" "}
						<span className="tabular-nums">{preview.actual}</span>. La app
						siempre enseña la más barata para el cliente, así que seguirá
						viéndose la otra. Baja más el precio para que compense.
					</p>
				)}

				<button
					type="button"
					onClick={() => void launch()}
					disabled={busy || !productId || !preview}
					className="h-12 rounded-2xl bg-linear-to-r from-fuchsia-400 to-purple-500 text-black font-black text-xs uppercase tracking-widest active:scale-95 disabled:opacity-40 inline-flex items-center justify-center gap-2"
				>
					<Zap className="w-4 h-4" aria-hidden="true" />
					{busy ? "Lanzando…" : "Lanzar Flash Drop"}
				</button>
			</div>

			{/* ── Histórico: qué se lanzó y cuánto se movió ── */}
			{past.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<h3 className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 font-black">
						Anteriores
					</h3>
					{past.slice(0, 8).map((c) => (
						<div
							key={c.id}
							className="flex items-center gap-3 text-[11px] text-zinc-500 px-1"
						>
							<span className="font-mono text-zinc-600">{c.campaign_code}</span>
							<span className="flex-1 truncate">{productName(c)}</span>
							<span className="tabular-nums">
								{c.stock_used} canje{c.stock_used === 1 ? "" : "s"}
							</span>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
