import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCookies, serializeCookie } from "./api.server";

/**
 * Resolución del `?ref=` que trae quien llega invitado.
 *
 *   `root.tsx` guarda el código en la cookie `ng_tracking_ref`, que sobrevive
 *   al ida y vuelta del login de Google.  Aquí se traduce a una de dos cosas:
 *
 *     · una **campaña** de `tracking_campaigns` (un QR, un cartel), o
 *     · una **persona** que invitó (`user_profiles.invite_code`).
 *
 *   Vive en su propio módulo porque hacen falta las DOS rutas de alta.  El
 *   perfil se crea tanto en `api.auth-sync` como en el alta perezosa de
 *   `api.session`, y hasta ahora solo la primera consumía la cookie — con el
 *   resultado de que la mayoría de altas (325 de 361 en La Pocha) llegaban sin
 *   atribución ninguna.  Duplicar esta lógica garantizaría que las dos rutas
 *   acaben discrepando.
 */

const REF_COOKIE = "ng_tracking_ref";

export type RefResolution = {
	/** Campaña de captación, si el código era de una. */
	campaignId: string | null;
	/** Perfil de quien invitó, si el código era personal. */
	referrerId: string | null;
	/** El código en crudo, para dejar rastro en `acquisition_source`. */
	code: string | null;
};

/** Cabecera para caducar la cookie una vez usada. */
export function clearRefCookie(request: Request): string {
	return serializeCookie(REF_COOKIE, "", {
		maxAge: 0,
		secure: new URL(request.url).protocol === "https:",
	});
}

export async function resolveRefCookie(
	supabase: SupabaseClient,
	request: Request,
	tenantId: string,
): Promise<RefResolution> {
	const code = (parseCookies(request)[REF_COOKIE] || "").trim();
	if (!code) return { campaignId: null, referrerId: null, code: null };

	// Campaña primero: un código de campaña es de la casa y manda sobre uno
	// personal si por lo que sea coincidieran.
	const { data: campaignId } = await supabase.rpc("resolve_tracking_campaign", {
		p_tenant_id: tenantId,
		p_code: code,
	});
	if (typeof campaignId === "string" && campaignId) {
		return { campaignId, referrerId: null, code };
	}

	const { data: referrerId } = await supabase.rpc("resolve_invite_code", {
		p_tenant_id: tenantId,
		p_code: code,
	});
	if (typeof referrerId === "string" && referrerId) {
		return { campaignId: null, referrerId, code };
	}

	// Código desconocido (caducado, mal tecleado): se guarda igualmente en
	// `acquisition_source` para poder investigar de dónde salió.
	return { campaignId: null, referrerId: null, code };
}
