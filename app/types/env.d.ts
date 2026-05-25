/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Supabase project REST URL — same value as SUPABASE_URL on the worker. */
	readonly VITE_SUPABASE_URL: string;
	/** Browser-safe API key (new Supabase naming, replaces "anon"). */
	readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
