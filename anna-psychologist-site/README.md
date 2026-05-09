# Hanna Stryuchenko Website

This folder is ready for standalone static hosting.

## Netlify form

The booking form is configured for Netlify Forms.

Checklist after deploy:

1. Redeploy the site from this folder/project.
2. In Netlify, confirm the `booking` form appears in the Forms section.
3. Add or verify email notifications for submissions to `anna.stryuchenko@gmail.com`.
4. Submit one live test from the deployed domain and confirm redirect to `thank-you.html`.

## Local preview

```bash
cd /Users/ro/Documents/Codex/anna-psychologist-site
python3 -m http.server 8000
```

Open:

`http://localhost:8000`

## Netlify

Upload this folder directly:

`/Users/ro/Documents/Codex/anna-psychologist-site`

It already contains:

- `index.html`
- `styles.css`
- `script.js`
- `assets/`
- `netlify.toml`

For a quick deploy, drag this folder into Netlify Drop.
