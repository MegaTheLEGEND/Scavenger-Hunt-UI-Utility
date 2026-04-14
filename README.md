# Scavenger Hunt Challenge Board

## What is this?
I've always liked the idea of a scavenger hunt lol. So why not make a web app that can manage it for you? It started as just a gameplan in a word document, then i uploaded that to claude. it did great for a prototype, but in the end i had to do a ton of customization and fix a bunch of css (I HATE CSS 🤣) anyways, it works well enough for me. Since I cant let a project go if its not perfect, I probably will still be updating this in the near future... (still many ai generated bugs that i have to fix by hand lol)


## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) -- public challenge board.
Open [http://localhost:3000/admin](http://localhost:3000/admin) -- admin panel.

## Admin Credentials

Create an `.env.local` file in the root of the project, add just these lines:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
```
Change these before deploying.

## Managing Challenges

**Via Admin UI** (recommended): Go to `/admin`, log in, add/edit/delete challenges live. Or you can export to excel edit there and reimport. 


## Adding Images

Droped image files in the UI will be uploaded to `public/images/`. Reference by filename or add a link to an image in Excel. When the document is loaded it will automaticaly download the images.

## Pictures


here are some pics of the game including the lobby, in game, and some of the admin pages. 



<img width="721" height="434" alt="image" src="https://github.com/user-attachments/assets/ee7a5aa7-29a4-42b7-9a94-7455934690a7" />



<img width="1902" height="875" alt="image" src="https://github.com/user-attachments/assets/85c6f397-b33e-428e-9732-4bb2cf4bdb50" />




<img width="1896" height="894" alt="admin panel" src="https://github.com/user-attachments/assets/07ab2118-449c-4e79-a559-c08bc9fe94e1" />

<img width="1898" height="676" alt="image" src="https://github.com/user-attachments/assets/cc8c144e-6f54-4261-86fe-b0b5d35c3a3c" />

