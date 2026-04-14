import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, extname } from 'path';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'admin_session';
const GAME_PATH = resolve(process.cwd(), 'data/game.json');
const IMG_DIR   = resolve(process.cwd(), 'public/images');

function isAuthed() {
  return cookies().get(SESSION_COOKIE)?.value === 'authenticated';
}

async function parseXlsx(buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, {
    range: 2,
    header: ['type', 'pts', 'desc', 'note', 'image'],
    defval: '',
  });
}

async function downloadImage(url, id) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    let ext = extname(new URL(url).pathname).toLowerCase();
    if (!ext.match(/\.(jpg|jpeg|png|webp|gif)$/)) ext = '.jpg';
    mkdirSync(IMG_DIR, { recursive: true });
    const filename = `imported_${id}_${Date.now()}${ext}`;
    writeFileSync(join(IMG_DIR, filename), buf);
    return filename;
  } catch { return ''; }
}

export async function POST(req) {
  if (!isAuthed()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = await parseXlsx(buffer);

  const VALID = new Set(['action', 'picture', 'grab']);
  const validRows = rows.filter(r => r.type && VALID.has(String(r.type).toLowerCase().trim()));
  const results = { imported: 0, skipped: 0, imagesDownloaded: 0, errors: [] };
  const challenges = [];

  for (let i = 0; i < validRows.length; i++) {
    const r = validRows[i];
    const desc = String(r.desc || '').trim();
    if (!desc) { results.skipped++; continue; }

    const type = String(r.type).toLowerCase().trim();
    const imageVal = String(r.image || '').trim();
    let imageFile = '';

    if (imageVal) {
      if (imageVal.startsWith('http://') || imageVal.startsWith('https://') || imageVal.startsWith('www.')) {
        const url = imageVal.startsWith('www.') ? `https://${imageVal}` : imageVal;
        imageFile = await downloadImage(url, i + 1);
        if (imageFile) results.imagesDownloaded++;
        else results.errors.push(`Row ${i + 3}: could not download ${url}`);
      } else {
        imageFile = imageVal;
      }
    }

    challenges.push({ id: i + 1, type, pts: Number(r.pts) || 0, desc, note: String(r.note || '').trim(), image: imageFile });
    results.imported++;
  }

  const game = JSON.parse(readFileSync(GAME_PATH, 'utf8'));
  game.challenges = challenges;

  if (global.__writeGame) global.__writeGame(game);
  else writeFileSync(GAME_PATH, JSON.stringify(game, null, 2), 'utf8');

  return NextResponse.json({ ok: true, ...results });
}
