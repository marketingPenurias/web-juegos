import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Ticket as TicketIcon } from "lucide-react";
import { useGameState } from "../store/useGameState";

/**
 * Ticket — pantalla legacy de canje, RETIRADA en el piloto.
 *
 *   Tras el rediseño de la PANTALLA CAMARERO (decisión CTO), el canje
 *   real se hace en `<RedemptionScreen>` montado a nivel app desde
 *   `useGameState.activeRedemption`.  Esta vista quedaba huérfana en
 *   el `BottomNav` y en `useGameState.activeTicket` (mock).
 *
 *   Si llegamos aquí por persistencia vieja (sessionStorage de un
 *   usuario previo al rediseño), redirigimos al hub.  No mostramos UI
 *   antigua para no confundir al camarero en el piloto.
 */

export function Ticket() {
	const { t } = useTranslation();
	const setScreen = useGameState((s) => s.setScreen);
	const clearTicket = useGameState((s) => s.clearTicket);

	useEffect(() => {
		clearTicket();
		const id = window.setTimeout(() => setScreen("hub"), 800);
		return () => window.clearTimeout(id);
	}, [setScreen, clearTicket]);

	return (
		<div className="flex-1 flex flex-col items-center justify-center px-6 text-center bg-black">
			<TicketIcon
				className="w-12 h-12 text-zinc-700 mb-4 animate-pulse"
				aria-hidden="true"
			/>
			<h2 className="text-xl font-black text-white">
				{t("ticket.redirecting", "Redirigiendo…")}
			</h2>
		</div>
	);
}
