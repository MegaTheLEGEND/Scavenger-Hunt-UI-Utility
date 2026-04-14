// Core HTTP + URL handling
const { createServer } = require('http');
const { parse } = require('url');

// Next.js app server
const next = require('next');

// WebSocket server for real-time updates
const { WebSocketServer } = require('ws');

// File system for persistent game state storage
const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

// Determine environment mode
const dev = process.env.NODE_ENV !== 'production';

// Initialize Next.js
const app = next({ dev });
const handle = app.getRequestHandler();

// Path to persistent game state file
const GAME_PATH = resolve(__dirname, 'data/game.json');

/**
 * Reads the current game state from disk
 */
function readGame() {
  return JSON.parse(readFileSync(GAME_PATH, 'utf8'));
}

/**
 * Writes updated game state to disk and broadcasts changes to all clients
 */
function writeGame(game) {
  writeFileSync(GAME_PATH, JSON.stringify(game, null, 2), 'utf8');
  broadcast();
}

/**
 * Computes remaining timer seconds based on pause/start state
 */
function computeSeconds(timer) {
  if (timer.paused) return timer.pausedAt ?? timer.durationSeconds;

  if (timer.started && timer.startTime) {
    const elapsed = Math.floor(
      (Date.now() - new Date(timer.startTime).getTime()) / 1000
    );
    return timer.durationSeconds - elapsed;
  }

  return timer.durationSeconds;
}

/**
 * Builds a safe payload sent to clients
 * - Hides challenges unless allowed
 * - Computes timer state
 * - Controls visibility based on expiration/admin rights
 */
function buildPayload(game, isAdmin = false) {
  const { timer, rules, requirements, disqualifications, challenges, teams, teamMode } = game;

  const secondsRemaining = computeSeconds(timer);
  const expired = timer.started && !timer.paused && secondsRemaining <= 0;
  const visible = timer.started && !expired;

  return {
    timer: {
      started: timer.started,
      paused: timer.paused ?? false,
      secondsRemaining,
      durationSeconds: timer.durationSeconds,
      expired,
    },

    rules,
    requirements,
    disqualifications,

    // Only show challenges if admin or timer is active
    challenges: (isAdmin || visible) ? challenges : [],

    // Used by frontend to know if challenges are hidden
    challengesHidden: !isAdmin && !visible,

    teams: teams || [],

    teamMode: teamMode || {
      enabled: false,
      allowUserCreate: true,
    },
  };
}

// WebSocket server instance
let wss;

// Active connected clients registry
// Each client tracks identity + session metadata
const clients = new Set();

/**
 * Returns unique connected users (deduplicated by userId)
 * Used mainly for admin dashboard
 */
function getConnectedUsers() {
  const seen = new Map();

  for (const c of clients) {
    if (c.ws.readyState !== 1) continue;

    if (!seen.has(c.userId)) {
      seen.set(c.userId, {
        userId: c.userId,
        userName: c.userName,
        teamId: c.teamId,
        connectedAt: c.connectedAt,
        lastPing: c.lastPing,
        isAdmin: c.isAdmin,
        ip: c.ip,
        userAgent: c.userAgent,
      });
    }
  }

  return [...seen.values()];
}

/**
 * Sends updated game state to all connected clients
 * - Applies visibility rules per client
 * - Detects invalid teams / kicks users if needed
 * - Sends admin-only user list
 */
function broadcast() {
  if (!wss) return;

  const game = readGame();
  const connectedUsers = getConnectedUsers();

  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;

    // Check if user's team still exists and membership is valid
    const myTeamStillExists = !client.teamId || (game.teams || []).some(t =>
      t.id === client.teamId &&
      t.members.some(m => m.id === client.userId)
    );

    // If team mode is off, non-admin users may be kicked from team context
    const teamModeOff = !game.teamMode?.enabled;

    const kicked =
      !client.isAdmin &&
      client.teamId &&
      (!myTeamStillExists || teamModeOff);

    if (kicked) {
      console.log(
        '[server] broadcast: sending kicked to',
        client.userName,
        '| teamId:',
        client.teamId,
        '| teamStillExists:',
        myTeamStillExists
      );
    }

    // Send full state update to client
    client.ws.send(JSON.stringify({
      type: 'state',
      data: buildPayload(game, client.isAdmin),
      kicked,
      teamModeOff: teamModeOff && !client.isAdmin,
      connectedUsers: client.isAdmin ? connectedUsers : undefined,
    }));
  }
}

/**
 * Utility tick loop (runs every second)
 * - Updates timers
 * - Keeps admin user list fresh
 * - Sends lightweight updates when possible
 */
setInterval(() => {
  if (clients.size === 0) return;

  const game = readGame();
  const running = game.timer.started && !game.timer.paused;
  const connectedUsers = getConnectedUsers();

  for (const client of clients) {
    if (client.ws.readyState !== 1) continue;

    // Non-admin clients only receive ticks when timer is running
    if (!client.isAdmin && !running) continue;

    client.lastPing = new Date().toISOString();

    client.ws.send(JSON.stringify({
      type: running ? 'tick' : 'ping',
      data: running ? buildPayload(game, client.isAdmin) : undefined,
      connectedUsers: client.isAdmin ? connectedUsers : undefined,
    }));
  }
}, 1000);

// Expose helpers globally (useful for debugging / external scripts)
global.__writeGame = writeGame;
global.__readGame  = readGame;
global.__broadcast = broadcast;
global.__getConnectedUsers = getConnectedUsers;

/**
 * Sends a direct message to a specific user
 * Also updates their team assignment if included
 */
global.__sendToUser = function(userId, payload) {
  for (const c of clients) {
    if (c.ws.readyState === 1 && c.userId === userId) {
      if (payload.type === 'assigned') c.teamId = payload.teamId;
      c.ws.send(JSON.stringify(payload));
    }
  }
};

/**
 * Extracts real client IP address (supports proxies)
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Prepare Next.js before starting server
app.prepare().then(() => {

  // Create HTTP server (Next.js handler)
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  // Attach WebSocket server on /ws endpoint
  wss = new WebSocketServer({ server, path: '/ws' });

  /**
   * Handle new WebSocket connections
   */
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');

    // Determine user role and identity
    const isAdmin  = url.searchParams.get('role') === 'admin';
    const userId   = url.searchParams.get('uid') ||
      `anon_${Math.random().toString(36).slice(2,7)}`;

    const userName = isAdmin
      ? 'Admin'
      : decodeURIComponent(url.searchParams.get('name') || 'Unknown');

    const teamId = url.searchParams.get('team') || null;

    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Client session object
    const client = {
      ws,
      isAdmin,
      userId,
      userName,
      teamId,
      ip,
      userAgent,
      connectedAt: new Date().toISOString(),
      lastPing: new Date().toISOString(),
    };

    clients.add(client);

    console.log(
      '[server] WS connect:',
      userName,
      '| uid:',
      userId,
      '| teamId:',
      teamId,
      '| isAdmin:',
      isAdmin,
      '| ip:',
      ip
    );

    // Notify admins that user list changed
    if (!isAdmin) broadcast();

    // Send initial state immediately after connection
    try {
      const game = readGame();

      ws.send(JSON.stringify({
        type: 'state',
        data: buildPayload(game, isAdmin),
        connectedUsers: isAdmin ? getConnectedUsers() : undefined,
      }));
    } catch {}

    /**
     * Cleanup on disconnect
     */
    ws.on('close', () => {
      console.log(
        '[server] WS disconnect:',
        client.userName,
        '| uid:',
        client.userId
      );

      clients.delete(client);
      broadcast();
    });

    ws.on('error', () => clients.delete(client));
  });

  // Start HTTP + WS server
  const port = process.env.PORT || 3000;

  server.listen(port, '0.0.0.0', () => {
    console.log(`\n  ▲ Scavenger Hunt`);
    console.log(`  - Local:   http://localhost:${port}`);
    console.log(`  - Network: http://0.0.0.0:${port}\n`);
  });
});