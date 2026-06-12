-- =========================================================================
--  19_scalability_indexes.sql — Barrido de índices en tablas calientes
--  (Auditoría 360º · §2 — el camino a las 50 discotecas)
-- =========================================================================
--
--   Las dos consultas más calientes del sistema hacían Sequential Scan:
--
--     1. DECK de Tinder / swipe + leaderboard del DJ:
--          WHERE event_id = ? AND is_played = false ORDER BY total_votes DESC
--        `event_tracks` no tenía NINGÚN índice más allá de la PK → seq scan
--        de toda la tabla (histórico de cientos de locales).
--
--     2. "Temas ya votados por este usuario" (deck + dedupe):
--          WHERE event_id = ? AND user_id = ?
--        `track_votes` sólo tenía UNIQUE (track_id, user_id); la columna
--        líder es track_id, así que esa consulta no lo aprovechaba → seq
--        scan que crece con cada voto de la noche.
--
--   Ambos índices son CREATE INDEX IF NOT EXISTS (idempotentes).
-- =========================================================================

-- 1. Deck/leaderboard: cubre el filtro por evento + estado y el orden por votos.
create index if not exists idx_event_tracks_deck
	on public.event_tracks (event_id, is_played, total_votes desc);

-- 2. Votos por usuario en un evento (deck "no votados" + dedupe).
create index if not exists idx_track_votes_user
	on public.track_votes (event_id, user_id);
