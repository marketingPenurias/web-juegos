import { useEffect, useRef } from "react";
import { getAccessToken, getBrowserSupabase } from "./supabase.client";
import { useTenant } from "./tenant";
import { useGameState } from "../store/useGameState";

/**
 * usePendingCheckin — "FLUJO FRÍO" del QR.
 *
 *   Cuando un usuario NUEVO escanea un QR físico y aterriza en
 *   `/checkin?code=...` SIN sesión, esa página guarda el código en
 *   `localStorage` (PENDING_CHECKIN_KEY) y lo manda a loguearse.  Este
 *   hook (montado a nivel app, junto a `useSession`) detecta el código
 *   pendiente en cuanto hay sesión (al boot o tras SIGNED_IN) y procesa
 *   el check-in automáticamente, reconciliando saldo/racha y disparando
 *   la celebración (`checkinResult`).
 *
 *   Robustez:
 *     · One-shot: limpia el código de localStorage tras procesarlo con
 *       una respuesta del servidor (éxito o fallo de negocio).
 *     · Si falla la RED, conserva el código y reintenta en el próximo
 *       evento de auth (no perdemos el check-in del usuario).
 */

export const PENDING_CHECKIN_KEY = "ng_pending_checkin";

export function usePendingCheckin() {
	const tenant = useTenant();
	const setCheckinResult = useGameState((s) => s.setCheckinResult);
	const setBalance = useGameState((s) => s.setBalance);
	const setStreak = useGameState((s) => s.setStreak);
	const processingRef = useRef(false);

	useEffect(() => {
		let cancelled = false;

		async function process() {
			if (processingRef.current || typeof window === "undefined") return;
			let code: string | null = null;
			try {
				code = window.localStorage.getItem(PENDING_CHECKIN_KEY);
			} catch {
				code = null;
			}
			if (!code) return;

			let token: string | null = null;
			try {
				token = await getAccessToken();
			} catch {
				token = null;
			}
			if (!token) return; // aún sin sesión → esperamos al evento de auth

			processingRef.current = true;
			try {
				const res = await fetch("/api/checkin", {
					method: "POST",
					cache: "no-store",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
						"X-Tenant-Slug": tenant.slug,
					},
					body: JSON.stringify({ code, tenant_slug: tenant.slug }),
				});
				const data = (await res.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				// Respuesta del servidor recibida → es one-shot, limpiamos.
				try {
					window.localStorage.removeItem(PENDING_CHECKIN_KEY);
				} catch {
					/* ignore */
				}
				if (cancelled) return;

				if (res.ok && data.ok === true) {
					if (typeof data.balance === "number") setBalance(data.balance);
					if (typeof data.streak === "number") setStreak(data.streak);
					setCheckinResult({
						ok: true,
						qrLabel: String(data.qr_label ?? "Check-in"),
						reward: Number(data.reward_amount ?? 0),
						streak: Number(data.streak ?? 0),
						milestoneWeek: Number(data.milestone_week ?? 0),
						milestoneAmount: Number(data.milestone_amount ?? 0),
					});
				} else {
					setCheckinResult({
						ok: false,
						error: String(data.error ?? "error"),
						qrLabel: data.qr_label ? String(data.qr_label) : undefined,
					});
				}
			} catch {
				// Error de red → NO limpiamos el código; reintentaremos.
				processingRef.current = false;
			}
		}

		void process();

		const supabase = getBrowserSupabase();
		if (!supabase) return () => {
			cancelled = true;
		};
		const { data } = supabase.auth.onAuthStateChange((event) => {
			if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void process();
		});
		return () => {
			cancelled = true;
			data.subscription.unsubscribe();
		};
	}, [tenant.slug, setCheckinResult, setBalance, setStreak]);
}
