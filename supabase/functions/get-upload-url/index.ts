import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const MAX_PHOTOS_PER_DEVICE = 5
const RESERVATION_MAX_AGE_MS = 15 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    const body = await req.json()
    const { event_code, device_id, action = 'upload' } = body

    if (!event_code || !device_id || !UUID_PATTERN.test(device_id)) {
      return json({ error: 'A valid event code and device ID are required' }, 400)
    }

    const { data: event, error: eventError } = await supabaseClient
      .from('events').select('id, upload_enabled')
      .eq('event_code', String(event_code).toUpperCase()).single()
    if (eventError || !event) return json({ error: 'Event not found' }, 404)
    if (!event.upload_enabled) return json({ error: 'Uploads are disabled for this event' }, 403)

    if (action === 'complete' || action === 'cancel') {
      const { photo_id } = body
      if (!photo_id || !UUID_PATTERN.test(photo_id)) return json({ error: 'A valid photo ID is required' }, 400)
      const { data: photo } = await supabaseClient.from('guest_photos')
        .select('id, storage_path').eq('id', photo_id).eq('event_id', event.id)
        .eq('device_id', device_id).single()
      if (!photo) return json({ error: 'Upload reservation not found' }, 404)

      if (action === 'cancel') {
        await supabaseClient.storage.from('wedding-photos').remove([photo.storage_path])
        await supabaseClient.from('guest_photos').delete().eq('id', photo.id)
        return json({ cancelled: true })
      }

      const { error: updateError } = await supabaseClient.from('guest_photos')
        .update({ status: 'pending' }).eq('id', photo.id).eq('status', 'uploading')
      if (updateError) return json({ error: 'Unable to finalize photo metadata' }, 500)
      return json({ completed: true })
    }

    const { data: devicePhotos, error: countError } = await supabaseClient
      .from('guest_photos').select('id, storage_path, status, created_at')
      .eq('event_id', event.id).eq('device_id', device_id)
    if (countError) return json({ error: 'Unable to check this device upload allowance' }, 500)

    const stale = (devicePhotos ?? []).filter((photo) =>
      photo.status === 'uploading' && Date.now() - new Date(photo.created_at).getTime() > RESERVATION_MAX_AGE_MS
    )
    if (stale.length) {
      await supabaseClient.storage.from('wedding-photos').remove(stale.map((photo) => photo.storage_path))
      await supabaseClient.from('guest_photos').delete().in('id', stale.map((photo) => photo.id))
    }

    const used = (devicePhotos ?? []).length - stale.length
    const remaining = Math.max(0, MAX_PHOTOS_PER_DEVICE - used)
    if (action === 'quota') return json({ uploaded_count: used, remaining, limit: MAX_PHOTOS_PER_DEVICE })

    const { file_name, content_type, guest_name, message } = body
    if (!file_name || content_type !== 'image/webp') {
      return json({ error: 'Uploads must be processed WebP images' }, 400)
    }
    if (remaining === 0) return json({ error: 'This phone has already shared 5 photos for this wedding.' }, 429)

    const filePath = `${event.id}/${crypto.randomUUID()}.webp`
    const { data: reservation, error: reservationError } = await supabaseClient
      .rpc('reserve_guest_photo_upload', {
        p_event_id: event.id, p_device_id: device_id, p_storage_path: filePath,
        p_guest_name: guest_name ?? null, p_message: message ?? null,
      }).single()
    if (reservationError || !reservation) {
      if (reservationError?.message?.includes('DEVICE_PHOTO_LIMIT_REACHED')) {
        return json({ error: 'This phone has already shared 5 photos for this wedding.' }, 429)
      }
      console.error('Reservation error:', reservationError)
      return json({ error: 'Unable to reserve an upload slot' }, 500)
    }

    const { data: signedData, error: signedError } = await supabaseClient.storage
      .from('wedding-photos').createSignedUploadUrl(filePath)
    if (signedError || !signedData) {
      await supabaseClient.from('guest_photos').delete().eq('id', reservation.photo_id)
      return json({ error: signedError?.message || 'Failed to create signed URL' }, 500)
    }

    return json({ signedUrl: signedData.signedUrl, photo_id: reservation.photo_id,
      uploaded_count: reservation.previously_used,
      remaining: MAX_PHOTOS_PER_DEVICE - Number(reservation.previously_used) })
  } catch (err) {
    console.error('Unexpected function error:', err)
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
