# Sky Creator Pro

Sky Creator Pro is a React + Vite website and Electron Windows desktop app for creators who want to organize projects, draft thumbnails, edit videos, and manage a creator workflow.

This repository is prepared for GitHub and Netlify. The website build stays small because the Windows installer is hosted separately in Supabase Storage.

## Tech Stack

- React
- TypeScript
- Vite
- CSS
- Electron
- electron-builder
- Supabase client
- Netlify
- pnpm

## Project Structure

```text
SkyCreatorPro/
  build/                         App icon placeholders for Electron
  electron/                      Electron main and preload scripts
  public/                        Static website files copied into dist
  scripts/                       Build/upload helper scripts
  src/
    components/                  Shared UI components
    data/                        Local demo data
    lib/                         Supabase client setup
    pages/                       Website pages
    App.css                      App styling
    App.tsx                      Website + desktop app routing
    main.tsx                     React entry
    types.ts                     Shared TypeScript types
  supabase/                      SQL setup for Supabase
  .env.example                   Environment variable template
  .gitignore
  netlify.toml                   Netlify build, redirects, and headers
  package.json
  pnpm-lock.yaml
  vite.config.ts
```

Generated folders such as `node_modules`, `dist`, `release`, `.netlify`, installers, and ZIP deploy files are ignored by Git.

## Website Pages

- `/`
- `/create-account`
- `/login`
- `/dashboard`
- `/download`
- `/privacy`

Netlify redirects are configured so direct links to these routes load the React app correctly.

## Requirements

- Node.js 22
- pnpm 11
- Windows is required for building the Windows installer locally

## Environment Variables

Create a local environment file:

```bash
copy .env.example .env.local
```

Set:

```env
VITE_SUPABASE_URL=https://vzddjujoqrrwkezrbhfw.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_or_anon_key_here
```

Do not commit real `.env` files. Never put a Supabase service role key in this frontend app.

For manual ZIP deploys, the built site also supports runtime config through:

```text
public/config.js
```

## Install

```bash
pnpm install
```

## Run Website Locally

```bash
pnpm dev
```

Open:

```text
http://localhost:5173
```

## Build Website

```bash
pnpm build
```

Output:

```text
dist/
```

The build command runs TypeScript, builds with Vite, and inlines the production CSS into `dist/index.html` so manual Netlify ZIP deploys do not lose styling.

## Preview Website Build

```bash
pnpm preview
```

## Netlify Deploy

Netlify settings are already included in `netlify.toml`:

```toml
[build]
  command = "pnpm build"
  publish = "dist"
```

Manual deploy:

```bash
netlify deploy --dir=dist
```

Production deploy:

```bash
netlify deploy --prod --dir=dist
```

You can also drag and drop the contents of `dist` or a ZIP made from `dist` into Netlify.

## Supabase Setup

The SQL setup is saved here:

```text
supabase/sky_creator_pro_setup.sql
```

It creates:

- `public.profiles`
- `public.downloads`
- a profile trigger for new auth users
- RLS policies for profiles and download tracking
- a public Storage bucket named `downloads`

## Windows Installer Storage

Build the Windows installer:

```bash
pnpm desktop:build
```

Installer output:

```text
release/SkyCreatorProSetup.exe
```

Upload the installer to Supabase Storage:

```text
Bucket: downloads
File name: sky-creator-pro-setup.exe
```

The website download button points to the public Supabase Storage file. The EXE should not be committed to GitHub and should not be bundled into the Netlify website build.

## Electron Desktop App

Run the desktop app locally:

```bash
pnpm desktop:dev
```

Build an unpacked Windows app:

```bash
pnpm desktop:pack
```

Build the Windows installer:

```bash
pnpm desktop:build
```

## Useful Scripts

```text
pnpm dev                       Run Vite dev server
pnpm build                     Build Netlify website
pnpm preview                   Preview built website
pnpm lint                      Run oxlint
pnpm desktop:dev               Build and launch Electron app
pnpm desktop:pack              Build unpacked Windows app
pnpm desktop:build             Build Windows installer
pnpm storage:upload-installer  Upload installer to Supabase Storage
```

## GitHub Notes

Before pushing to GitHub:

1. Make sure `.env.local` is not committed.
2. Do not commit `node_modules`, `dist`, `release`, ZIP deploys, or installer EXE files.
3. Commit source files, config files, lockfile, Supabase SQL, and documentation.
4. Use `pnpm build` before deploying to Netlify.

## Current Limitations

- Payments are placeholders.
- Mega Pro is test mode only.
- The website uses Supabase Auth and Storage, but Pro plan enforcement is not active yet.
- The desktop editor has early export/project features and will need more production hardening later.
