import { useCallback, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";
import { useGameState } from "../store/useGameState";

/**
 * useEarn — emite ingresos reales contra `/api/wallet`.
 *
 *   El endpoint POST /api/wallet con `amount > 0` ya inserta en
 *   `wallet_ledger` y el trigger materializa balance + lifetime_earned.
 *   Esta hook envuelve esa llamada con:
 *
 *     · JWT obligatorio (sin token → ok:false / unauthorized).
 *     · Tenant slug automático.
 *     · Sync inmediato de `useGameState.tokens` y `lifetimeEarned`
 *       con la respuesta autoritativa del servidor.
 *
 *   Regla CTO: si la red falla, el caller NO debe actualizar la UI
 *   local con la recompensa.  Esta hook devuelve `{ ok: false }` para
 *   que el caller muestre toast y aborte.  Cero "tokens fantasma".
 */

export type EarnError =
	| "unauthorized"
	| "missing_tenant"
	| "invalid_amount"
	| "network_error"
	| "rpc_failed";

export type EarnResult =
	| { ok: true; balance: number; lifetime_earned: number }
	| { ok: false; error: EarnError; detail?: string };

const ENDPOINT = "/api/wallet";

export function useEarn() {
	const tenant = useTenant();
	const setBalance = useGameState((s) => s.setBalance);
	const [pending, setPending] = useState(false);

	const earn = useCallback(
		async (amount: number, reason: string): Promise<EarnResult> => {
			if (!Number.isFinite(amount) || amount <= 0) {
				return { ok: false, error: "invalid_amount" };
			}
			setPending(true);
			let token: string | null = null;
			try {
				token = await getAccessToken();
			} catch {
				token = null;
			}
			if (!token) {
				setPending(false);
				return { ok: false, error: "unauthorized" };
			}

			try {
				const res = await fetch(ENDPOINT, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						tenant_slug: tenant.slug,
						amount: Math.trunc(amount),
						reason: reason.slice(0, 64),
					}),
				});
				const payload = (await res.json().catch(() => ({}))) as {
					ok?: boolean;
					balance?: number;
					lifetime_earned?: number;
					error?: string;
				};
				if (!res.ok || payload.ok === false) {
					setPending(false);
					return {
						ok: false,
						error: (payload.error as EarnError) ?? "rpc_failed",
					};
				}
				const balance = Number(payload.balance ?? 0);
				const lifetime = Number(payload.lifetime_earned ?? 0);
				setBalance(balance, lifetime);
				setPending(false);
				return { ok: true, balance, lifetime_earned: lifetime };
			} catch {
				setPending(false);
				return { ok: false, error: "network_error" };
			}
		},
		[tenant.slug, setBalance],
	);

	return { earn, pending };
}
