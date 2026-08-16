alter table public.guest_photos enable row level security;

drop policy if exists "Guests can submit photos to open events" on public.guest_photos;
create policy "Guests can submit photos to open events"
on public.guest_photos
for insert
to anon, authenticated
with check (
  status = 'pending'
  and exists (
    select 1
    from public.events
    where events.id = guest_photos.event_id
      and events.upload_enabled = true
  )
);
