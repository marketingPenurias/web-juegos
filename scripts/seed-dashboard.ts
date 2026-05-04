/**
 * Seed La Pocha's dashboard with realistic mock data for the CEO demo.
 *
 *   npm run seed
 *
 * Required environment variables (read from `.dev.vars`, `.env`, or the
 * shell):
 *   SUPABASE_URL                — your project REST URL
 *   SUPABASE_SERVICE_ROLE_KEY   — needed to bypass RLS on writes
 *   SEED_TENANT_SLUG            — optional, default "lapocha"
 *
 * The script is idempotent on the tenant row but appends fresh users +
 * events on every run so the dashboards always look alive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── env loading ──────────────────────────────────────────────────────────

function loadDotEnv(filename: string) {
	try {
		const text = readFileSync(resolve(process.cwd(), filename), "utf8");
		for (const line of text.split(/\r?\n/)) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
			if (!m) continue;
			const [, key, value] = m;
			if (process.env[key] === undefined) process.env[key] = value;
		}
	} catch {
		// optional
	}
}

loadDotEnv(".dev.vars");
loadDotEnv(".env");
loadDotEnv(".env.local");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
	process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? "lapocha";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error(
		"Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
			"Fill them in `.dev.vars` first.",
	);
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false, autoRefreshToken: false },
});

// ── helpers ──────────────────────────────────────────────────────────────

const FIRST = [
	"Alejandro", "María", "Pablo", "Carla", "Marcos", "Lucía", "Diego", "Andrea",
	"Sergio", "Paula", "Iván", "Elena", "Adrián", "Noelia", "Hugo", "Inés",
];
const LAST = [
	"García", "Martínez", "Rodríguez", "Fernández", "López", "Sánchez",
	"Pérez", "Gómez", "Ruiz", "Jiménez", "Hernández", "Díaz", "Moreno",
];
const SOURCES = ["instagram_ads", "tiktok_ads", "organic", "referral", "qr_door"];
const CATEGORIES = [
	"music_preference",
	"vote",
	"jukebox_request",
	"order",
	"social",
	"navigation",
];
const ACTIONS_BY_CATEGORY: Record<string, string[]> = {
	music_preference: ["swipe_right", "swipe_left"],
	vote: ["vote_free", "vote_boost"],
	jukebox_request: ["request", "boost", "cancel"],
	order: ["jager_monster", "ron_cola", "ginebra_limon", "neon_shot"],
	social: ["invite_friend", "share_link", "copy_link"],
	navigation: ["open_hub", "open_live", "open_menu", "open_jukebox"],
};

const rand = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;
const randDate = (daysBack: number) =>
	new Date(Date.now() - randInt(0, daysBack) * 24 * 60 * 60 * 1000);

// ── 1. tenant ────────────────────────────────────────────────────────────

async function ensureTenant(): Promise<string> {
	const { data: existing, error: selErr } = await supabase
		.from("tenants")
		.select("id")
		.eq("slug", TENANT_SLUG)
		.maybeSingle();
	if (selErr) throw selErr;
	if (existing) return existing.id as string;

	const { data: inserted, error: insErr } = await supabase
		.from("tenants")
		.insert({ slug: TENANT_SLUG, name: "La Pocha", status: "active" })
		.select("id")
		.single();
	if (insErr) throw insErr;
	return inserted.id as string;
}

// ── 2. user_profiles ─────────────────────────────────────────────────────

async function seedUsers(tenant_id: string, count: number) {
	const rows = Array.from({ length: count }).map((_, i) => {
		const first = rand(FIRST);
		const last = rand(LAST);
		return {
			tenant_id,
			email: `${first.toLowerCase()}.${last.toLowerCase()}.${Date.now()}.${i}@demo.lapocha.es`,
			display_name: `${first} ${last}`,
			acquisition_source: rand(SOURCES),
			vip_level: randInt(1, 5),
		};
	});

	const { data, error } = await supabase
		.from("user_profiles")
		.insert(rows)
		.select("id");

	if (error) throw error;
	return (data ?? []).map((r) => r.id as string);
}

// ── 3. venue_visits ──────────────────────────────────────────────────────

async function seedVisits(tenant_id: string, userIds: string[], count: number) {
	const rows = Array.from({ length: count }).map(() => {
		const userId = rand(userIds);
		const entry = randDate(28);
		const stayMin = randInt(45, 360); // 45 min – 6 h
		const exit = new Date(entry.getTime() + stayMin * 60 * 1000);
		return {
			tenant_id,
			user_id: userId,
			entry_time: entry.toISOString(),
			exit_time: exit.toISOString(),
		};
	});

	const { data, error } = await supabase
		.from("venue_visits")
		.insert(rows)
		.select("id, user_id, entry_time");
	if (error) throw error;
	return data ?? [];
}

// ── 4. behavior_events ───────────────────────────────────────────────────

async function seedEvents(
	tenant_id: string,
	visits: Array<{ id: string; user_id: string; entry_time: string }>,
	perVisit: number,
) {
	const rows = visits.flatMap((v) => {
		const visitStart = new Date(v.entry_time).getTime();
		return Array.from({ length: perVisit }).map(() => {
			const cat = rand(CATEGORIES);
			const action = rand(ACTIONS_BY_CATEGORY[cat]);
			const offsetMs = randInt(60_000, 4 * 60 * 60 * 1000);
			return {
				tenant_id,
				user_id: v.user_id,
				visit_id: v.id,
				event_category: cat,
				event_action: action,
				metadata: { source: "seed", weight: randInt(1, 5) },
				created_at: new Date(visitStart + offsetMs).toISOString(),
			};
		});
	});

	// Chunk inserts to stay under PostgREST limits.
	const CHUNK = 500;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const slice = rows.slice(i, i + CHUNK);
		const { error } = await supabase.from("behavior_events").insert(slice);
		if (error) throw error;
	}
	return rows.length;
}

// ── 5. wallet_ledger ─────────────────────────────────────────────────────

async function seedWallet(tenant_id: string, userIds: string[]) {
	const rows: Array<{
		tenant_id: string;
		user_id: string;
		amount: number;
		reason: string;
	}> = [];

	for (const user_id of userIds) {
		// Welcome gift
		rows.push({ tenant_id, user_id, amount: 450, reason: "welcome_gift" });
		// 0–6 random spend/earn movements
		const moves = randInt(0, 6);
		for (let i = 0; i < moves; i++) {
			const sign = Math.random() > 0.4 ? -1 : 1;
			const reasons = sign > 0
				? ["mission_complete", "tinder_reward", "streak_bonus"]
				: ["boost_song", "jukebox_boost", "order_jager", "fast_track"];
			rows.push({
				tenant_id,
				user_id,
				amount: sign * randInt(15, 120),
				reason: rand(reasons),
			});
		}
	}

	const CHUNK = 500;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const slice = rows.slice(i, i + CHUNK);
		const { error } = await supabase.from("wallet_ledger").insert(slice);
		if (error) throw error;
	}
	return rows.length;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
	console.log(`▶ Seeding tenant "${TENANT_SLUG}" at ${SUPABASE_URL}`);
	const tenant_id = await ensureTenant();
	console.log(`  tenant_id = ${tenant_id}`);

	const USERS = 50;
	const VISITS = 200;
	const EVENTS_PER_VISIT = 6;

	const userIds = await seedUsers(tenant_id, USERS);
	console.log(`  ✓ ${userIds.length} user_profiles`);

	const visits = await seedVisits(tenant_id, userIds, VISITS);
	console.log(`  ✓ ${visits.length} venue_visits`);

	const eventsCount = await seedEvents(tenant_id, visits, EVENTS_PER_VISIT);
	console.log(`  ✓ ${eventsCount} behavior_events`);

	const ledgerCount = await seedWallet(tenant_id, userIds);
	console.log(`  ✓ ${ledgerCount} wallet_ledger entries`);

	console.log("✔ Done.");
}

main().catch((err) => {
	console.error("✖ Seed failed:", err);
	process.exit(1);
});
