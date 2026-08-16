import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, item, index, all) => {
  if (item.startsWith('--')) pairs.push([item.slice(2), all[index + 1]])
  return pairs
}, []))

const eventCode = String(args.code || '').trim().toUpperCase()
const coupleNames = String(args.couple || '').trim()
const weddingDate = String(args.date || '').trim()

if (!/^[A-Z0-9&-]{3,24}$/.test(eventCode) || !coupleNames || !/^\d{4}-\d{2}-\d{2}$/.test(weddingDate)) {
  console.error('Usage: npm run event:create -- --code "C&C2026" --couple "Cyrin & Cloud" --date 2026-12-19')
  process.exit(1)
}

const sql = (value) => value.replaceAll("'", "''")
const password = `Wed-${randomBytes(12).toString('base64url')}`
const salt = randomBytes(16).toString('hex')
const passwordHash = createHash('sha256').update(salt + password).digest('hex')
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const slug = eventCode.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const migrationPath = `supabase/migrations/${timestamp}_create_${slug}_event.sql`

const migration = `-- Event and owner access are kept together. The plaintext password is not stored.
insert into public.events (event_code, couple_names, wedding_date, upload_enabled)
values ('${sql(eventCode)}', '${sql(coupleNames)}', '${sql(weddingDate)}', true)
on conflict (event_code) do update set
  couple_names = excluded.couple_names,
  wedding_date = excluded.wedding_date,
  upload_enabled = excluded.upload_enabled;

insert into public.event_owner_credentials (event_id, password_salt, password_hash)
select id, '${salt}', '${passwordHash}'
from public.events where event_code = '${sql(eventCode)}'
on conflict (event_id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  updated_at = now();
`

mkdirSync('supabase/migrations', { recursive: true })
writeFileSync(migrationPath, migration, { flag: 'wx' })

console.log('\nSAVE THESE OWNER DETAILS NOW')
console.log(`Event code: ${eventCode}`)
console.log(`Owner password: ${password}`)
console.log(`Owner path: /photos/${encodeURIComponent(eventCode)}/owner`)
console.log(`Migration: ${migrationPath}\n`)

const push = spawnSync('npx', ['supabase', 'db', 'push', '--linked', '--include-all'], {
  stdio: 'inherit', shell: process.platform === 'win32',
})
if (push.status !== 0) {
  console.error('\nThe migration was created but could not be pushed. Keep the password above, fix the connection, then run npm run db:push.')
  process.exit(push.status || 1)
}
console.log('\nEvent and owner password are ready.')
