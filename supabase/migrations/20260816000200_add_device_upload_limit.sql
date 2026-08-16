alter table public.guest_photos
add column if not exists device_id uuid;

create index if not exists guest_photos_event_device_idx
on public.guest_photos (event_id, device_id)
where device_id is not null;

drop policy if exists "Guests can submit photos to open events" on public.guest_photos;
create policy "Guests can submit photos to open events"
on public.guest_photos
for insert
to anon, authenticated
with check (
  status = 'pending'
  and device_id is not null
  and exists (
    select 1
    from public.events
    where events.id = guest_photos.event_id
      and events.upload_enabled = true
  )
);
