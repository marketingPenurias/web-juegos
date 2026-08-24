import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Share2, UserPlus } from "lucide-react";
import { useGameState } from "../../store/useGameState";
import { useTenant } from "../../lib/tenant";
import { cn } from "../../lib/utils";

/**
 * InviteCard — traer gente de verdad a la puerta.
 *
 *   El premio se cobra cuando el amigo **hace check-in en el local**, no
 *   cuando se registra, y la tarjeta lo dice tal cual.  No es letra pequeña:
 *   es lo que convierte al que invita en alguien interesado en que su amigo
 *   APAREZCA, en vez de en repartir enlaces a cambio de nada.
 *
 *   Las cantidades salen de `rewardRules` (la economía de la sala), así que si
 *   el local sube el premio, el texto sube con él.
 */

export function InviteCard() {
	const { t } = useTranslation();
	const tenant = useTenant();
	const inviteCode = useGameState((s) => s.inviteCode);
	const rewardRules = useGameState((s) => s.rewardRules);
	const [copied, setCopied] = useState(false);

	// Sin código todavía (la sesión aún no respondió) no se enseña un enlace a
	// medias que alguien pueda copiar roto.
	if (!inviteCode) return null;

	const amount =
		rewardRules.find((r) => r.event_code === "friend_referral")?.amount ?? 0;
	const friendAmount =
		rewardRules.find((r) => r.event_code === "friend_referral_invitee")
			?.amount ?? 0;

	const url = `https://${tenant.slug}.nightgraph.io/?ref=${inviteCode}`;
	const message = t("invite.shareText", {
		venue: tenant.name,
		n: friendAmount,
		defaultValue:
			"Te invito a {{venue}} · llévate {{n}} tokens de regalo al entrar",
	});

	const share = async () => {
		// En móvil abre el compartir del sistema (WhatsApp, que es donde esto
		// ocurre de verdad).  En escritorio no existe: se copia y ya.
		if (typeof navigator !== "undefined" && navigator.share) {
			try {
				await navigator.share({ title: tenant.name, text: message, url });
				return;
			} catch {
				/* cancelado por el usuario: no es un error */
			}
		}
		await copy();
	};

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`${message} ${url}`);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* sin portapapeles: el código sigue a la vista para dictarlo */
		}
	};

	return (
		<section className="hub-card rounded-3xl bg-linear-to-br from-fuchsia-950/40 to-zinc-950 border border-fuchsia-500/40 px-4 py-4 flex flex-col gap-3">
			<div className="flex items-center gap-2.5">
				<div
					className="w-9 h-9 rounded-full bg-fuchsia-500/15 border border-fuchsia-400/50 flex items-center justify-center shrink-0"
					aria-hidden="true"
				>
					<UserPlus className="w-4 h-4 text-fuchsia-300" />
				</div>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-black text-white">
						{t("invite.title", "Trae a un amigo")}
					</p>
					<p className="text-[11px] text-zinc-400 leading-snug">
						{/* Lo importante es CUÁNDO se cobra. Decirlo aquí evita que
						    alguien se sienta estafado a mitad de noche. */}
						{t("invite.body", {
							n: amount,
							m: friendAmount,
							defaultValue:
								"Te llevas {{n}} tokens cuando entre y haga check-in. Él empieza con {{m}}.",
						})}
					</p>
				</div>
			</div>

			<div className="flex items-center gap-2">
				<div className="flex-1 min-w-0 h-11 rounded-xl bg-black/50 border border-zinc-700 px-3 flex items-center">
					<span className="text-lg font-black tracking-[0.2em] text-fuchsia-300 tabular-nums truncate">
						{inviteCode}
					</span>
				</div>
				<button
					type="button"
					onClick={() => void copy()}
					aria-label={t("invite.copy", "Copiar enlace")}
					className={cn(
						"h-11 w-11 rounded-xl border inline-flex items-center justify-center active:scale-95 shrink-0",
						copied
							? "bg-lime-400 border-lime-300 text-black"
							: "bg-zinc-800 border-zinc-700 text-zinc-300",
					)}
				>
					{copied ? (
						<Check className="w-4 h-4" aria-hidden="true" />
					) : (
						<Copy className="w-4 h-4" aria-hidden="true" />
					)}
				</button>
				<button
					type="button"
					onClick={() => void share()}
					className="h-11 px-4 rounded-xl bg-fuchsia-500 text-black font-black text-[12px] uppercase tracking-widest active:scale-95 inline-flex items-center gap-1.5 shrink-0"
				>
					<Share2 className="w-4 h-4" aria-hidden="true" />
					{t("invite.share", "Enviar")}
				</button>
			</div>
		</section>
	);
}
