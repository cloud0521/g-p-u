import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import './owner.css'

async function invokeOwner(body) {
  const { data, error } = await supabase.functions.invoke('manage-event-photos', { body })
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Request failed')
  return data
}

function OwnerSignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/owner` },
    })
    setBusy(false)
    if (signInError) setError(signInError.message)
    else setSent(true)
  }

  return (
    <main className="owner-auth-shell">
      <section className="owner-auth-card">
        <span className="owner-kicker">PRIVATE COLLECTION</span>
        <div className="owner-mark">♡</div>
        <h1>Wedding Memories</h1>
        {sent ? (
          <div className="owner-auth-message">
            <h2>Check your email</h2>
            <p>We sent a private sign-in link to {email}.</p>
            <button className="owner-link-button" onClick={() => setSent(false)}>Use another email</button>
          </div>
        ) : (
          <form onSubmit={submit} className="owner-auth-form">
            <p>Sign in with the email assigned to your wedding.</p>
            <label htmlFor="owner-email">Email address</label>
            <input id="owner-email" type="email" required autoComplete="email" value={email}
              onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            {error && <p className="owner-error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'SENDING…' : 'EMAIL MY PRIVATE LINK'}</button>
          </form>
        )}
      </section>
    </main>
  )
}

export default function OwnerPortal() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [eventIds, setEventIds] = useState([])
  const [activeEventId, setActiveEventId] = useState('')
  const [eventData, setEventData] = useState(null)
  const [photos, setPhotos] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [busyPhoto, setBusyPhoto] = useState('')
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    async function loadOwnership() {
      setLoading(true)
      const { data, error: ownerError } = await supabase.from('event_owners').select('event_id')
      if (ownerError) setError(ownerError.message)
      else {
        const ids = (data ?? []).map((row) => row.event_id)
        setEventIds(ids)
        setActiveEventId((current) => current || ids[0] || '')
      }
      setLoading(false)
    }
    loadOwnership()
  }, [session])

  useEffect(() => {
    if (!activeEventId) return
    async function loadPhotos() {
      setLoading(true)
      setError('')
      try {
        const data = await invokeOwner({ action: 'list', event_id: activeEventId })
        setEventData(data.event)
        setPhotos(data.photos)
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setLoading(false)
      }
    }
    loadPhotos()
  }, [activeEventId])

  const visiblePhotos = useMemo(() =>
    filter === 'all' ? photos : photos.filter((photo) => photo.status === filter), [filter, photos])
  const counts = useMemo(() => ({
    all: photos.length,
    pending: photos.filter((photo) => photo.status === 'pending').length,
    approved: photos.filter((photo) => photo.status === 'approved').length,
    hidden: photos.filter((photo) => photo.status === 'hidden').length,
  }), [photos])

  async function updateStatus(photoId, status) {
    setBusyPhoto(photoId)
    try {
      await invokeOwner({ action: 'status', event_id: activeEventId, photo_id: photoId, status })
      setPhotos((current) => current.map((photo) => photo.id === photoId ? { ...photo, status } : photo))
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusyPhoto('')
    }
  }

  async function deletePhoto(photoId) {
    if (!window.confirm('Permanently delete this photo? This cannot be undone.')) return
    setBusyPhoto(photoId)
    try {
      await invokeOwner({ action: 'delete', event_id: activeEventId, photo_id: photoId })
      setPhotos((current) => current.filter((photo) => photo.id !== photoId))
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusyPhoto('')
    }
  }

  async function downloadPhoto(photo) {
    setBusyPhoto(photo.id)
    try {
      const data = await invokeOwner({ action: 'download', event_id: activeEventId, photo_id: photo.id })
      const link = document.createElement('a')
      link.href = data.signed_url
      link.click()
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusyPhoto('')
    }
  }

  async function downloadAll() {
    setDownloadingAll(true)
    setError('')
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      await Promise.all(visiblePhotos.map(async (photo, index) => {
        if (!photo.signed_url) return
        const response = await fetch(photo.signed_url)
        if (!response.ok) throw new Error('One of the photos could not be downloaded')
        zip.file(`${String(index + 1).padStart(3, '0')}-${photo.id}.webp`, await response.blob())
      }))
      const blob = await zip.generateAsync({ type: 'blob' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${eventData.event_code}-wedding-photos.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (downloadError) {
      setError(downloadError.message)
    } finally {
      setDownloadingAll(false)
    }
  }

  if (!authReady) return <main className="owner-loading">Opening your private collection…</main>
  if (!session) return <OwnerSignIn />

  if (!loading && eventIds.length === 0) {
    return (
      <main className="owner-auth-shell">
        <section className="owner-auth-card">
          <span className="owner-kicker">SIGNED IN</span>
          <h1>Access awaiting assignment</h1>
          <p>Your account ({session.user.email}) is ready, but it has not been linked to a wedding yet.</p>
          <button onClick={() => supabase.auth.signOut()}>SIGN OUT</button>
        </section>
      </main>
    )
  }

  return (
    <main className="owner-dashboard">
      <header className="owner-header">
        <div><span className="owner-kicker">PRIVATE COLLECTION</span><h1>{eventData?.couple_names || 'Wedding Memories'}</h1></div>
        <div className="owner-header-actions">
          {eventIds.length > 1 && <select value={activeEventId} onChange={(event) => setActiveEventId(event.target.value)}>
            {eventIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>}
          <button className="owner-secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <section className="owner-stats" aria-label="Photo summary">
        {Object.entries(counts).map(([name, count]) => <button key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>
          <strong>{count}</strong><span>{name}</span>
        </button>)}
      </section>

      <div className="owner-toolbar">
        <p>{visiblePhotos.length} {filter === 'all' ? 'photos' : filter}</p>
        <button onClick={downloadAll} disabled={!visiblePhotos.length || downloadingAll}>
          {downloadingAll ? 'PREPARING ZIP…' : 'DOWNLOAD ALL'}
        </button>
      </div>
      {error && <p className="owner-error owner-banner" role="alert">{error}</p>}
      {loading ? <p className="owner-loading">Gathering your memories…</p> : (
        <section className="owner-photo-grid">
          {visiblePhotos.map((photo) => <article className="owner-photo" key={photo.id}>
            {photo.signed_url ? <img src={photo.signed_url} alt={`Shared by ${photo.guest_name || 'a guest'}`} loading="lazy" /> : <div className="owner-photo-missing">Preview unavailable</div>}
            <div className="owner-photo-body">
              <div className="owner-photo-meta"><strong>{photo.guest_name || 'Anonymous guest'}</strong><span>{new Date(photo.created_at).toLocaleString()}</span></div>
              {photo.message && <p>“{photo.message}”</p>}
              <div className="owner-photo-actions">
                <select value={photo.status} disabled={busyPhoto === photo.id} onChange={(event) => updateStatus(photo.id, event.target.value)}>
                  <option value="pending">Pending</option><option value="approved">Approved</option><option value="hidden">Hidden</option>
                </select>
                <button disabled={busyPhoto === photo.id} onClick={() => downloadPhoto(photo)}>Download</button>
                <button className="owner-danger" disabled={busyPhoto === photo.id} onClick={() => deletePhoto(photo.id)}>Delete</button>
              </div>
            </div>
          </article>)}
          {!visiblePhotos.length && <div className="owner-empty">No {filter === 'all' ? '' : `${filter} `}photos yet.</div>}
        </section>
      )}
    </main>
  )
}
