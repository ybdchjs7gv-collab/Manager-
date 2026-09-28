-- Manager: persönlicher Organizer (privat + beruflich)
-- Grundschema: Tabellen, Row Level Security, Tresor-Funktionen für Passwörter,
-- Einzelnutzer-Registrierung.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Einstellungen (eine Zeile pro Nutzer)
-- ---------------------------------------------------------------------------

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'Europe/Berlin',
  day_start time not null default '07:00',
  day_end time not null default '22:00',
  work_days int[] not null default '{1,2,3,4,5}',
  work_start time not null default '08:30',
  work_end time not null default '17:00',
  lunch_start time default '12:30',
  lunch_minutes int not null default 45,
  dinner_time time default '18:30',
  buffer_minutes int not null default 10,
  max_block_minutes int not null default 90,
  preferences jsonb not null default '{}'::jsonb,
  auto_delete_newsletters boolean not null default false,
  auto_add_events boolean not null default true,
  auto_create_tasks boolean not null default true,
  ai_model text not null default 'claude-opus-5-5',
  ai_model_bulk text not null default 'claude-opus-5-5',
  ics_token text not null default encode(extensions.gen_random_bytes(24), 'hex') unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Kalender-Verbindungen (CalDAV, z. B. iCloud) – Passwort liegt im Tresor
-- ---------------------------------------------------------------------------

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null default 'iCloud',
  kind text not null default 'caldav' check (kind in ('caldav', 'ics')),
  server_url text not null,
  username text,
  principal_url text,
  home_url text,
  calendars jsonb not null default '[]'::jsonb,
  write_privat_href text,
  write_beruflich_href text,
  last_sync_at timestamptz,
  last_error text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index calendar_connections_user_idx on public.calendar_connections (user_id);

-- ---------------------------------------------------------------------------
-- Termine
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  area text not null default 'privat' check (area in ('privat', 'beruflich')),
  kind text not null default 'termin'
    check (kind in ('termin', 'aufgabe', 'sport', 'kochen', 'haushalt', 'einkauf', 'fokus', 'pause', 'sonstiges')),
  source text not null default 'manual'
    check (source in ('manual', 'email', 'whatsapp', 'planner', 'caldav', 'ai')),
  source_ref text,
  ref_table text,
  ref_id uuid,
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled', 'done')),
  reminder_minutes int,
  cal_connection_id uuid references public.calendar_connections (id) on delete set null,
  cal_href text,
  ext_uid text,
  ext_href text,
  ext_instance text not null default '',
  ext_etag text,
  sync_state text not null default 'local'
    check (sync_state in ('local', 'pending', 'synced', 'delete', 'error', 'readonly')),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_order check (end_at >= start_at)
);

create index events_user_start_idx on public.events (user_id, start_at);
create index events_sync_idx on public.events (user_id, sync_state) where sync_state in ('pending', 'delete');
-- NULL-Werte gelten als verschieden: nur Termine aus einem Kalender-Konto werden abgeglichen.
alter table public.events add constraint events_ext_unique unique (cal_connection_id, ext_href, ext_instance);

create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Aufgaben
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  notes text,
  area text not null default 'privat' check (area in ('privat', 'beruflich')),
  priority int not null default 2 check (priority between 1 and 3),
  duration_min int not null default 30 check (duration_min > 0),
  due_date date,
  status text not null default 'offen' check (status in ('offen', 'geplant', 'erledigt')),
  event_id uuid references public.events (id) on delete set null,
  source text not null default 'manual',
  source_ref text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_status_idx on public.tasks (user_id, status, due_date);

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Haushalt (wiederkehrende Aufgaben)
-- ---------------------------------------------------------------------------

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  room text,
  duration_min int not null default 20 check (duration_min > 0),
  interval_days int not null default 7 check (interval_days > 0),
  preferred_weekdays int[] not null default '{}',
  preferred_time text not null default 'egal' check (preferred_time in ('morgens', 'mittags', 'abends', 'egal')),
  last_done_at timestamptz,
  next_due date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index chores_user_due_idx on public.chores (user_id, next_due);

-- ---------------------------------------------------------------------------
-- Sportplan
-- ---------------------------------------------------------------------------

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  sport text not null default 'sonstiges',
  duration_min int not null default 45 check (duration_min > 0),
  weekdays int[] not null default '{}',
  preferred_time text not null default 'egal' check (preferred_time in ('morgens', 'mittags', 'abends', 'egal')),
  intensity text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index workouts_user_idx on public.workouts (user_id);

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id uuid references public.workouts (id) on delete set null,
  day date not null,
  title text not null,
  duration_min int,
  done boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index workout_logs_user_day_idx on public.workout_logs (user_id, day);
create unique index workout_logs_unique_idx on public.workout_logs (workout_id, day) where workout_id is not null;

-- ---------------------------------------------------------------------------
-- Rezepte, Essensplan, Einkaufsliste
-- ---------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  prep_min int not null default 30 check (prep_min > 0),
  servings int not null default 2,
  instructions text,
  tags text[] not null default '{}',
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create index recipes_user_idx on public.recipes (user_id);

create table public.meal_plan (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  meal text not null default 'abend' check (meal in ('fruehstueck', 'mittag', 'abend', 'snack')),
  recipe_id uuid references public.recipes (id) on delete set null,
  title text not null,
  prep_min int,
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, day, meal)
);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  quantity text,
  category text not null default 'Sonstiges',
  checked boolean not null default false,
  source text not null default 'manual',
  recipe_id uuid references public.recipes (id) on delete set null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);

create index shopping_items_user_idx on public.shopping_items (user_id, checked);

-- ---------------------------------------------------------------------------
-- E-Mail
-- ---------------------------------------------------------------------------

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null,
  email text not null,
  area text not null default 'privat' check (area in ('privat', 'beruflich')),
  provider text not null default 'custom',
  imap_host text not null,
  imap_port int not null default 993,
  imap_secure boolean not null default true,
  smtp_host text,
  smtp_port int default 465,
  smtp_secure boolean not null default true,
  username text not null,
  folder text not null default 'INBOX',
  trash_folder text,
  sent_folder text,
  uid_validity bigint,
  last_uid bigint not null default 0,
  last_sync_at timestamptz,
  last_error text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index mail_accounts_user_idx on public.mail_accounts (user_id);

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.mail_accounts (id) on delete cascade,
  folder text not null default 'INBOX',
  uid bigint not null,
  uid_validity bigint not null default 0,
  message_id text,
  in_reply_to text,
  references_header text,
  from_name text,
  from_email text,
  to_list text,
  cc_list text,
  reply_to text,
  subject text,
  sent_at timestamptz,
  snippet text,
  body_text text,
  has_attachments boolean not null default false,
  attachment_names text[] not null default '{}',
  is_read boolean not null default false,
  is_answered boolean not null default false,
  is_bulk boolean not null default false,
  list_unsubscribe text,
  unsubscribe_one_click boolean not null default false,
  area text check (area in ('privat', 'beruflich')),
  category text,
  priority int not null default 1 check (priority between 0 and 3),
  needs_reply boolean not null default false,
  ai_summary text,
  ai_action text,
  ai_events jsonb not null default '[]'::jsonb,
  ai_tasks jsonb not null default '[]'::jsonb,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'done', 'skipped', 'error')),
  ai_error text,
  status text not null default 'neu' check (status in ('neu', 'gelesen', 'erledigt', 'archiviert', 'geloescht')),
  deleted_on_server boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, folder, uid_validity, uid)
);

create index emails_user_status_idx on public.emails (user_id, status, sent_at desc);
create index emails_ai_pending_idx on public.emails (ai_status) where ai_status = 'pending';

-- ---------------------------------------------------------------------------
-- WhatsApp-Chats (aus Export importiert)
-- ---------------------------------------------------------------------------

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  area text not null default 'privat' check (area in ('privat', 'beruflich')),
  participants text[] not null default '{}',
  message_count int not null default 0,
  last_message_at timestamptz,
  last_import_at timestamptz,
  summary text,
  key_points jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  todos jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  reply_suggestion text,
  summarized_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  sent_at timestamptz not null,
  author text not null,
  body text not null,
  hash text not null,
  unique (chat_id, hash)
);

create index chat_messages_chat_idx on public.chat_messages (chat_id, sent_at);

-- ---------------------------------------------------------------------------
-- KI-Verbrauch (für die Kostenübersicht)
-- ---------------------------------------------------------------------------

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0
);

create index ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: jede Person sieht nur ihre eigenen Daten
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'calendar_connections', 'events', 'tasks', 'chores', 'workouts', 'workout_logs',
    'recipes', 'meal_plan', 'shopping_items', 'mail_accounts', 'emails', 'chats', 'chat_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "Eigene Daten" on public.%I for all to authenticated '
      || 'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

alter table public.ai_usage enable row level security;
create policy "Eigene Daten lesen" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Tresor (Supabase Vault) für Passwörter und API-Schlüssel.
-- Die App kann Geheimnisse nur schreiben/löschen, lesen dürfen sie nur die
-- Server-Funktionen (service_role).
-- Namen: mail:<konto-id>, cal:<verbindungs-id>, ai:<nutzer-id>
-- ---------------------------------------------------------------------------

create or replace function public.owns_secret_ref(p_kind text, p_ref uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  if p_kind = 'mail' then
    return exists (select 1 from public.mail_accounts where id = p_ref and user_id = v_uid);
  elsif p_kind = 'cal' then
    return exists (select 1 from public.calendar_connections where id = p_ref and user_id = v_uid);
  elsif p_kind = 'ai' then
    return p_ref = v_uid;
  end if;
  return false;
end;
$$;

create or replace function public.set_secret(p_kind text, p_ref uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := p_kind || ':' || p_ref::text;
  v_id uuid;
begin
  if not public.owns_secret_ref(p_kind, p_ref) then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Leeres Geheimnis';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_secret, v_name, 'Manager');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

create or replace function public.has_secret(p_kind text, p_ref uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.owns_secret_ref(p_kind, p_ref) then
    return false;
  end if;
  return exists (select 1 from vault.secrets where name = p_kind || ':' || p_ref::text);
end;
$$;

create or replace function public.delete_secret(p_kind text, p_ref uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.owns_secret_ref(p_kind, p_ref) then
    raise exception 'Kein Zugriff' using errcode = '42501';
  end if;
  delete from vault.secrets where name = p_kind || ':' || p_ref::text;
end;
$$;

-- Nur für Server-Funktionen
create or replace function public.admin_set_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name !~ '^(mail|cal|ai):[0-9a-f-]{36}$' then
    raise exception 'Ungültiger Name für ein Geheimnis';
  end if;
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'Leeres Geheimnis';
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_secret, p_name, 'Manager');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

create or replace function public.read_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

create or replace function public.check_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'cron_secret' and decrypted_secret = p_secret
  );
$$;

revoke execute on function public.owns_secret_ref(text, uuid) from public, anon;
revoke execute on function public.set_secret(text, uuid, text) from public, anon;
revoke execute on function public.has_secret(text, uuid) from public, anon;
revoke execute on function public.delete_secret(text, uuid) from public, anon;
grant execute on function public.owns_secret_ref(text, uuid) to authenticated;
grant execute on function public.set_secret(text, uuid, text) to authenticated;
grant execute on function public.has_secret(text, uuid) to authenticated;
grant execute on function public.delete_secret(text, uuid) to authenticated;

revoke execute on function public.admin_set_secret(text, text) from public, anon, authenticated;
grant execute on function public.admin_set_secret(text, text) to service_role;
revoke execute on function public.read_secret(text) from public, anon, authenticated;
revoke execute on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.read_secret(text) to service_role;
grant execute on function public.check_cron_secret(text) to service_role;

-- Geheimnisse beim Löschen eines Kontos mit entfernen
create or replace function public.drop_linked_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = tg_argv[0] || ':' || old.id::text;
  return old;
end;
$$;

revoke execute on function public.drop_linked_secret() from public, anon, authenticated;

create trigger mail_accounts_drop_secret after delete on public.mail_accounts
  for each row execute function public.drop_linked_secret('mail');
create trigger calendar_connections_drop_secret after delete on public.calendar_connections
  for each row execute function public.drop_linked_secret('cal');

-- ---------------------------------------------------------------------------
-- Registrierung: nur ein Konto (die Besitzerin) darf existieren, und es
-- entsteht nur über die Funktion "register" mit dem Einrichtungscode.
-- ---------------------------------------------------------------------------

-- Genau eine Zeile erlaubt: schützt auch vor zwei gleichzeitigen Registrierungen.
create table public.owner_lock (
  id int primary key default 1 check (id = 1),
  user_id uuid not null references auth.users (id) on delete cascade deferrable initially deferred
);

alter table public.owner_lock enable row level security;

-- Einmal-Tickets der Funktion "register". Konten ohne Ticket (z. B. über die
-- öffentliche Auth-Registrierung) werden abgewiesen.
create table public.registration_tickets (
  nonce text primary key,
  created_at timestamptz not null default now()
);

alter table public.registration_tickets enable row level security;
revoke all on public.registration_tickets from anon, authenticated;

-- Einrichtungscode für die erste Registrierung. Er steht nur im Tresor:
--   select decrypted_secret from vault.decrypted_secrets where name = 'setup_code';
do $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  v_code text := '';
  v_pos int;
begin
  if exists (select 1 from vault.secrets where name = 'setup_code') then
    return;
  end if;
  -- Bytes 6 und 8 einer UUID enthalten feste Versionsbits; die ersten sechs sind rein zufällig.
  foreach v_pos in array array[0, 1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21] loop
    v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, v_pos) % 32, 1);
    if length(v_code) in (4, 9) then
      v_code := v_code || '-';
    end if;
  end loop;
  perform vault.create_secret(v_code, 'setup_code', 'Manager: Einrichtungscode für die erste Registrierung');
end;
$$;

create or replace function public.enforce_single_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.registration_tickets
  where nonce = new.raw_user_meta_data ->> 'registration_nonce'
    and created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'Registrierung nur über die App möglich.';
  end if;
  if exists (select 1 from auth.users) then
    raise exception 'Registrierung geschlossen: Diese App hat bereits ein Konto.';
  end if;
  begin
    insert into public.owner_lock (id, user_id) values (1, new.id);
  exception when unique_violation then
    raise exception 'Registrierung geschlossen: Diese App hat bereits ein Konto.';
  end;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.enforce_single_owner() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger enforce_single_owner before insert on auth.users
  for each row execute function public.enforce_single_owner();
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Die App fragt vor der Registrierung, ob schon ein Konto existiert.
create or replace function public.owner_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users);
$$;

grant execute on function public.owner_exists() to anon, authenticated;
