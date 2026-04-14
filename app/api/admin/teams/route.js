import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
const GAME_PATH = resolve(process.cwd(), 'data/game.json');
const SESSION_COOKIE = 'admin_session';

const log = (...args) => console.log('[admin/teams]', ...args);

function isAuthed() { return cookies().get(SESSION_COOKIE)?.value === 'authenticated'; }
function read() { return JSON.parse(readFileSync(GAME_PATH, 'utf8')); }

function write(g) {
  // Only auto-delete empty teams that were player-created (admin teams can be empty)
  // We track this with an adminCreated flag on the team
  g.teams = (g.teams || []).filter(t => t.members.length > 0 || t.adminCreated === true);
  writeFileSync(GAME_PATH, JSON.stringify(g, null, 2), 'utf8');
  if (global.__broadcast) global.__broadcast();
}

function uid() { return Math.random().toString(36).slice(2, 9); }

export async function PATCH(req) {
  if (!isAuthed()) {
    log('Unauthorized request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); }
  catch (e) {
    log('Failed to parse body:', e.message);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  log('Action:', body.action, JSON.stringify(body));

  const g = read();

  try {
    if (body.action === 'setTeamMode') {
      g.teamMode = { ...g.teamMode, ...body.settings };
      log('Team mode updated:', g.teamMode);

    } else if (body.action === 'createTeam') {
      if (!body.name?.trim()) {
        log('createTeam: missing name');
        return NextResponse.json({ error: 'Team name required' }, { status: 400 });
      }
      if ((g.teams || []).length >= (g.teamMode?.maxTeams || 8)) {
        log('createTeam: max teams reached');
        return NextResponse.json({ error: 'Max teams reached' }, { status: 400 });
      }
      const nameTaken = (g.teams || []).some(t => t.name.toLowerCase() === body.name.trim().toLowerCase());
      if (nameTaken) {
        log('createTeam: name taken:', body.name);
        return NextResponse.json({ error: 'Name already taken' }, { status: 400 });
      }
      const team = {
        id: uid(),
        name: body.name.trim(),
        leaderId: null,
        locked: true,
        code: uid().toUpperCase().slice(0, 5),
        members: [],
        doneIds: [],
        adminCreated: true,  // prevents auto-deletion when empty
        createdAt: new Date().toISOString(),
      };
      g.teams = [...(g.teams || []), team];
      log('Team created:', team.name, team.id);

    } else if (body.action === 'assignUserToTeam') {
      const { userId, userName, userBio, teamId } = body;
      log('assignUserToTeam:', userName, '->', teamId);

      // Remove from all other teams
      for (const t of g.teams || []) {
        const before = t.members.length;
        t.members = t.members.filter(m => m.id !== userId);
        if (before !== t.members.length) log('  Removed from team:', t.name);
        if (t.leaderId === userId && t.members.length > 0) t.leaderId = t.members[0].id;
      }
      // Auto-delete empty non-admin teams
      g.teams = (g.teams || []).filter(t => t.members.length > 0 || t.adminCreated === true);

      if (teamId) {
        const target = g.teams.find(t => t.id === teamId);
        if (!target) {
          log('assignUserToTeam: target team not found:', teamId);
          return NextResponse.json({ error: 'Target team not found' }, { status: 404 });
        }
        target.members.push({ id: userId, name: userName, bio: userBio || '', joinedAt: new Date().toISOString() });
        if (!target.leaderId) target.leaderId = userId;
        log('  Added to team:', target.name, '— members now:', target.members.length);

        write(g);

        if (global.__sendToUser) {
          global.__sendToUser(userId, { type: 'assigned', teamId, team: target });
          log('  Sent assigned signal to user:', userId);
        } else {
          log('  WARNING: __sendToUser not available');
        }
        return NextResponse.json({ ok: true });
      }

    } else if (body.action === 'assignLeader') {
      const team = (g.teams || []).find(t => t.id === body.teamId);
      if (team) { team.leaderId = body.userId; log('Leader assigned:', body.userId, 'in', team.name); }
      else log('assignLeader: team not found:', body.teamId);

    } else if (body.action === 'renameTeam') {
      const team = (g.teams || []).find(t => t.id === body.teamId);
      if (team) {
        const nameTaken = (g.teams || []).some(t => t.id !== body.teamId && t.name.toLowerCase() === body.name.trim().toLowerCase());
        if (nameTaken) return NextResponse.json({ error: 'Name already taken' }, { status: 400 });
        log('Team renamed:', team.name, '->', body.name);
        team.name = body.name.trim();
      }

    } else if (body.action === 'removeTeam') {
      log('Removing team:', body.teamId);
      g.teams = (g.teams || []).filter(t => t.id !== body.teamId);

    } else if (body.action === 'removeMember') {
      const team = (g.teams || []).find(t => t.id === body.teamId);
      if (team) {
        log('Removing member:', body.userId, 'from', team.name);
        team.members = team.members.filter(m => m.id !== body.userId);
        if (team.leaderId === body.userId && team.members.length > 0) team.leaderId = team.members[0].id;
        if (team.members.length === 0 && !team.adminCreated) {
          g.teams = g.teams.filter(t => t.id !== body.teamId);
          log('  Auto-deleted empty team:', team.name);
        }
      }

    } else if (body.action === 'clearAllTeams') {
      log('Clearing all teams');
      g.teams = [];

    } else {
      log('Unknown action:', body.action);
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    write(g);
    return NextResponse.json({ ok: true });

  } catch (e) {
    log('ERROR:', e.message, e.stack);
    return NextResponse.json({ error: 'Server error: ' + e.message }, { status: 500 });
  }
}
