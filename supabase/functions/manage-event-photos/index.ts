import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const headers = { ...corsHeaders, 'Content-Type': 'application/json' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Please sign in' }, 401)

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anonClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '')
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token)
    if (userError || !user) return json({ error: 'Your session has expired' }, 401)

    const body = await req.json()
    const { event_id, action = 'list' } = body
    if (!event_id || !UUID_PATTERN.test(event_id)) return json({ error: 'A valid event is required' }, 400)

    const { data: ownership } = await admin.from('event_owners').select('event_id')
      .eq('event_id', event_id).eq('user_id', user.id).maybeSingle()
    if (!ownership) return json({ error: 'You do not have access to this event' }, 403)

    if (action === 'list') {
      const { data: event } = await admin.from('events')
        .select('id, event_code, couple_names, wedding_date, upload_enabled')
        .eq('id', event_id).single()
      const { data: photos, error } = await admin.from('guest_photos')
        .select('id, storage_path, guest_name, message, status, created_at')
        .eq('event_id', event_id).neq('status', 'uploading').order('created_at', { ascending: false })
      if (error) return json({ error: 'Unable to load photos' }, 500)

      const signedPhotos = await Promise.all((photos ?? []).map(async (photo) => {
        const { data } = await admin.storage.from('wedding-photos')
          .createSignedUrl(photo.storage_path, 3600)
        return { ...photo, signed_url: data?.signedUrl ?? null }
      }))
      return json({ event, photos: signedPhotos })
    }

    const { photo_id } = body
    if (!photo_id || !UUID_PATTERN.test(photo_id)) return json({ error: 'A valid photo is required' }, 400)
    const { data: photo } = await admin.from('guest_photos').select('id, storage_path')
      .eq('id', photo_id).eq('event_id', event_id).single()
    if (!photo) return json({ error: 'Photo not found' }, 404)

    if (action === 'status') {
      const allowed = ['pending', 'approved', 'hidden']
      if (!allowed.includes(body.status)) return json({ error: 'Invalid photo status' }, 400)
      const { error } = await admin.from('guest_photos').update({ status: body.status }).eq('id', photo.id)
      if (error) return json({ error: 'Unable to update photo' }, 500)
      return json({ updated: true })
    }

    if (action === 'delete') {
      const { error: storageError } = await admin.storage.from('wedding-photos').remove([photo.storage_path])
      if (storageError) return json({ error: 'Unable to remove the stored photo' }, 500)
      const { error: dbError } = await admin.from('guest_photos').delete().eq('id', photo.id)
      if (dbError) return json({ error: 'Unable to remove photo metadata' }, 500)
      return json({ deleted: true })
    }

    if (action === 'download') {
      const { data, error } = await admin.storage.from('wedding-photos')
        .createSignedUrl(photo.storage_path, 120, { download: `${photo.id}.webp` })
      if (error || !data) return json({ error: 'Unable to prepare download' }, 500)
      return json({ signed_url: data.signedUrl })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error(err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
