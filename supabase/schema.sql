-- =========================================================
-- レッスンスケジュール:データベースの表と安全の設定
-- Supabase の「SQL Editor」に全部貼り付けて「Run」を1回押す。
-- 何度実行しても壊れないように書いてある(すでにあるものは作り直さない)。
-- =========================================================
-- ・どの表にも user_id(だれのデータか)を持たせ、
--   RLS(行単位のアクセス制限)で「ログインした本人の行だけ」読み書きできるようにする。
-- ・2026年5月以降に作ったプロジェクトは、表を作っただけではアプリから使えないため、
--   ログインした人(authenticated)にだけ読み書きの許可(GRANT)を出す。
--   ログインしていない人(anon)には何も許可しない。

-- ---------- 予定(1件ずつ)----------
create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,                 -- 2026-10-14
  start       text not null,                 -- 13:15
  duration    integer not null check (duration > 0 and duration <= 1440),  -- 分
  student     text not null default '',      -- 名前・内容
  type_id     text not null default '',      -- 種類
  status      text not null default 'tentative',  -- tentative / confirmed / cancelled / none
  memo        text not null default '',
  deleted_at  timestamptz,                   -- ゴミ箱に入れた日時(手順6で使う)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lessons_user_date on public.lessons (user_id, date);

-- ---------- 日ごとのメモ(「予定」の行)----------
create table if not exists public.day_notes (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date     date not null,
  text     text not null,
  primary key (user_id, date)
);

-- ---------- 設定(種類と色・換算表など。中身はまとめて JSON で持つ)----------
create table if not exists public.user_settings (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key      text not null,                    -- 'types' / 'durationRules' など
  value    jsonb not null,
  primary key (user_id, key)
);

-- ---------- 月ごとの情報(仮の月かどうか。手順10で使う)----------
create table if not exists public.months (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ym         text not null,                  -- 2026-10
  tentative  boolean not null default false,
  primary key (user_id, ym)
);

-- ---------- 毎週の固定枠(手順7で使う)----------
create table if not exists public.recurring_slots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  weekday     integer not null check (weekday between 0 and 6),  -- 0=日曜
  start       text not null,
  duration    integer not null,
  student     text not null default '',
  type_id     text not null default '',
  status      text not null default 'confirmed',
  memo        text not null default '',
  start_date  date not null,
  end_date    date,
  created_at  timestamptz not null default now()
);

-- ---------- 固定枠の例外(この週だけ休み・変更。手順7で使う)----------
create table if not exists public.recurring_exceptions (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id   uuid not null references public.recurring_slots (id) on delete cascade,
  date      date not null,
  action    text not null check (action in ('skip', 'change')),
  lesson    jsonb,                           -- 変更後の内容(change のとき)
  unique (slot_id, date)
);

-- ---------- 生徒メモ(手順9で使う)----------
create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  memo        text not null default '',
  updated_at  timestamptz not null default now()
);

-- ---------- 安全の設定:RLS と許可 ----------
do $$
declare t text;
begin
  foreach t in array array['lessons', 'day_notes', 'user_settings', 'months',
                           'recurring_slots', 'recurring_exceptions', 'students']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
