create table if not exists public.event_owners (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists event_owners_user_idx on public.event_owners(user_id);
alter table public.event_owners enable row level security;

drop policy if exists "Owners can view their event access" on public.event_owners;
create policy "Owners can view their event access"
on public.event_owners for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Owners can view their events" on public.events;
create policy "Owners can view their events"
on public.events for select to authenticated
using (
  exists (
    select 1 from public.event_owners
    where event_owners.event_id = events.id
      and event_owners.user_id = auth.uid()
  )
);

drop policy if exists "Owners can view event photos" on public.guest_photos;
create policy "Owners can view event photos"
on public.guest_photos for select to authenticated
using (
  exists (
    select 1 from public.event_owners
    where event_owners.event_id = guest_photos.event_id
      and event_owners.user_id = auth.uid()
  )
);

-- After the owner signs in once, link their Auth user to an event with:
-- insert into public.event_owners (event_id, user_id)
-- select e.id, u.id from public.events e cross join auth.users u
-- where e.event_code = 'DEMO2026' and lower(u.email) = lower('owner@example.com')
-- on conflict do nothing;
