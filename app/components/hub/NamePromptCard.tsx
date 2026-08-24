import { useTranslation } from "react-i18next";
import { UserPen } from "lucide-react";
import { useGameState } from "../../store/useGameState";

/**
 * NamePromptCard — invitación a elegir nombre para el ranking.
 *
 *   Los perfiles antiguos se crearon sin nombre (315 de 361 en La Pocha),
 *   así que el ranking de la tele va lleno de "Jefe #7".  Los nuevos ya
 *   reciben uno por defecto, pero a los que ya están hay que pedírselo: nadie
 *   entra a su perfil a cambiar algo que no sabe que existe.
 *
 *   No se puede descartar a propósito: no es un anuncio, es un campo vacío de
 *   su perfil.  Desaparece sola en cuanto elige un nombre.
 */
export function NamePromptCard() {
	const { t } = useTranslation();
	const displayName = useGameState((s) => s.displayName);
	const sessionLoaded = useGameState((s) => s.sessionLoaded);
	const setScreen = useGameState((s) => s.setScreen);

	// Solo cuando la sesión ya respondió: si no, parpadearía en cada recarga
	// mientras `displayName` todavía es null por no haber llegado.
	if (!sessionLoaded || displayName) return null;

	return (
		<button
			type="button"
			onClick={() => setScreen("profile")}
			className="hub-card w-full text-left rounded-3xl bg-amber-950/30 border border-amber-500/40 px-4 py-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform"
		>
			<div
				className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-400/50 flex items-center justify-center shrink-0"
				aria-hidden="true"
			>
				<UserPen className="w-4 h-4 text-amber-300" />
			</div>
			<div className="flex-1 min-w-0">
				<p className="text-sm font-black text-amber-100">
					{t("name.promptTitle", "Ponte un nombre")}
				</p>
				<p className="text-[11px] text-amber-200/70 leading-snug">
					{t(
						"name.promptBody",
						"Ahora sales como «Jefe» en el ranking y en la tele del local.",
					)}
				</p>
			</div>
		</button>
	);
}
