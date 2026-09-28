-- Supabase-spezifische Einrichtung: Realtime, regelmäßige Abrufe (pg_cron + pg_net).
-- Die Projekt-URL muss einmalig im Tresor hinterlegt werden (siehe README):
--   select vault.create_secret('https://<projekt>.supabase.co', 'project_url');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.emails, public.shopping_items, public.events, public.tasks;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net nicht verfügbar – Zeitpläne werden übersprungen';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Manager: Zeitplan-Aufrufe');
  end if;

  execute $fn$
    create or replace function public.invoke_function(p_name text, p_body jsonb default '{}'::jsonb)
    returns bigint
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_url text;
      v_secret text;
      v_id bigint;
    begin
      select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_url is null or v_secret is null then
        return null;
      end if;
      select net.http_post(
        url := v_url || '/functions/v1/' || p_name,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := p_body,
        timeout_milliseconds := 300000
      ) into v_id;
      return v_id;
    end;
    $body$
  $fn$;

  revoke execute on function public.invoke_function(text, jsonb) from public, anon, authenticated;

  perform cron.schedule('manager-mail-sync', '*/5 * * * *',
    $job$ select public.invoke_function('mail-sync', '{"source":"cron"}'::jsonb) $job$);
  perform cron.schedule('manager-calendar-sync', '*/15 * * * *',
    $job$ select public.invoke_function('calendar-sync', '{"source":"cron"}'::jsonb) $job$);
  perform cron.schedule('manager-cleanup', '17 3 * * *',
    $job$
      delete from public.emails
      where status in ('geloescht', 'archiviert', 'erledigt') and created_at < now() - interval '90 days';
      delete from net._http_response where created < now() - interval '2 days';
    $job$);
end;
$$;
