# Wedding Guest Photo Upload

A standalone, mobile-first React and Supabase app for private wedding photo submissions.

## Local development

1. Copy `.env.example` to `.env` and add the Supabase project URL and anon key.
2. Install dependencies with `npm install`.
3. Apply the database setup with `npx supabase db push --linked --include-all`.
4. Deploy the function with `npx supabase functions deploy get-upload-url --use-api`.
5. Start the app with `npm run dev`.

## Production checklist

- Import the GitHub repository into Vercel and keep the detected Vite settings.
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel Project Settings → Environment Variables.
- Deploy; `vercel.json` provides the SPA fallback required by `/photos/EVENTCODE` links.
- Test selection, compression, upload, retry, and the five-photo limit on iOS Safari and Android Chrome.
- Use the final HTTPS event URL when generating the QR.
- Print a short URL below the QR as a fallback.

## Printable QR

After deployment, generate a high-error-correction SVG:

```powershell
npm run qr -- https://your-domain.com/photos/EVENTCODE wedding-qr.svg
```

Keep the QR at least 5 cm wide, preserve its white margin, and test the printed proof from several phones before the wedding.
