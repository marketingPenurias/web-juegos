import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "../../lib/utils";

/**
 * QR de la pantalla.  Se genera en el CLIENTE (SVG vectorial, sin red ni
 * rate-limits) y se pinta con el color del local sobre panel oscuro para que
 * siga siendo escaneable.
 */
export function QrBlock({ url, label, fgColor, compact = false }: {
	url: string; label: string; fgColor: string;
	/** En split view el QR va debajo de la canción actual → versión reducida. */
	compact?: boolean;
}) {
	// El QR lleva a /checkin cuando el local tiene QR de entrada configurado:
	// escanear = registrar visita + fidelidad, no sólo captar.
	const isCheckin = url.includes("/checkin");
	// QR generado 100% en el CLIENTE (qrcode.react) → SVG vectorial, offline,
	// sin llamadas de red ni rate-limits.  Siempre escaneable.
	//
	// Branding (V1.6 Premium): los módulos se pintan con el color primario del
	// local (`fgColor`) y el fondo es TRANSPARENTE para fundirse con el panel.
	// Para mantener la legibilidad/escaneabilidad con colores claros, el panel
	// que lo contiene es oscuro translúcido (alto contraste vs. el fg claro)
	// en vez del antiguo recuadro blanco.
	return (
		<aside
			className={cn(
				"flex flex-col items-center justify-center rounded-3xl border border-(--jumbo-primary)/40 bg-zinc-900/50 backdrop-blur-md text-center",
				compact ? "w-full gap-3 p-5" : "w-full gap-6 p-8",
			)}
		>
			<div className="inline-flex items-center gap-2 text-(--jumbo-primary) font-black uppercase tracking-[0.3em] text-sm">
				<QrCode className="w-5 h-5" aria-hidden="true" />
				{isCheckin ? "Escanea y suma" : "Pide tu canción"}
			</div>
			<div
				className={cn(
					"rounded-2xl bg-black/40 border border-white/10 p-4 flex items-center justify-center",
					compact ? "w-40 h-40" : "w-72 h-72",
				)}
			>
				<QRCodeSVG
					value={url}
					level="M"
					marginSize={0}
					fgColor={fgColor || "#ffffff"}
					bgColor="transparent"
					className="w-full h-full"
					aria-label={`QR para ${url}`}
				/>
			</div>
			<div>
				<p className={cn("font-black italic tracking-tight text-white", compact ? "text-lg" : "text-2xl")}>
					{isCheckin ? "Escanea: puntos y racha" : "Escanea para pedir tu canción"}
				</p>
				{!compact && (
					<p className="text-base text-(--jumbo-primary) font-bold mt-1 break-all">{label}</p>
				)}
			</div>
		</aside>
	);
}

// ── Panel "Canción actual" (mitad derecha del split view · V17) ──────
