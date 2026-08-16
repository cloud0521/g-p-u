import QRCode from 'qrcode'

const [url, output = 'printable-wedding-qr.svg'] = process.argv.slice(2)

if (!url) {
  console.error('Usage: npm run qr -- https://your-domain.com/photos/EVENTCODE [output.svg]')
  process.exit(1)
}

let parsedUrl
try {
  parsedUrl = new URL(url)
} catch {
  console.error('Please provide a complete production URL, including https://')
  process.exit(1)
}

if (parsedUrl.protocol !== 'https:' || !/^\/photos\/[^/]+\/?$/.test(parsedUrl.pathname)) {
  console.error('QR URL must use HTTPS and follow /photos/EVENTCODE')
  process.exit(1)
}

await QRCode.toFile(output, parsedUrl.toString(), {
  type: 'svg', errorCorrectionLevel: 'H', margin: 4,
  color: { dark: '#111111', light: '#FFFFFF' }, width: 1200,
})

console.log(`Printable QR created: ${output}`)
