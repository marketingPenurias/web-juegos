import { useEffect, useState } from "react";
import { getBrowserSupabase } from "./supabase.client";

/**
 * useAuthUser — accesor reactivo al usuario de Supabase Auth.
 *
 *   Devuelve el `User` actual (email, id, metadata) y se actualiza
 *   ante SIGNED_IN / SIGNED_OUT / USER_UPDATED.  En modo demo
 *   (Supabase sin configurar) devuelve null perpetuamente — el
 *   caller debe tener un fallback razonable.
 */

export type AuthUser = {
	id: string;
	email: string | null;
	displayName: string | null;
	avatarUrl: string | null;
};

function fromSupabaseUser(user: {
	id: string;
	email?: string | null;
	user_metadata?: Record<string, unknown> | null;
}): AuthUser {
	const meta = user.user_metadata ?? {};
	const fullName =
		(typeof meta.full_name === "string" && meta.full_name) ||
		(typeof meta.name === "string" && meta.name) ||
		null;
	const avatar =
		(typeof meta.avatar_url === "string" && meta.avatar_url) ||
		(typeof meta.picture === "string" && meta.picture) ||
		null;
	return {
		id: user.id,
		email: user.email ?? null,
		displayName: fullName,
		avatarUrl: avatar,
	};
}

export function useAuthUser(): AuthUser | null {
	const [user, setUser] = useState<AuthUser | null>(null);

	useEffect(() => {
		const supabase = getBrowserSupabase();
		if (!supabase) return;

		let cancelled = false;
		void supabase.auth.getUser().then(({ data }) => {
			if (cancelled || !data.user) return;
			setUser(fromSupabaseUser(data.user));
		});

		const { data } = supabase.auth.onAuthStateChange((event, session) => {
			if (event === "SIGNED_OUT") {
				setUser(null);
				return;
			}
			if (session?.user) {
				setUser(fromSupabaseUser(session.user));
			}
		});

		return () => {
			cancelled = true;
			data.subscription.unsubscribe();
		};
	}, []);

	return user;
}
