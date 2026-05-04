-- ─────────────────────────────────────────────────────────────────────────
--   La Pocha · Lock down the spend_tokens RPC
--
--   spend_tokens() is SECURITY DEFINER and runs with the privileges of
--   its owner (postgres).  By default Supabase grants EXECUTE on user
--   functions to the `public` role, which means any holder of the anon
--   key could call it directly via /rest/v1/rpc/spend_tokens and bypass
--   the worker's auth checks.
--
--   Strip that privilege.  Only `service_role` (used exclusively by the
--   Cloudflare Worker server-side) is allowed to invoke the function.
--
--   Run AFTER `database/02_production_ready.sql`.
-- ─────────────────────────────────────────────────────────────────────────

revoke execute on function public.spend_tokens(uuid, uuid, int, text, jsonb)
	from public;
revoke execute on function public.spend_tokens(uuid, uuid, int, text, jsonb)
	from anon;
revoke execute on function public.spend_tokens(uuid, uuid, int, text, jsonb)
	from authenticated;

grant execute on function public.spend_tokens(uuid, uuid, int, text, jsonb)
	to service_role;

-- Same lockdown for update_user_token_balance — it is only ever called
-- by the AFTER INSERT trigger, never directly.
revoke execute on function public.update_user_token_balance() from public;
revoke execute on function public.update_user_token_balance() from anon;
revoke execute on function public.update_user_token_balance() from authenticated;
