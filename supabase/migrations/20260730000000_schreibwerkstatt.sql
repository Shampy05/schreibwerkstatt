-- Schreibwerkstatt: sessions + per-user settings.
--
-- Design note: the error LEDGER is deliberately not a table. It is a pure fold
-- over `sessions` (see buildLedger in src/lib/ledger.js) — every occurrence and
-- every languaging note already lives on the session that produced it. Storing
-- it separately would create two sources of truth that can disagree, and the
-- ledger is cheap to rebuild for a personal corpus of a few hundred sessions.

create table if not exists public.sessions (
  user_id      uuid not null references auth.users (id) on delete cascade,
  id           uuid not null,
  date         date not null,
  prompt_id    text,
  prompt_text  text,
  prompt_requirements jsonb not null default '[]'::jsonb,
  draft        text not null default '',
  final_text   text not null default '',
  check_count  integer not null default 0,
  graded_by    text,
  -- [{ quote, patternCode, rung, unresolved }]
  errors       jsonb not null default '[]'::jsonb,
  -- { patternCode: "languaging note" }
  notes        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists sessions_user_date_idx
  on public.sessions (user_id, date desc, created_at desc);

create table if not exists public.user_settings (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  active_targets      text[] not null default '{}',
  recent_prompt_ids   text[] not null default '{}',
  recent_prompt_texts text[] not null default '{}',
  cefr_level          text not null default 'B1',
  -- The persisted generated task; null once written or expired.
  current_task        jsonb,
  updated_at          timestamptz not null default now(),
  constraint chk_cefr_level check (cefr_level in ('A2', 'B1', 'B2', 'C1'))
);

alter table public.sessions      enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
