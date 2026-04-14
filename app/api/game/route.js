import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';

function computeSeconds(timer) {
  if (timer.paused) return timer.pausedAt ?? timer.durationSeconds;
  if (timer.started && timer.startTime) {
    const elapsed = Math.floor((Date.now() - new Date(timer.startTime).getTime()) / 1000);
    return Math.max(0, timer.durationSeconds - elapsed);
  }
  return timer.durationSeconds;
}

export async function GET() {
  const game = JSON.parse(readFileSync(resolve(process.cwd(), 'data/game.json'), 'utf8'));
  const { timer, rules, requirements, disqualifications, challenges } = game;
  const secondsRemaining = computeSeconds(timer);

  return NextResponse.json({
    timer: {
      started: timer.started,
      paused: timer.paused ?? false,
      secondsRemaining,
      durationSeconds: timer.durationSeconds,
      expired: timer.started && !timer.paused && secondsRemaining === 0,
    },
    rules,
    requirements,
    disqualifications,
    challenges: timer.started ? challenges : [],
    challengesHidden: !timer.started,
  });
}
