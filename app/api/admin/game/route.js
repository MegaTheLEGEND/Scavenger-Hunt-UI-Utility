import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'admin_session';
const GAME_PATH = resolve(process.cwd(), 'data/game.json');

function isAuthed() {
  return cookies().get(SESSION_COOKIE)?.value === 'authenticated';
}

function read() {
  return JSON.parse(readFileSync(GAME_PATH, 'utf8'));
}

function write(game) {
  // Use global from custom server if available (triggers WSS broadcast)
  if (global.__writeGame) {
    global.__writeGame(game);
  } else {
    writeFileSync(GAME_PATH, JSON.stringify(game, null, 2), 'utf8');
  }
}

function computeSeconds(timer) {
  if (timer.paused) return timer.pausedAt ?? timer.durationSeconds;
  if (timer.started && timer.startTime) {
    const elapsed = Math.floor((Date.now() - new Date(timer.startTime).getTime()) / 1000);
    return timer.durationSeconds - elapsed; // allow negatives
  }
  return timer.durationSeconds;
}

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const game = read();
  return NextResponse.json({
    ...game,
    timer: { ...game.timer, secondsRemaining: computeSeconds(game.timer) },
  });
}

export async function PATCH(req) {
  if (!isAuthed()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const game = read();
  const t = game.timer;

  if (body.action === 'startTimer') {
    const secs = body.durationSeconds ?? t.durationSeconds;
    t.durationSeconds = secs;
    t.startTime = new Date().toISOString();
    t.started = true;
    t.paused = false;
    t.pausedAt = null;

  } else if (body.action === 'pauseTimer') {
    if (t.started && !t.paused) {
      t.pausedAt = computeSeconds(t); // snapshot current (possibly negative)
      t.paused = true;
    }

  } else if (body.action === 'resumeTimer') {
    if (t.paused) {
      // Re-anchor startTime so clock resumes from pausedAt
      const remaining = t.pausedAt ?? t.durationSeconds;
      t.startTime = new Date(Date.now() - (t.durationSeconds - remaining) * 1000).toISOString();
      t.paused = false;
      t.pausedAt = null;
    }

  } else if (body.action === 'stopTimer') {
    t.started = false;
    t.paused = false;
    t.startTime = null;
    t.pausedAt = null;

  } else if (body.action === 'resetTimer') {
    t.started = false;
    t.paused = false;
    t.startTime = null;
    t.pausedAt = null;
    t.durationSeconds = body.durationSeconds ?? t.durationSeconds;

  } else if (body.action === 'editDuration') {
    // Edit remaining seconds (works while paused or stopped)
    const newSecs = body.durationSeconds;
    t.durationSeconds = newSecs;
    if (t.paused) {
      t.pausedAt = newSecs;
    } else if (t.started) {
      // Re-anchor so remaining = newSecs from now
      t.startTime = new Date().toISOString();
      t.durationSeconds = newSecs;
    }

  } else if (body.rules !== undefined) {
    game.rules = body.rules;
  } else if (body.requirements !== undefined) {
    game.requirements = body.requirements;
  } else if (body.disqualifications !== undefined) {
    game.disqualifications = body.disqualifications;
  } else if (body.challengeAdd) {
    const maxId = game.challenges.reduce((m, c) => Math.max(m, c.id), 0);
    game.challenges.push({ id: maxId + 1, ...body.challengeAdd });
  } else if (body.challengeUpdate) {
    const idx = game.challenges.findIndex(c => c.id === body.challengeUpdate.id);
    if (idx !== -1) game.challenges[idx] = { ...game.challenges[idx], ...body.challengeUpdate };
  } else if (body.challengeDelete !== undefined) {
    game.challenges = game.challenges.filter(c => c.id !== body.challengeDelete);
  } else if (body.challengesReplace) {
    game.challenges = body.challengesReplace;
  }

  write(game);
  return NextResponse.json({ ok: true });
}
