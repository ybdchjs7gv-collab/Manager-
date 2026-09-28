-- Prüft Row Level Security, Tresor-Funktionen und die Einzelnutzer-Regel.
-- Wird von scripts/test-db.sh gegen ein lokales Postgres ausgeführt.
\set ON_ERROR_STOP on

do $$ begin raise notice 'Test: erstes Konto anlegen'; end $$;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');

do $$
begin
  assert (select count(*) from public.settings) = 1, 'settings-Zeile fehlt';
  assert public.owner_exists(), 'owner_exists sollte true sein';
  assert (select count(*) from public.owner_lock) = 1, 'owner_lock fehlt';
end $$;

-- Zweites Konto muss scheitern
do $$
begin
  begin
    insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'fremd@example.com');
    raise exception 'zweites Konto wurde nicht blockiert';
  exception when raise_exception then
    if sqlerrm like 'zweites Konto%' then raise; end if;
  end;
end $$;

-- Die Sperrtabelle allein verhindert ein zweites Konto (gleichzeitige Registrierung)
do $$
begin
  begin
    insert into public.owner_lock (id, user_id) values (1, '33333333-3333-3333-3333-333333333333');
    raise exception 'zweite Sperre akzeptiert';
  exception when unique_violation then null;
  end;
end $$;

-- Für den Isolationstest ein zweites Konto an der Regel vorbei anlegen
alter table auth.users disable trigger enforce_single_owner;
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'fremd@example.com');
alter table auth.users enable trigger enforce_single_owner;

-- Als Besitzerin Daten anlegen
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.tasks (title, area, priority, duration_min) values ('Steuererklärung', 'privat', 3, 120);
insert into public.events (title, start_at, end_at) values ('Zahnarzt', now(), now() + interval '1 hour');
insert into public.mail_accounts (label, email, imap_host, username) values ('T-Online', 'a@t-online.de', 'secureimap.t-online.de', 'a@t-online.de');
select public.set_secret('mail', (select id from public.mail_accounts limit 1), 'geheim');
select public.set_secret('ai', '11111111-1111-1111-1111-111111111111', 'sk-ant-test');

do $$
begin
  assert public.has_secret('mail', (select id from public.mail_accounts limit 1)), 'has_secret mail';
  assert public.has_secret('ai', '11111111-1111-1111-1111-111111111111'), 'has_secret ai';
  assert not public.has_secret('ai', '22222222-2222-2222-2222-222222222222'), 'fremdes ai-Geheimnis sichtbar';
end $$;

-- Lesen der Klartext-Geheimnisse muss verboten sein
do $$
begin
  begin
    perform public.read_secret('ai:11111111-1111-1111-1111-111111111111');
    raise exception 'read_secret war erlaubt';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_secret('ai', '22222222-2222-2222-2222-222222222222', 'x');
    raise exception 'fremdes Geheimnis setzbar';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_set_secret('ai:22222222-2222-2222-2222-222222222222', 'x');
    raise exception 'admin_set_secret war erlaubt';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Zweite Person sieht nichts
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
begin
  assert (select count(*) from public.tasks) = 0, 'fremde Aufgaben sichtbar';
  assert (select count(*) from public.events) = 0, 'fremde Termine sichtbar';
  assert (select count(*) from public.mail_accounts) = 0, 'fremde Konten sichtbar';
  assert (select count(*) from public.settings) = 1, 'eigene settings fehlen';
end $$;

-- Fremde user_id beim Einfügen muss scheitern
do $$
begin
  begin
    insert into public.tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'untergeschoben');
    raise exception 'fremde user_id akzeptiert';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Server-Funktion darf lesen
set role service_role;
do $$
begin
  assert public.read_secret('ai:11111111-1111-1111-1111-111111111111') = 'sk-ant-test', 'service_role liest nicht';
  assert not public.check_cron_secret('falsch'), 'cron_secret falsch akzeptiert';
  perform public.admin_set_secret('cal:33333333-3333-3333-3333-333333333333', 'kalender');
  assert public.read_secret('cal:33333333-3333-3333-3333-333333333333') = 'kalender', 'admin_set_secret';
  begin
    perform public.admin_set_secret('project_url', 'x');
    raise exception 'beliebiger Name akzeptiert';
  exception when raise_exception then
    if sqlerrm like 'beliebiger%' then raise; end if;
  end;
end $$;
reset role;

-- Konto löschen entfernt das Passwort aus dem Tresor
delete from public.mail_accounts;
do $$
begin
  assert (select count(*) from vault.secrets where name like 'mail:%') = 0, 'Passwort blieb im Tresor';
end $$;

do $$ begin raise notice 'Alle Datenbank-Tests bestanden'; end $$;
