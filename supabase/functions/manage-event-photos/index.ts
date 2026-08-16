import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const headers = { ...corsHeaders, 'Content-Type': 'application/json' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const enc = new TextEncoder()
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers })
const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))) }
function secureEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const body = await req.json()
    const { action = 'list' } = body

    if (action === 'login') {
      const eventCode = String(body.event_code ?? '').trim().toUpperCase()
      const password = String(body.password ?? '')
      if (!eventCode || !password) return json({ error: 'Event code and password are required' }, 400)
      const { data: event } = await admin.from('events').select('id, event_code, couple_names')
        .eq('event_code', eventCode).maybeSingle()
      if (!event) return json({ error: 'Invalid event code or password' }, 401)

      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
      const clientHash = await sha256(clientIp)
      const { data: attempt } = await admin.from('event_owner_login_attempts').select('*')
        .eq('event_id', event.id).eq('client_hash', clientHash).maybeSingle()
      if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
        return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429)
      }

      const { data: credential } = await admin.from('event_owner_credentials')
        .select('password_salt, password_hash').eq('event_id', event.id).maybeSingle()
      const candidate = credential ? await sha256(credential.password_salt + password) : ''
      if (!credential || !secureEqual(candidate, credential.password_hash)) {
        const recent = attempt && Date.now() - new Date(attempt.window_started).getTime() < 15 * 60 * 1000
        const failures = recent ? attempt.failures + 1 : 1
        await admin.from('event_owner_login_attempts').upsert({ event_id: event.id, client_hash: clientHash, failures,
          window_started: recent ? attempt.window_started : new Date().toISOString(),
          locked_until: failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null })
        return json({ error: failures >= 5 ? 'Too many attempts. Please wait 15 minutes and try again.' : 'Invalid event code or password' }, failures >= 5 ? 429 : 401)
      }

      await admin.from('event_owner_login_attempts').delete().eq('event_id', event.id).eq('client_hash', clientHash)
      const rawToken = hex(crypto.getRandomValues(new Uint8Array(32)))
      const tokenHash = await sha256(rawToken)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await admin.from('event_owner_sessions').insert({ token_hash: tokenHash, event_id: event.id, expires_at: expiresAt })
      return json({ session_token: rawToken, event, expires_at: expiresAt })
    }

    const eventId = String(body.event_id ?? '')
    const sessionToken = String(body.session_token ?? '')
    if (!UUID_PATTERN.test(eventId) || !sessionToken) return json({ error: 'Please sign in' }, 401)
    const tokenHash = await sha256(sessionToken)
    const { data: ownerSession } = await admin.from('event_owner_sessions').select('event_id, expires_at')
      .eq('token_hash', tokenHash).eq('event_id', eventId).maybeSingle()
    if (!ownerSession || new Date(ownerSession.expires_at) <= new Date()) {
      if (ownerSession) await admin.from('event_owner_sessions').delete().eq('token_hash', tokenHash)
      return json({ error: 'Your owner session has expired' }, 401)
    }
    if (action === 'logout') {
      await admin.from('event_owner_sessions').delete().eq('token_hash', tokenHash)
      return json({ logged_out: true })
    }

    if (action === 'list') {
      const { data: event } = await admin.from('events').select('id, event_code, couple_names, wedding_date, upload_enabled').eq('id', eventId).single()
      const { data: photos, error } = await admin.from('guest_photos').select('id, storage_path, guest_name, message, status, created_at')
        .eq('event_id', eventId).neq('status', 'uploading').order('created_at', { ascending: false })
      if (error) return json({ error: 'Unable to load photos' }, 500)
      const signedPhotos = await Promise.all((photos ?? []).map(async (photo) => {
        const { data } = await admin.storage.from('wedding-photos').createSignedUrl(photo.storage_path, 3600)
        return { ...photo, signed_url: data?.signedUrl ?? null }
      }))
      return json({ event, photos: signedPhotos })
    }

    const photoId = String(body.photo_id ?? '')
    if (!UUID_PATTERN.test(photoId)) return json({ error: 'A valid photo is required' }, 400)
    const { data: photo } = await admin.from('guest_photos').select('id, storage_path').eq('id', photoId).eq('event_id', eventId).single()
    if (!photo) return json({ error: 'Photo not found' }, 404)
    if (action === 'status') {
      if (!['pending', 'approved', 'hidden'].includes(body.status)) return json({ error: 'Invalid status' }, 400)
      const { error } = await admin.from('guest_photos').update({ status: body.status }).eq('id', photo.id)
      return error ? json({ error: 'Unable to update photo' }, 500) : json({ updated: true })
    }
    if (action === 'delete') {
      const { error } = await admin.storage.from('wedding-photos').remove([photo.storage_path])
      if (error) return json({ error: 'Unable to remove stored photo' }, 500)
      await admin.from('guest_photos').delete().eq('id', photo.id)
      return json({ deleted: true })
    }
    if (action === 'download') {
      const { data, error } = await admin.storage.from('wedding-photos').createSignedUrl(photo.storage_path, 120, { download: `${photo.id}.webp` })
      return error || !data ? json({ error: 'Unable to prepare download' }, 500) : json({ signed_url: data.signedUrl })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
