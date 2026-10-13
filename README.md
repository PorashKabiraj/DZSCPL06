# DZSCPL-06 (Netlify)

Static site (`public/index.html`) + one serverless function (`netlify/functions/api.mjs`).
Data is stored in Netlify Blobs. Logins are checked on the server.

## Deploy (GitHub, easiest)
1. Push this folder to a GitHub repo.
2. Netlify > Add new site > Import from Git. Build settings are read from netlify.toml.
3. Site settings > Environment variables, add:
   - ADMIN_ID (e.g. admin)
   - ADMIN_PASSWORD (choose a strong one)
   - SESSION_SECRET (any long random text)
4. Trigger a redeploy.

## Deploy (CLI)
    npm install
    npm i -g netlify-cli
    netlify login
    netlify init
    netlify env:set ADMIN_ID admin
    netlify env:set ADMIN_PASSWORD "your-password"
    netlify env:set SESSION_SECRET "long-random-text"
    netlify deploy --prod

Do not use drag-and-drop: it will not install the function's dependency.
If ADMIN_PASSWORD is not set, the password falls back to admin123. Always set it.
Test locally with `netlify dev`.

## Notes
- Pages refresh from the server every 5 seconds (only while the tab is visible).
- Admin creates umpire accounts; umpires and team captains log in on the Login page.
