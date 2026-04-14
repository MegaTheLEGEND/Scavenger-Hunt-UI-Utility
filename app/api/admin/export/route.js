import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'admin_session';
const GAME_PATH = resolve(process.cwd(), 'data/game.json');

function isAuthed() {
  return cookies().get(SESSION_COOKIE)?.value === 'authenticated';
}

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const XLSX = await import('xlsx');
  const game = JSON.parse(readFileSync(GAME_PATH, 'utf8'));
  const { challenges } = game;

  const wb = XLSX.utils.book_new();

  // Header row + sub-note row + data
  const aoa = [
    ['TYPE', 'PTS', 'DESC', 'NOTE', 'IMAGE'],
    ['action / picture / grab', 'Point value', 'Challenge description', 'Judge note (optional)', 'Filename or URL (optional)'],
    ...challenges.map(c => [c.type, c.pts, c.desc, c.note || '', c.image || '']),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 64 }, { wch: 36 }, { wch: 50 }];

  XLSX.utils.book_append_sheet(wb, ws, 'Challenges');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="challenges_export_${new Date().toISOString().slice(0,10)}.xlsx"`,
    },
  });
}
