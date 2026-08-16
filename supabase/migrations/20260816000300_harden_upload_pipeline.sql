create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(), event_code text not null unique,
  couple_names text not null, wedding_date date, upload_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  storage_path text not null unique, guest_name text, message text,
  status text not null default 'pending', device_id uuid,
  created_at timestamptz not null default now()
);

alter table public.events add column if not exists wedding_date date;
alter table public.events add column if not exists upload_enabled boolean not null default true;
alter table public.events add column if not exists created_at timestamptz not null default now();
alter table public.guest_photos add column if not exists device_id uuid;
alter table public.guest_photos add column if not exists created_at timestamptz not null default now();
alter table public.events enable row level security;
alter table public.guest_photos enable row level security;

drop policy if exists "Anyone can view open events" on public.events;
create policy "Anyone can view open events" on public.events
for select to anon, authenticated using (upload_enabled = true);

-- Photo metadata is created only by the service-role Edge Function.
drop policy if exists "Guests can submit photos to open events" on public.guest_photos;

create or replace function public.reserve_guest_photo_upload(
  p_event_id uuid, p_device_id uuid, p_storage_path text,
  p_guest_name text default null, p_message text default null
)
returns table(photo_id uuid, previously_used bigint)
language plpgsql security definer set search_path = ''
as $$
declare v_photo_id uuid; v_used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_device_id::text, 0));
  select count(*) into v_used from public.guest_photos
  where event_id = p_event_id and device_id = p_device_id
    and (status <> 'uploading' or created_at > now() - interval '15 minutes');
  if v_used >= 5 then
    raise exception using errcode = 'P0001', message = 'DEVICE_PHOTO_LIMIT_REACHED';
  end if;
  insert into public.guest_photos (event_id, storage_path, guest_name, message, status, device_id)
  values (p_event_id, p_storage_path, nullif(left(trim(p_guest_name), 120), ''),
    nullif(left(trim(p_message), 500), ''), 'uploading', p_device_id)
  returning id into v_photo_id;
  return query select v_photo_id, v_used;
end;
$$;

revoke all on function public.reserve_guest_photo_upload(uuid, uuid, text, text, text) from public;
grant execute on function public.reserve_guest_photo_upload(uuid, uuid, text, text, text) to service_role;
