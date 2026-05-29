import { useCallback, useState } from "react";
import { getAccessToken } from "./supabase.client";
import { useTenant } from "./tenant";
import { useGameState } from "../store/useGameState";

/**
 * useClaim — reclama un premio de gamificación SERVER-AUTHORITATIVE.
 *
 *   A diferencia de `useEarn` (legacy: el cliente mandaba amount+reason),
 *   aquí el cliente sólo envía un `event_code`.  El RPC
 *   `claim_gamification_reward` lee el importe de `tenant_token_rewards`
 *   y aplica el límite diario por `business_night`.  El cliente NO puede
 *   inflar la recompensa ni saltarse el tope.
 *
 *   Patrón "Optimistic UI" recomendado en el caller:
 *     1. addTokens(amount) + animación inmediata (60fps, sin esperar red).
 *     2. claim(event_code) en background.
 *     3. reconciliar con `setBalance(res.balance, res.lifetime_earned)`:
 *        - éxito  → confirma el saldo real.
 *        - fallo (daily_limit_reached / sin red) → el ledger corrige la
 *          UI optimista (revierte el +N que no se concedió).
 *
 *   `claim` SIEMPRE devuelve el balance autoritativo cuando hay respuesta
 *   del servidor (incluso en fallo), para que la reconciliación funcione.
 */

export type ClaimError =
	| "unauthorized"
	| "missing_tenant"
	| "daily_limit_reached"
	| "unknown_reward"
	| "not_claimable"
	| "network_error"
	| "rpc_failed";

export type ClaimResult =
	| { ok: true; amount: number; balance: number; lifetime_earned: number }
	| { ok: false; error: ClaimError; balance?: number };

const ENDPOINT = "/api/wallet";

export function useClaim() {
	const tenant = useTenant();
	const setBalance = useGameState((s) => s.setBalance);
	const [pending, setPending] = useState(false);

	const claim = useCallback(
		async (eventCode: string, eventId?: string | null): Promise<ClaimResult> => {
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
					cache: "no-store",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						tenant_slug: tenant.slug,
						event_code: eventCode,
						event_id: eventId ?? undefined,
					}),
				});
				const payload = (await res.json().catch(() => ({}))) as {
					ok?: boolean;
					amount?: number;
					balance?: number;
					lifetime_earned?: number;
					error?: string;
				};

				if (!res.ok || payload.ok === false) {
					// Reconciliar incluso en fallo: el server manda el balance real.
					if (typeof payload.balance === "number") {
						setBalance(payload.balance);
					}
					setPending(false);
					return {
						ok: false,
						error: (payload.error as ClaimError) ?? "rpc_failed",
						balance:
							typeof payload.balance === "number"
								? payload.balance
								: undefined,
					};
				}

				const balance = Number(payload.balance ?? 0);
				const lifetime = Number(payload.lifetime_earned ?? 0);
				setBalance(balance, lifetime);
				setPending(false);
				return {
					ok: true,
					amount: Number(payload.amount ?? 0),
					balance,
					lifetime_earned: lifetime,
				};
			} catch {
				setPending(false);
				return { ok: false, error: "network_error" };
			}
		},
		[tenant.slug, setBalance],
	);

	return { claim, pending };
}
