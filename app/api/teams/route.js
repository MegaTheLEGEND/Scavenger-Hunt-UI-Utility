import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const GAME_PATH = resolve(process.cwd(), 'data/game.json');

const log = (...args) => console.log('[teams]', ...args);

function read() { return JSON.parse(readFileSync(GAME_PATH, 'utf8')); }

function write(g) {
  // Auto-delete empty teams UNLESS they were admin-created (those can wait for players)
  g.teams = (g.teams || []).filter(t => t.members.length > 0 || t.adminCreated === true);
  writeFileSync(GAME_PATH, JSON.stringify(g, null, 2), 'utf8');
  if (global.__broadcast) global.__broadcast();
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function evictFromAllTeams(teams, userId) {
  for (const t of teams) {
    const before = t.members.length;
    t.members = t.members.filter(m => m.id !== userId);
    if (before !== t.members.length) log('  Evicted', userId, 'from team:', t.name);
    if (t.leaderId === userId && t.members.length > 0) t.leaderId = t.members[0].id;
  }
}

export async function GET() {
  const g = read();
  return NextResponse.json({ teams: g.teams || [], teamMode: g.teamMode });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { teamName, leaderId, leaderName, leaderBio } = body;
  log('POST create team:', teamName, 'by', leaderName, leaderId);

  if (!teamName?.trim() || !leaderId || !leaderName) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const g = read();

  if (!g.teamMode?.enabled) return NextResponse.json({ error: 'Team mode is off' }, { status: 403 });
  if (!g.teamMode?.allowUserCreate) return NextResponse.json({ error: 'Team creation is disabled — wait for admin to assign you' }, { status: 403 });
  if ((g.teams || []).length >= (g.teamMode.maxTeams || 8)) {
    return NextResponse.json({ error: 'Max teams reached' }, { status: 400 });
  }

  const nameTaken = (g.teams || []).some(t => t.name.toLowerCase() === teamName.trim().toLowerCase());
  if (nameTaken) return NextResponse.json({ error: 'A team with that name already exists' }, { status: 400 });

  // Evict from any existing team first
  evictFromAllTeams(g.teams || [], leaderId);

  const team = {
    id: uid(),
    name: teamName.trim(),
    leaderId,
    locked: true,
    code: uid().toUpperCase().slice(0, 5),
    members: [{ id: leaderId, name: leaderName, bio: leaderBio || '', joinedAt: new Date().toISOString() }],
    doneIds: [],
    adminCreated: false,
    createdAt: new Date().toISOString(),
  };
  g.teams = [...(g.teams || []), team];
  log('Team created:', team.name, team.id, 'code:', team.code);
  write(g);
  return NextResponse.json({ team });
}

export async function PATCH(req) {
  let body;
  try { body = await req.json(); } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  log('PATCH action:', body.action, 'teamId:', body.teamId);

  const g = read();
  const teams = g.teams || [];
  const idx = teams.findIndex(t => t.id === body.teamId);

  if (idx === -1) {
    log('Team not found:', body.teamId, '— existing teams:', teams.map(t => t.id));
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }
  const team = teams[idx];

  if (body.action === 'join') {
    const { userId, userName } = body;
    log('join:', userName, userId, '-> team:', team.name);

    if (team.locked && body.code?.toUpperCase() !== team.code) {
      log('join: wrong code. got:', body.code, 'expected:', team.code);
      return NextResponse.json({ error: 'Wrong code' }, { status: 403 });
    }

    if (team.members.find(m => m.id === userId)) {
      log('join: already in team, returning current state');
      return NextResponse.json({ team });
    }

    // Evict from all other teams
    evictFromAllTeams(teams, userId);

    // Re-find after eviction
    const target = teams.find(t => t.id === body.teamId);
    if (!target) {
      log('join: team vanished after eviction — this should not happen');
      return NextResponse.json({ error: 'Team not found after eviction' }, { status: 404 });
    }
    target.members.push({ id: userId, name: userName, bio: body.bio || '', joinedAt: new Date().toISOString() });
    log('join: success — team now has', target.members.length, 'members');
    g.teams = teams;
    write(g);
    return NextResponse.json({ team: target });

  } else if (body.action === 'leave') {
    log('leave:', body.userId, 'from team:', team.name);
    team.members = team.members.filter(m => m.id !== body.userId);
    if (team.leaderId === body.userId && team.members.length > 0) team.leaderId = team.members[0].id;
    log('leave: team now has', team.members.length, 'members');

  } else if (body.action === 'rename') {
    if (body.userId !== team.leaderId) return NextResponse.json({ error: 'Not leader' }, { status: 403 });
    const nameTaken = teams.some((t, i) => i !== idx && t.name.toLowerCase() === body.name.trim().toLowerCase());
    if (nameTaken) return NextResponse.json({ error: 'Name already taken' }, { status: 400 });
    log('rename:', team.name, '->', body.name);
    team.name = body.name.trim();

  } else if (body.action === 'toggleLock') {
    if (body.userId !== team.leaderId) return NextResponse.json({ error: 'Not leader' }, { status: 403 });
    team.locked = !team.locked;
    log('toggleLock:', team.name, '-> locked:', team.locked);

  } else if (body.action === 'markDone') {
    const { challengeId, done } = body;
    if (done) { if (!team.doneIds.includes(challengeId)) team.doneIds.push(challengeId); }
    else team.doneIds = team.doneIds.filter(id => id !== challengeId);

  } else if (body.action === 'updateProfile') {
    const member = team.members.find(m => m.id === body.userId);
    if (member) { member.name = body.name || member.name; member.bio = body.bio ?? member.bio; }

  } else {
    log('Unknown action:', body.action);
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  teams[idx] = team;
  g.teams = teams;
  write(g);
  return NextResponse.json({ team: teams[idx] });
}

export async function DELETE(req) {
  const { teamId } = await req.json();
  log('DELETE team:', teamId);
  const g = read();
  if (!(g.teams || []).find(t => t.id === teamId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  g.teams = g.teams.filter(t => t.id !== teamId);
  write(g);
  return NextResponse.json({ ok: true });
}
