-- Minimale Nachbildung der Supabase-Umgebung, damit die Migrationen gegen ein
-- normales lokales Postgres getestet werden können (siehe scripts/test-db.sh).
-- NICHT auf Supabase ausführen.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists vault;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Tresor-Nachbildung (ohne echte Verschlüsselung)
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at
  from vault.secrets;

create or replace function vault.create_secret(
  new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null
)
returns uuid
language sql
as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description)
  returning id;
$$;

create or replace function vault.update_secret(
  secret_id uuid, new_secret text default null, new_name text default null,
  new_description text default null, new_key_id uuid default null
)
returns void
language sql
as $$
  update vault.secrets
  set secret = coalesce(new_secret, secret),
      name = coalesce(new_name, name),
      description = coalesce(new_description, description),
      updated_at = now()
  where id = secret_id;
$$;

-- Standardrechte wie bei Supabase
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
