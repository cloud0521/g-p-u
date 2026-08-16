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

## Owner portal

Owners sign in at `/photos/EVENTCODE/owner` using the event code and private owner password. Passwords are never stored in plaintext: only salted hashes appear in the database. Owner sessions expire after seven days, can be revoked by signing out, and repeated failed attempts trigger a 15-minute lockout.

After signing in, an owner can view, approve, hide, delete, individually download, or ZIP-download their wedding photos.

## Create a wedding

Use one command. It creates and applies a migration containing both the event and its owner password hash:

```powershell
npm run event:create -- --code "AB7K2" --couple "Bride & Groom" --date 2026-12-20
```

The command prints the event code, owner URL, and generated owner password. Save the password immediately and give it privately to the owner. The plaintext password is never written to the migration or repository.

Do not edit `seed_demo_event.sql` for new weddings; it only preserves the original demo event.
# g-p-u
