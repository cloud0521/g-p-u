-- Event and owner access are kept together. The plaintext password is not stored.
insert into public.events (event_code, couple_names, wedding_date, upload_enabled)
values ('C&C2026', 'Cloud & Cyrin', '2026-12-20', true)
on conflict (event_code) do update set
  couple_names = excluded.couple_names,
  wedding_date = excluded.wedding_date,
  upload_enabled = excluded.upload_enabled;

insert into public.event_owner_credentials (event_id, password_salt, password_hash)
select id, '5177107948c732a2f8af5994ae769230', '30ad6f3ae0b5c9bf4df0246a8eacc91a7baa0d989dd886ba89774899cc45b783'
from public.events where event_code = 'C&C2026'
on conflict (event_id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  updated_at = now();
