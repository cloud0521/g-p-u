-- Keep the demo wedding available in every environment. The upsert makes this
-- safe to run again and restores the intended demo details if they drift.
insert into public.events (
  event_code,
  couple_names,
  wedding_date,
  upload_enabled
)
values (
  'DEMO2026',
  'Sarah & Michael',
  '2026-10-15',
  true
)
on conflict (event_code) do update
set
  couple_names = excluded.couple_names,
  wedding_date = excluded.wedding_date,
  upload_enabled = excluded.upload_enabled;

-- To add another wedding, copy the INSERT above into a new timestamped
-- migration and replace the event code, names, and date.
