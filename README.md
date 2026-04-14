# Scavenger Hunt Challenge Board

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — public challenge board.
Open [http://localhost:3000/admin](http://localhost:3000/admin) — admin panel.

## Admin Credentials

Set in `.env.local`:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
```
Change these before deploying.

## Managing Challenges

**Via Admin UI** (recommended): Go to `/admin`, log in, add/edit/delete challenges live. Or you can export to excel edit there and reimport. 


## Adding Images

Droped image files in the UI will be uploaded to `public/images/`. Reference by filename or add a link to an image in Excel. When the document is loaded it will automaticaly download the images.

