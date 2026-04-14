import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const SESSION_COOKIE = 'admin_session';

function isAuthed() {
  return cookies().get(SESSION_COOKIE)?.value === 'authenticated';
}

export async function POST(req) {
  if (!isAuthed()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const ext = file.name.split('.').pop().toLowerCase();
  const safeName = `challenge_${Date.now()}.${ext}`;
  const dir = resolve(process.cwd(), 'public/images');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, safeName), buffer);

  return NextResponse.json({ filename: safeName });
}
