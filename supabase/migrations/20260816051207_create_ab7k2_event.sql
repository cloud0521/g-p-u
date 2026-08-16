-- Event and owner access are kept together. The plaintext password is not stored.
insert into public.events (event_code, couple_names, wedding_date, upload_enabled)
values ('AB7K2', 'Bride & Groom', '2026-12-20', true)
on conflict (event_code) do update set
  couple_names = excluded.couple_names,
  wedding_date = excluded.wedding_date,
  upload_enabled = excluded.upload_enabled;

insert into public.event_owner_credentials (event_id, password_salt, password_hash)
select id, '6d51007845f7606e0d5a671f70ccfbee', '7a7ec13dab11fb5da4923166bcbe63e995777d67e147e6569379021e63b32a63'
from public.events where event_code = 'AB7K2'
on conflict (event_id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  updated_at = now();
