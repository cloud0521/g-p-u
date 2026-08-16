import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import './owner.css'

const SESSION_KEY = 'wedding-owner-session'

async function invokeOwner(body) {
  const { data, error } = await supabase.functions.invoke('manage-event-photos', { body })
  if (error || data?.error) {
    const failure = new Error(data?.error || error?.message || 'Request failed')
    failure.status = error?.context?.status
    throw failure
  }
  return data
}

function OwnerSignIn({ eventCode, onSignedIn }) {
  const [code, setCode] = useState(eventCode || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await invokeOwner({ action: 'login', event_code: code, password })
      const ownerSession = { token: data.session_token, event: data.event, expiresAt: data.expires_at }
      localStorage.setItem(SESSION_KEY, JSON.stringify(ownerSession))
      onSignedIn(ownerSession)
    } catch (signInError) {
      setError(signInError.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="owner-auth-shell"><section className="owner-auth-card">
    <span className="owner-kicker">PRIVATE COLLECTION</span><div className="owner-mark">♡</div>
    <h1>Wedding Memories</h1>
    <form onSubmit={submit} className="owner-auth-form">
      <p>Enter the private details provided to the event owner.</p>
      <label htmlFor="owner-code">Event code</label>
      <input id="owner-code" required value={code} disabled={Boolean(eventCode)} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      <label htmlFor="owner-password">Owner password</label>
      <input id="owner-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="owner-error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'OPENING…' : 'OPEN PRIVATE COLLECTION'}</button>
    </form>
  </section></main>
}

export default function OwnerPortal() {
  const { eventCode } = useParams()
  const [ownerSession, setOwnerSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
  })
  const [eventData, setEventData] = useState(null)
  const [photos, setPhotos] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [busyPhoto, setBusyPhoto] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [error, setError] = useState('')

  const requestedCode = eventCode?.toUpperCase()
  const sessionMatchesRoute = ownerSession && (!requestedCode || ownerSession.event.event_code.toUpperCase() === requestedCode)
  const authBody = ownerSession ? { event_id: ownerSession.event.id, session_token: ownerSession.token } : {}

  useEffect(() => {
    if (!sessionMatchesRoute) return
    async function loadPhotos() {
      setLoading(true); setError('')
      try {
        const data = await invokeOwner({ action: 'list', event_id: ownerSession.event.id, session_token: ownerSession.token })
        setEventData(data.event); setPhotos(data.photos)
      } catch (loadError) {
        setError(loadError.message)
        if (/expired|sign in/i.test(loadError.message)) { localStorage.removeItem(SESSION_KEY); setOwnerSession(null) }
      } finally { setLoading(false) }
    }
    loadPhotos()
  }, [ownerSession, sessionMatchesRoute])

  const visiblePhotos = useMemo(() => filter === 'all' ? photos : photos.filter((p) => p.status === filter), [filter, photos])
  const counts = useMemo(() => ({ all: photos.length, pending: photos.filter((p) => p.status === 'pending').length,
    approved: photos.filter((p) => p.status === 'approved').length, hidden: photos.filter((p) => p.status === 'hidden').length }), [photos])

  async function updateStatus(photoId, status) {
    setBusyPhoto(photoId)
    try { await invokeOwner({ ...authBody, action: 'status', photo_id: photoId, status }); setPhotos((all) => all.map((p) => p.id === photoId ? { ...p, status } : p)) }
    catch (e) { setError(e.message) } finally { setBusyPhoto('') }
  }
  async function deletePhoto(photoId) {
    if (!window.confirm('Permanently delete this photo? This cannot be undone.')) return
    setBusyPhoto(photoId)
    try { await invokeOwner({ ...authBody, action: 'delete', photo_id: photoId }); setPhotos((all) => all.filter((p) => p.id !== photoId)) }
    catch (e) { setError(e.message) } finally { setBusyPhoto('') }
  }
  async function downloadPhoto(photo) {
    setBusyPhoto(photo.id)
    try { const data = await invokeOwner({ ...authBody, action: 'download', photo_id: photo.id }); const a = document.createElement('a'); a.href = data.signed_url; a.click() }
    catch (e) { setError(e.message) } finally { setBusyPhoto('') }
  }
  async function downloadAll() {
    setDownloadingAll(true); setError('')
    try {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip()
      await Promise.all(visiblePhotos.map(async (photo, i) => { if (!photo.signed_url) return; const r = await fetch(photo.signed_url); if (!r.ok) throw new Error('A photo could not be downloaded'); zip.file(`${String(i + 1).padStart(3, '0')}-${photo.id}.webp`, await r.blob()) }))
      const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${eventData.event_code}-wedding-photos.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { setError(e.message) } finally { setDownloadingAll(false) }
  }
  async function signOut() {
    try { if (ownerSession) await invokeOwner({ ...authBody, action: 'logout' }) } catch { /* local logout still succeeds */ }
    localStorage.removeItem(SESSION_KEY); setOwnerSession(null); setPhotos([]); setEventData(null)
  }

  if (!sessionMatchesRoute) return <OwnerSignIn eventCode={eventCode} onSignedIn={setOwnerSession} />
  return <main className="owner-dashboard">
    <header className="owner-header"><div><span className="owner-kicker">PRIVATE COLLECTION</span><h1>{eventData?.couple_names || ownerSession.event.couple_names}</h1></div><button className="owner-secondary" onClick={signOut}>Sign out</button></header>
    <section className="owner-stats" aria-label="Photo summary">{Object.entries(counts).map(([name, count]) => <button key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}><strong>{count}</strong><span>{name}</span></button>)}</section>
    <div className="owner-toolbar"><p>{visiblePhotos.length} {filter === 'all' ? 'photos' : filter}</p><button onClick={downloadAll} disabled={!visiblePhotos.length || downloadingAll}>{downloadingAll ? 'PREPARING ZIP…' : 'DOWNLOAD ALL'}</button></div>
    {error && <p className="owner-error owner-banner" role="alert">{error}</p>}
    {loading ? <p className="owner-loading">Gathering your memories…</p> : <section className="owner-photo-grid">
      {visiblePhotos.map((photo) => <article className="owner-photo" key={photo.id}>{photo.signed_url ? <img src={photo.signed_url} alt={`Shared by ${photo.guest_name || 'a guest'}`} loading="lazy" /> : <div className="owner-photo-missing">Preview unavailable</div>}<div className="owner-photo-body"><div className="owner-photo-meta"><strong>{photo.guest_name || 'Anonymous guest'}</strong><span>{new Date(photo.created_at).toLocaleString()}</span></div>{photo.message && <p>“{photo.message}”</p>}<div className="owner-photo-actions"><select value={photo.status} disabled={busyPhoto === photo.id} onChange={(e) => updateStatus(photo.id, e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="hidden">Hidden</option></select><button disabled={busyPhoto === photo.id} onClick={() => downloadPhoto(photo)}>Download</button><button className="owner-danger" disabled={busyPhoto === photo.id} onClick={() => deletePhoto(photo.id)}>Delete</button></div></div></article>)}
      {!visiblePhotos.length && <div className="owner-empty">No {filter === 'all' ? '' : `${filter} `}photos yet.</div>}
    </section>}
  </main>
}
