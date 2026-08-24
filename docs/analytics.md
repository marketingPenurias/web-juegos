## Table `dim_events`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `event_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `event_name` | `text` |  Nullable |
| `event_type` | `text` |  Nullable |
| `event_start` | `timestamptz` |  Nullable |
| `event_end` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `dim_locations`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `location_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `location_name` | `text` |  Nullable |
| `location_type` | `text` |  Nullable |
| `qr_zone` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `dim_tenants`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `tenant_id` | `uuid` | Primary |
| `tenant_name` | `text` |  |
| `industry` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |

## Table `dim_time`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `time_id` | `int4` | Primary |
| `day` | `date` |  |
| `week` | `int4` |  |
| `month` | `int4` |  |
| `quarter` | `int4` |  |
| `year` | `int4` |  |
| `weekday` | `int4` |  |
| `hour` | `int4` |  |
| `minute` | `int4` |  |
| `is_weekend` | `bool` |  |

## Table `dim_users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_email` | `text` |  Nullable |
| `user_name` | `text` |  Nullable |
| `user_status` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `last_seen_at` | `timestamptz` |  Nullable |
| `user_level` | `text` |  Nullable |
| `country` | `text` |  Nullable |
| `city` | `text` |  Nullable |
| `gender` | `text` |  Nullable |
| `age_group` | `text` |  Nullable |

## Table `fact_rewards`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `fact_reward_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `time_id` | `int4` |  |
| `reward_type` | `text` |  Nullable |
| `reward_value` | `numeric` |  Nullable |
| `tokens_redeemed` | `int4` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `fact_transactions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `fact_transaction_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `time_id` | `int4` |  |
| `location_id` | `uuid` |  Nullable |
| `event_id` | `uuid` |  Nullable |
| `transaction_type` | `text` |  |
| `amount_eur` | `numeric` |  Nullable |
| `tokens_awarded` | `int4` |  Nullable |
| `tokens_spent` | `int4` |  Nullable |
| `points` | `int4` |  Nullable |
| `source` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `fact_visits`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `fact_visit_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `time_id` | `int4` |  |
| `location_id` | `uuid` |  Nullable |
| `event_id` | `uuid` |  Nullable |
| `visit_duration_seconds` | `int4` |  Nullable |
| `visit_type` | `text` |  Nullable |
| `is_new` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `social_graph_referrals`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `referral_id` | `uuid` | Primary |
| `tenant_id` | `uuid` |  |
| `user_id` | `uuid` |  |
| `referrer_id` | `uuid` |  Nullable |
| `depth` | `int4` |  |
| `referral_count` | `int4` |  |
| `total_ltv` | `numeric` |  |
| `first_referred_at` | `timestamptz` |  Nullable |
| `last_referred_at` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

