-- Event and owner access are kept together. The plaintext password is not stored.
insert into public.events (event_code, couple_names, wedding_date, upload_enabled)
values ('C&C2027', 'Cloud & Cyrin', '2026-12-20', true)
on conflict (event_code) do update set
  couple_names = excluded.couple_names,
  wedding_date = excluded.wedding_date,
  upload_enabled = excluded.upload_enabled;

insert into public.event_owner_credentials (event_id, password_salt, password_hash)
select id, '1c3ffa5ba557ce6f53b81d98113ce6c8', 'b1e7d34053a039be27fcbb8e45f2bfecc02abc056417827d4f40a51997d7d31f'
from public.events where event_code = 'C&C2027'
on conflict (event_id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  updated_at = now();
