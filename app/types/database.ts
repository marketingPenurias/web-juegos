/**
 * Nightgraph · Supabase / Postgres schema types
 *
 * Hand-written from `.claude/skills/docs/squema.md` (post-NIGHTGRAPH
 * enterprise upgrade).  Layout follows the same shape that
 * `supabase gen types typescript` produces so we can swap to the
 * CLI-generated file later without changing call sites.
 *
 * Naming convention:
 *   ┌── `Row`      : SELECT shape
 *   ├── `Insert`   : INSERT shape (server-side; defaults are optional)
 *   └── `Update`   : UPDATE shape (every column optional)
 */

export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

// ─── tenants ──────────────────────────────────────────────────────────────

export type TenantStatus = "active" | "paused" | "churned";

export interface TenantTheme {
	primary?: string;
	secondary?: string;
	accent?: string;
	background?: string;
}

export interface TenantFeatures {
	games?: {
		tinder_musical?: boolean;
		roulette?: boolean;
		flash_drops?: boolean;
	};
	limits?: {
		max_vip_users?: number;
	};
}

export interface TenantRow {
	id: string;
	slug: string;
	name: string;
	status: TenantStatus;
	theme: TenantTheme;
	features: TenantFeatures;
	promoter_id: string | null;
	created_at: string;
}
export type TenantInsert = Omit<TenantRow, "id" | "created_at"> &
	Partial<Pick<TenantRow, "id" | "created_at" | "theme" | "features">>;
export type TenantUpdate = Partial<TenantRow>;

// ─── promoters ────────────────────────────────────────────────────────────

export interface PromoterRow {
	id: string;
	name: string;
	contact_email: string | null;
	created_at: string;
}
export type PromoterInsert = Omit<PromoterRow, "id" | "created_at"> &
	Partial<Pick<PromoterRow, "id" | "created_at">>;
export type PromoterUpdate = Partial<PromoterRow>;

// ─── user_profiles ────────────────────────────────────────────────────────

export interface UserProfileRow {
	id: string;
	tenant_id: string;
	email: string;
	display_name: string | null;
	acquisition_source: string | null;
	acquisition_campaign_id: string | null;
	vip_level: number;
	token_balance: number;
	lifetime_earned: number;
	auth_user_id: string | null;
	created_at: string;
}
export type UserProfileInsert = Omit<
	UserProfileRow,
	"id" | "created_at" | "token_balance" | "lifetime_earned"
> &
	Partial<
		Pick<
			UserProfileRow,
			"id" | "created_at" | "token_balance" | "lifetime_earned"
		>
	>;
export type UserProfileUpdate = Partial<UserProfileRow>;

// ─── venue_visits ─────────────────────────────────────────────────────────

export interface VenueVisitRow {
	id: string;
	tenant_id: string;
	user_id: string;
	entry_time: string;
	exit_time: string | null;
	created_at: string;
}
export type VenueVisitInsert = Omit<VenueVisitRow, "id" | "created_at"> &
	Partial<Pick<VenueVisitRow, "id" | "created_at" | "entry_time">>;
export type VenueVisitUpdate = Partial<VenueVisitRow>;

// ─── behavior_events ──────────────────────────────────────────────────────

export interface BehaviorEventRow {
	id: number;
	tenant_id: string;
	visit_id: string | null;
	user_id: string | null;
	event_category: string;
	event_action: string;
	metadata: Json;
	created_at: string;
}
export type BehaviorEventInsert = Omit<
	BehaviorEventRow,
	"id" | "created_at"
> &
	Partial<Pick<BehaviorEventRow, "id" | "created_at" | "metadata">>;

// ─── wallet_ledger ────────────────────────────────────────────────────────

export interface WalletLedgerRow {
	id: number;
	tenant_id: string;
	user_id: string;
	amount: number;
	reason: string;
	metadata: Json;
	event_id: string | null;
	product_id: string | null;
	product_name_at_time: string | null;
	price_tokens_at_time: number | null;
	promoter_code_id: string | null;
	campaign_type: string | null;
	created_at: string;
}
export type WalletLedgerInsert = Omit<WalletLedgerRow, "id" | "created_at"> &
	Partial<Pick<WalletLedgerRow, "id" | "created_at" | "metadata">>;

// ─── tenant_events (party sessions) ───────────────────────────────────────

export type TenantEventStatus = "draft" | "active" | "closed";

export interface TenantEventRow {
	id: string;
	tenant_id: string;
	name: string;
	start_time: string;
	end_time: string | null;
	status: TenantEventStatus;
	created_at: string;
}
export type TenantEventInsert = Omit<TenantEventRow, "id" | "created_at"> &
	Partial<Pick<TenantEventRow, "id" | "created_at" | "status">>;
export type TenantEventUpdate = Partial<TenantEventRow>;

// ─── tenant_products (token-priced catalog) ───────────────────────────────

export type TenantProductType =
	| "drink"
	| "reward"
	| "game_ticket"
	| "vip_access";

export interface TenantProductRow {
	id: string;
	tenant_id: string;
	product_type: TenantProductType;
	name: string;
	price_tokens: number;
	reference_fiat: number | null;
	is_active: boolean;
	created_at: string;
}
export type TenantProductInsert = Omit<TenantProductRow, "id" | "created_at"> &
	Partial<Pick<TenantProductRow, "id" | "created_at" | "is_active">>;
export type TenantProductUpdate = Partial<TenantProductRow>;

// ─── tenant_staff (RBAC) ──────────────────────────────────────────────────

export type StaffRole =
	| "admin"
	| "manager"
	| "door"
	| "bar"
	| "dj"
	| "promoter"
	| "display";

export interface TenantStaffRow {
	id: string;
	tenant_id: string;
	user_id: string;
	role: StaffRole;
	is_active: boolean;
	created_at: string;
}
export type TenantStaffInsert = Omit<TenantStaffRow, "id" | "created_at"> &
	Partial<Pick<TenantStaffRow, "id" | "created_at" | "is_active">>;

// ─── promoter_codes ───────────────────────────────────────────────────────

export interface PromoterCodeRow {
	id: string;
	tenant_id: string;
	staff_id: string;
	code: string;
	commission_tokens: number | null;
	commission_percent: number | null;
	created_at: string;
}

// ─── tracking_campaigns ───────────────────────────────────────────────────

export type CampaignType =
	| "location"
	| "promoter"
	| "game"
	| "social"
	| "paid_ads";

export interface TrackingCampaignRow {
	id: string;
	tenant_id: string;
	code: string;
	campaign_type: CampaignType;
	metadata: Json;
	is_active: boolean;
	created_at: string;
}
export type TrackingCampaignInsert = Omit<
	TrackingCampaignRow,
	"id" | "created_at" | "is_active" | "metadata"
> &
	Partial<
		Pick<TrackingCampaignRow, "id" | "created_at" | "is_active" | "metadata">
	>;

// ─── audit_logs ───────────────────────────────────────────────────────────

export interface AuditLogRow {
	id: string;
	tenant_id: string;
	actor_id: string;
	action: string;
	table_name: string | null;
	record_id: string | null;
	old_data: Json | null;
	new_data: Json | null;
	ip_address: string | null;
	created_at: string;
}
export type AuditLogInsert = Omit<AuditLogRow, "id" | "created_at"> &
	Partial<Pick<AuditLogRow, "id" | "created_at">>;

// ─── event_tracks (Tinder Musical / Jukebox catalog) ──────────────────────

export interface EventTrackRow {
	id: string;
	tenant_id: string;
	event_id: string;
	spotify_id: string;
	title: string;
	artist: string;
	cover_image_url: string | null;
	total_votes: number;
	is_played: boolean;
	created_at: string;
	played_at: string | null;
}
export type EventTrackInsert = Omit<
	EventTrackRow,
	"id" | "created_at" | "total_votes" | "is_played" | "played_at"
> &
	Partial<
		Pick<
			EventTrackRow,
			"id" | "created_at" | "total_votes" | "is_played" | "played_at"
		>
	>;
export type EventTrackUpdate = Partial<EventTrackRow>;

// ─── track_votes ──────────────────────────────────────────────────────────

export type TrackVoteType = "free" | "boost";

export interface TrackVoteRow {
	id: string;
	tenant_id: string;
	event_id: string;
	track_id: string;
	user_id: string;
	vote_type: TrackVoteType;
	tokens_spent: number;
	created_at: string;
}
export type TrackVoteInsert = Omit<TrackVoteRow, "id" | "created_at"> &
	Partial<Pick<TrackVoteRow, "id" | "created_at" | "tokens_spent">>;

// ─── user_rewards (token-funded inventory) ────────────────────────────────

export type UserRewardStatus = "available" | "redeeming" | "redeemed" | "expired";

export interface UserRewardRow {
	id: string;
	tenant_id: string;
	user_id: string;
	product_id: string;
	event_id: string | null;
	status: UserRewardStatus;
	redeemed_at: string | null;
	expires_at: string | null;
	created_at: string;
}
export type UserRewardInsert = Omit<UserRewardRow, "id" | "created_at"> &
	Partial<Pick<UserRewardRow, "id" | "created_at" | "status">>;
export type UserRewardUpdate = Partial<UserRewardRow>;

// ─── RPC signatures (server-side, locked to service_role) ─────────────────

export interface SpendTokensArgs {
	p_tenant_id: string;
	p_user_id: string;
	p_amount: number;
	p_reason: string;
	p_metadata?: Json;
}
export type SpendTokensReturn = number | null;

export interface PurchaseRewardArgs {
	p_tenant_id: string;
	p_user_id: string;
	p_product_id: string;
	p_event_id?: string | null;
}
export interface PurchaseRewardReturn {
	reward_id: string;
	new_balance: number;
}

export interface StartRedemptionArgs {
	p_tenant_id: string;
	p_user_id: string;
	p_reward_id: string;
}
export interface StartRedemptionReturn {
	success: boolean;
	expires_at: string;
}

export interface VoteTrackArgs {
	p_tenant_id: string;
	p_user_id: string;
	p_event_id: string;
	p_track_id: string;
	p_vote_type: TrackVoteType;
	p_tokens_spent?: number;
}
export type VoteTrackReturn =
	| {
			ok: true;
			vote_id: string;
			total_votes: number;
			balance?: number;
	  }
	| {
			ok: false;
			error: "insufficient_funds" | "already_voted" | "track_unavailable";
			balance?: number;
	  };

// ─── Discriminated unions used by API handlers ────────────────────────────

export type RewardActionType = "purchase" | "redeem";

export interface RewardPurchaseRequest {
	action_type: "purchase";
	tenant_slug?: string;
	product_id: string;
	event_id?: string;
}
export interface RewardRedeemRequest {
	action_type: "redeem";
	tenant_slug?: string;
	reward_id: string;
}
export type RewardRequest = RewardPurchaseRequest | RewardRedeemRequest;
