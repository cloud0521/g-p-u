import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'

const DEVICE_ID_KEY = 'wedding-photo-device-id'
const MAX_PHOTOS_PER_DEVICE = 5
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const SUPPORTED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i

function getDeviceId() {
  const existingId = localStorage.getItem(DEVICE_ID_KEY)
  if (existingId) return existingId

  const deviceId = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, deviceId)
  return deviceId
}

async function getFunctionError(fnData, fnError, fallback) {
  let detail = fnData?.error

  if (!detail && fnError?.context) {
    try {
      const errorBody = await fnError.context.json()
      detail = errorBody?.error
    } catch {
      // The function may return an empty or non-JSON error response.
    }
  }

  return detail || fnError?.message || fallback
}

// 1. Root component when no event code is provided
function HomeLanding() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Wedding Memories</h1>
        <p style={styles.subtitle}>Please scan the QR code provided at the wedding venue to share your photos.</p>
        <Link to="/photos/DEMO2026" style={styles.demoButton}>
          Test Demo Event (DEMO2026)
        </Link>
      </div>
    </div>
  )
}

// Browser-side image compression helper
async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.src = e.target.result
    }
    reader.onerror = reject

    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height
      const MAX_DIMENSION = 2048

      if (width > height) {
        if (width > MAX_DIMENSION) {
          height = Math.round((height * MAX_DIMENSION) / width)
          width = MAX_DIMENSION
        }
      } else {
        if (height > MAX_DIMENSION) {
          width = Math.round((width * MAX_DIMENSION) / height)
          height = MAX_DIMENSION
        }
      }

      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Canvas compression failed'))
            return
          }
          const originalNameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
          const compressedFile = new File([blob], `${originalNameWithoutExt}.webp`, {
            type: 'image/webp',
            lastModified: Date.now(),
          })
          resolve(compressedFile)
        },
        'image/webp',
        0.85
      )
    }

    img.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 2. Event Validation & Mobile Upload Page
function EventUploadPage() {
  const { eventCode } = useParams()
  const [loading, setLoading] = useState(true)
  const [eventData, setEventData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Upload progress & state
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Guest inputs & photo state
  const [guestName, setGuestName] = useState('')
  const [message, setMessage] = useState('')
  const [selectedPhotos, setSelectedPhotos] = useState([])
  const [deviceId] = useState(getDeviceId)
  const [uploadedCount, setUploadedCount] = useState(0)
  
  const fileInputRef = useRef(null)
  const MAX_FILE_SIZE_MB = 20
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

  useEffect(() => {
    async function validateEvent() {
      if (!eventCode) {
        setErrorMsg('No event code provided.')
        setLoading(false)
        return
      }

      try {
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('event_code', eventCode.toUpperCase())
          .single()

        if (error || !data) {
          setErrorMsg('This wedding event could not be found.')
        } else if (!data.upload_enabled) {
          setErrorMsg('Photo uploads for this wedding are currently closed.')
        } else {
          const { data: quotaData, error: quotaError } = await supabase.functions.invoke('get-upload-url', {
            body: { event_code: data.event_code, device_id: deviceId, action: 'quota' },
          })

          if (quotaError || typeof quotaData?.uploaded_count !== 'number') {
            throw new Error(await getFunctionError(quotaData, quotaError, 'Unable to check your photo allowance.'))
          }

          setUploadedCount(quotaData.uploaded_count)
          setEventData(data)
        }
      } catch (err) {
        setErrorMsg(err.message || 'An unexpected error occurred while loading the event.')
      } finally {
        setLoading(false)
      }
    }

    validateEvent()
  }, [deviceId, eventCode])

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    const pendingSelections = selectedPhotos.filter((photo) => photo.status !== 'success').length
    const availableSlots = MAX_PHOTOS_PER_DEVICE - uploadedCount - pendingSelections

    if (files.length > availableSlots) {
      alert(availableSlots > 0
        ? `You can choose ${availableSlots} more photo${availableSlots === 1 ? '' : 's'} on this phone.`
        : 'This phone has already reached its 5-photo limit.')
      e.target.value = null
      return
    }

    setIsProcessing(true)
    const validNewPhotos = []

    for (const file of files) {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) && !SUPPORTED_IMAGE_EXTENSIONS.test(file.name)) {
        alert(`"${file.name}" is not supported. Please choose a JPEG, PNG, WebP, HEIC, or HEIF photo.`)
        continue
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(`"${file.name}" exceeds the ${MAX_FILE_SIZE_MB}MB size limit and was skipped.`)
        continue
      }

      try {
        const compressedFile = await compressImage(file)
        validNewPhotos.push({
          id: crypto.randomUUID(),
          file: compressedFile,
          previewUrl: URL.createObjectURL(compressedFile),
          status: 'idle',
          errorMsg: null,
        })
      } catch (err) {
        console.error('Compression error:', err)
        alert(`Could not process "${file.name}". HEIC support varies by phone browser; try sharing it as JPEG if needed.`)
      }
    }

    if (validNewPhotos.length > 0) {
      setSelectedPhotos((prev) => [...prev, ...validNewPhotos])
    }
    
    setIsProcessing(false)
    e.target.value = null
  }

  const handleRemovePhoto = (id) => {
    setSelectedPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter((p) => p.id !== id)
    })
  }

  const uploadSinglePhoto = async (photo) => {
    const { data: fnData, error: fnError } = await supabase.functions.invoke('get-upload-url', {
      body: {
        event_code: eventData.event_code,
        file_name: photo.file.name,
        content_type: photo.file.type,
        device_id: deviceId,
        guest_name: guestName.trim() || null,
        message: message.trim() || null,
      },
    })

    if (fnError || !fnData?.signedUrl) {
      throw new Error(await getFunctionError(fnData, fnError, 'Failed to get secure upload authorization.'))
    }
    const photoId = fnData.photo_id

    try {
      const uploadRes = await fetch(fnData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': photo.file.type },
        body: photo.file,
      })

      if (!uploadRes.ok) {
        let detail = ''
        try {
          const errorBody = await uploadRes.json()
          detail = errorBody?.message || errorBody?.error || ''
        } catch {
          // Keep the friendly fallback when Storage does not return JSON.
        }
        throw new Error(detail ? `Storage upload failed: ${detail}` : 'Storage upload failed. Please try again.')
      }

      const { data: completeData, error: completeError } = await supabase.functions.invoke('get-upload-url', {
        body: {
          action: 'complete', event_code: eventData.event_code,
          device_id: deviceId, photo_id: photoId,
        },
      })
      if (completeError || !completeData?.completed) {
        throw new Error(await getFunctionError(completeData, completeError, 'Unable to finalize this photo.'))
      }
    } catch (error) {
      await supabase.functions.invoke('get-upload-url', {
        body: {
          action: 'cancel', event_code: eventData.event_code,
          device_id: deviceId, photo_id: photoId,
        },
      })
      throw error
    }

    setUploadedCount((count) => count + 1)
  }

  const handleShareClick = async (e) => {
    e.preventDefault()
    const pendingPhotos = selectedPhotos.filter((p) => p.status !== 'success')

    if (pendingPhotos.length === 0) {
      alert('All photos have already been successfully uploaded.')
      return
    }

    setIsUploading(true)

    for (let i = 0; i < pendingPhotos.length; i++) {
      const photo = pendingPhotos[i]

      setSelectedPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploading', errorMsg: null } : p))
      )

      try {
        await uploadSinglePhoto(photo)

        setSelectedPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: 'success' } : p))
        )
      } catch (err) {
        console.error(`Upload error for photo ${photo.file.name}:`, err)
        setSelectedPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, status: 'error', errorMsg: err.message } : p))
        )
      }
    }

    setIsUploading(false)

    setTimeout(() => {
      setSelectedPhotos((currentPhotos) => {
        const allSuccessful = currentPhotos.length > 0 && currentPhotos.every((p) => p.status === 'success')
        if (allSuccessful) {
          currentPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
          setIsSubmitted(true)
        }
        return currentPhotos
      })
    }, 100)
  }

  const handleUploadMore = () => {
    setSelectedPhotos([])
    setGuestName('')
    setMessage('')
    setIsSubmitted(false)
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Loading celebration...</p>
        </div>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.heartIcon}>♡</div>
          <h2 style={styles.errorTitle}>Notice</h2>
          <p style={styles.errorText}>{errorMsg}</p>
        </div>
      </div>
    )
  }

  const hasErrors = selectedPhotos.some((p) => p.status === 'error')
  const completedCount = selectedPhotos.filter((p) => p.status === 'success').length

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.heartIcon}>♡</div>
        <h1 style={styles.coupleNames}>{eventData.couple_names}</h1>
        <p style={styles.subtitle}>SHARE THE MOMENTS</p>

        {isSubmitted ? (
          <div style={styles.successContainer}>
            <h2 style={styles.successTitle}>Thank You!</h2>
            <p style={styles.successText}>
              {selectedPhotos.length} photo{selectedPhotos.length === 1 ? '' : 's'} lovingly shared with the couple.
            </p>
            {uploadedCount < MAX_PHOTOS_PER_DEVICE && (
              <button
                type="button"
                onClick={handleUploadMore}
                style={styles.shareButton}
              >
                SHARE ANOTHER PHOTO
              </button>
            )}
          </div>
        ) : (
          <>
            <p style={styles.instruction}>
              {uploadedCount >= MAX_PHOTOS_PER_DEVICE
                ? 'Thank you — this phone has shared all 5 of its moments.'
                : `We'd love to see the celebration through your eyes. ${MAX_PHOTOS_PER_DEVICE - uploadedCount} photo${MAX_PHOTOS_PER_DEVICE - uploadedCount === 1 ? '' : 's'} remaining on this phone.`}
            </p>

            <form onSubmit={handleShareClick} style={styles.form}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                style={{ display: 'none' }}
              />

              {selectedPhotos.length === 0 ? (
                <div
                  style={styles.addPhotosBox}
                  onClick={() => !isProcessing && uploadedCount < MAX_PHOTOS_PER_DEVICE && fileInputRef.current?.click()}
                >
                  <span style={styles.addPhotosText}>
                    {isProcessing ? 'PROCESSING PHOTOS...' : uploadedCount >= MAX_PHOTOS_PER_DEVICE ? '5 PHOTOS SHARED' : '+ ADD PHOTOS'}
                  </span>
                  <span style={styles.subtextInstruction}>Up to 5 photos from each phone</span>
                </div>
              ) : (
                <div>
                  <div style={styles.previewHeader}>
                    <span style={styles.previewCount}>
                      {completedCount} of {selectedPhotos.length} uploaded
                    </span>
                    {uploadedCount + selectedPhotos.filter((photo) => photo.status !== 'success').length < MAX_PHOTOS_PER_DEVICE && !isProcessing && !isUploading && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        style={styles.addMoreButton}
                      >
                        + Add More
                      </button>
                    )}
                  </div>
                  <div style={styles.progressTrack} aria-label={`${completedCount} of ${selectedPhotos.length} photos uploaded`}>
                    <div
                      style={{
                        ...styles.progressFill,
                        width: `${selectedPhotos.length ? (completedCount / selectedPhotos.length) * 100 : 0}%`,
                      }}
                    />
                  </div>

                  <div style={styles.thumbnailGrid}>
                    {selectedPhotos.map((photo) => (
                      <div key={photo.id} style={styles.thumbnailContainer}>
                        <img src={photo.previewUrl} alt="Preview" style={styles.thumbnailImage} />

                        {photo.status === 'uploading' && (
                          <div style={styles.overlayUploading}>
                            <span style={styles.overlayText}>Uploading...</span>
                          </div>
                        )}
                        {photo.status === 'success' && (
                          <div style={styles.overlaySuccess}>
                            <span style={styles.overlayText}>✓</span>
                          </div>
                        )}
                        {photo.status === 'error' && (
                          <div style={styles.overlayError} title={photo.errorMsg}>
                            <span style={styles.overlayText}>Failed</span>
                          </div>
                        )}

                        {(photo.status === 'idle' || photo.status === 'error') && !isUploading && (
                          <button
                            type="button"
                            onClick={() => handleRemovePhoto(photo.id)}
                            style={styles.removeButton}
                            title="Remove photo"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {isProcessing && <p style={styles.processingText}>Optimizing new photos...</p>}
                </div>
              )}

              <div style={styles.inputGroup}>
                <input
                  type="text"
                  placeholder="Your name (Optional)"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={isUploading}
                  style={styles.input}
                />
              </div>

              <div style={styles.inputGroup}>
                <textarea
                  placeholder="Add a short message to the couple (Optional)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isUploading}
                  rows={2}
                  style={styles.textarea}
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing || selectedPhotos.length === 0 || completedCount === selectedPhotos.length}
                style={{
                  ...styles.shareButton,
                  opacity: completedCount === selectedPhotos.length && selectedPhotos.length > 0 ? 0.6 : 1,
                }}
              >
                {isUploading
                  ? 'SHARING...'
                  : hasErrors
                  ? 'RETRY FAILED UPLOADS'
                  : completedCount > 0 && completedCount === selectedPhotos.length
                  ? 'UPLOADED SUCCESSFULLY'
                  : 'SHARE PHOTOS'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// 3. Main App Router Wrapper
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeLanding />} />
        <Route path="/photos/:eventCode" element={<EventUploadPage />} />
      </Routes>
    </BrowserRouter>
  )
}

// Minimalist mobile-first styling matching design philosophy
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#faf8f5',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#2c2c2c',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '36px 24px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.04)',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: '24px',
    fontWeight: '400',
    letterSpacing: '1px',
    marginBottom: '12px',
  },
  subtitle: {
    fontSize: '11px',
    letterSpacing: '2.5px',
    color: '#777777',
    marginBottom: '16px',
    textTransform: 'uppercase',
  },
  coupleNames: {
    fontSize: '26px',
    fontWeight: '400',
    letterSpacing: '0.5px',
    marginBottom: '6px',
    color: '#1a1a1a',
  },
  instruction: {
    fontSize: '14px',
    color: '#666666',
    marginBottom: '24px',
    lineHeight: '1.4',
  },
  heartIcon: {
    fontSize: '22px',
    color: '#c5a059',
    marginBottom: '12px',
  },
  errorTitle: {
    fontSize: '20px',
    fontWeight: '400',
    marginBottom: '12px',
  },
  errorText: {
    fontSize: '14px',
    color: '#666666',
    lineHeight: '1.5',
  },
  successContainer: {
    padding: '24px 0',
    textAlign: 'center',
  },
  successTitle: {
    fontSize: '22px',
    fontWeight: '400',
    color: '#1a1a1a',
    marginBottom: '12px',
    letterSpacing: '0.5px',
  },
  successText: {
    fontSize: '14px',
    color: '#666666',
    lineHeight: '1.6',
    marginBottom: '28px',
  },
  loadingText: {
    fontSize: '14px',
    letterSpacing: '1px',
    color: '#666666',
  },
  processingText: {
    fontSize: '12px',
    color: '#c5a059',
    textAlign: 'center',
    marginTop: '8px',
    letterSpacing: '0.5px',
  },
  demoButton: {
    display: 'inline-block',
    marginTop: '16px',
    padding: '12px 24px',
    backgroundColor: '#2c2c2c',
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    letterSpacing: '0.5px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    textAlign: 'left',
  },
  addPhotosBox: {
    border: '1.5px dashed #dcd6cd',
    borderRadius: '12px',
    padding: '24px 16px',
    textAlign: 'center',
    backgroundColor: '#fcfbfa',
    cursor: 'pointer',
  },
  addPhotosText: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    letterSpacing: '1px',
    color: '#2c2c2c',
    marginBottom: '4px',
  },
  subtextInstruction: {
    fontSize: '12px',
    color: '#888888',
  },
  previewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  previewCount: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#444444',
  },
  progressTrack: {
    width: '100%',
    height: '4px',
    backgroundColor: '#eee9e1',
    borderRadius: '999px',
    overflow: 'hidden',
    marginBottom: '12px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#c5a059',
    borderRadius: '999px',
    transition: 'width 240ms ease',
  },
  addMoreButton: {
    background: 'none',
    border: 'none',
    color: '#c5a059',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    padding: '0',
  },
  thumbnailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    maxHeight: '220px',
    overflowY: 'auto',
    paddingBottom: '4px',
  },
  thumbnailContainer: {
    position: 'relative',
    width: '100%',
    paddingBottom: '100%', /* 1:1 Aspect Ratio */
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: '#f0ece4',
  },
  thumbnailImage: {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  overlayUploading: {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlaySuccess: {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(76, 175, 80, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayError: {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(229, 57, 53, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    color: '#ffffff',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.5px',
  },
  removeButton: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: '#ffffff',
    border: 'none',
    fontSize: '14px',
    lineHeight: '1',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #e2ded8',
    backgroundColor: '#ffffff',
    fontSize: '14px',
    color: '#2c2c2c',
    outline: 'none',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid #e2ded8',
    backgroundColor: '#ffffff',
    fontSize: '14px',
    color: '#2c2c2c',
    outline: 'none',
    resize: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  shareButton: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#2c2c2c',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    letterSpacing: '1px',
    cursor: 'pointer',
    marginTop: '4px',
  }
}
