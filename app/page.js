'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './page.module.css';
import { haptics } from '../lib/haptics';
import { getProfile, saveProfile, createProfile, getTeamMembership, saveTeamMembership } from '../lib/profile';

const log = (...args) => console.log('[page]', ...args);

const CHALLENGE_TYPES = {
  action:  { color: '#e03c31', desc: 'Video of a team member performing the action in a clearly public space.' },
  picture: { color: '#2a8fff', desc: 'Photo of the specified object including 2+ team members.' },
  grab:    { color: '#2ecc71', desc: 'Physically obtain and bring the item to judges. No replicas or screenshots.' },
};

function linkify(text) {
  if (!text) return text;
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part)
      ? <a key={i} href={part.startsWith('http') ? part : `https://${part}`} target="_blank" rel="noopener noreferrer" className={styles.link}>{part}</a>
      : part
  );
}

function formatTime(secs) {
  const abs = Math.abs(secs);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const str = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return secs < 0 ? `-${str}` : str;
}

export default function HomePage() {
  const [screen, setScreen]           = useState('loading');
  const [game, setGame]               = useState(null);
  const [profile, setProfile]         = useState(null);
  const [myTeam, setMyTeam]           = useState(null);
  const [wsStatus, setWsStatus]       = useState('connecting');
  const [kicked, setKicked]           = useState(false);

  // Lobby
  const [lobbyTab, setLobbyTab]       = useState('list');
  const [newTeamName, setNewTeamName] = useState('');
  const [joinCode, setJoinCode]       = useState('');
  const [lobbyError, setLobbyError]   = useState('');
  const [lobbyLoading, setLobbyLoading] = useState(false);

  // Profile
  const [nameInput, setNameInput]     = useState('');
  const [bioInput, setBioInput]       = useState('');

  // Game UI
  const [selected, setSelected]       = useState(null);
  const [filter, setFilter]           = useState('all');
  const [search, setSearch]           = useState('');
  const [showDoneFirst, setShowDoneFirst] = useState(false);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [newTeamNameEdit, setNewTeamNameEdit] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [renameError, setRenameError] = useState('');

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const prevExpiredRef = useRef(false);
  const screenRef = useRef('loading');
  const intentionalCloseRef = useRef(false); // prevents onclose from stomping intentional reconnects

  // Keep screenRef in sync
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // ── Build WS URL ───────────────────────────────────────────────────
  function buildWsUrl(prof, teamId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = `${protocol}//${window.location.host}/ws`;
    const params = new URLSearchParams();
    if (prof?.id)   params.set('uid', prof.id);
    if (prof?.name) params.set('name', encodeURIComponent(prof.name));
    if (teamId)     params.set('team', teamId);
    return `${base}?${params}`;
  }

  // Close the current WS without triggering auto-reconnect
  function closeWs() {
    intentionalCloseRef.current = true;
    clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  }

  // ── WebSocket ──────────────────────────────────────────────────────
  const connect = useCallback((prof, teamId) => {
    closeWs();
    intentionalCloseRef.current = false;
    const ws = new WebSocket(buildWsUrl(prof, teamId));
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => {
      wsRef.current = null;
      if (intentionalCloseRef.current) return; // don't auto-reconnect
      setWsStatus('reconnecting');
      reconnectRef.current = setTimeout(() => {
        connect(getProfile(), getTeamMembership()?.teamId);
      }, 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state' || msg.type === 'tick') {
        if (msg.data.timer?.expired && !prevExpiredRef.current) haptics.timerExpired();
        prevExpiredRef.current = msg.data.timer?.expired ?? false;
        setGame(msg.data);

        // Sync my team from server state
        const membership = getTeamMembership();
        if (membership) {
          const updated = (msg.data.teams || []).find(t => t.id === membership.teamId);
          setMyTeam(updated || null);
        }

        // Handle kicked / team deleted / team mode off
        if (msg.kicked) {
          log('WS: kicked signal received — clearing membership');
          saveTeamMembership(null);
          setMyTeam(null);
          setKicked(true);
          setShowTeamPanel(false);
          if (screenRef.current === 'game') setScreen('lobby');
        }
        if (msg.teamModeOff && screenRef.current === 'lobby') {
          log('WS: team mode turned off — going to game');
          setScreen('game');
        }
      }

      // Admin assigned this player to a team
      if (msg.type === 'assigned') {
        log('WS: assigned to team', msg.teamId, msg.team?.name);
        haptics.success();
        saveTeamMembership(msg.teamId);
        setMyTeam(msg.team);
        setKicked(false);
        // Reconnect WS with updated teamId
        const prof = getProfile();
        connect(prof, msg.teamId);
        setScreen('game');
      }
    };
    return ws;
  }, []);

  // ── Init ───────────────────────────────────────────────────────────
  const gameInitialized = useRef(false);
  useEffect(() => {
    if (gameInitialized.current) return;
    const prof = getProfile();
    setProfile(prof);
    const membership = getTeamMembership();
    connect(prof, membership?.teamId);
    return () => closeWs();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!game || gameInitialized.current) return;
    gameInitialized.current = true;

    const urlParams = new URLSearchParams(window.location.search);
    const codeFromUrl = urlParams.get('code');

    if (!game.teamMode?.enabled) { setScreen('game'); return; }
    const prof = getProfile();

    // Already in a team?
    const membership = getTeamMembership();
    if (prof && membership) {
      const team = (game.teams || []).find(t => t.id === membership.teamId);
      if (team) { setMyTeam(team); setScreen('game'); return; }
      saveTeamMembership(null);
    }

    if (codeFromUrl) {
      setJoinCode(codeFromUrl);
      if (!prof) {
        // No profile yet — go to combined profile+join screen
        setScreen('profile_join');
      } else {
        // Has profile, just join directly
        const team = (game.teams || []).find(t => t.code === codeFromUrl.toUpperCase());
        if (team) {
          joinTeamWithProfile(prof, team, codeFromUrl);
        } else {
          setLobbyTab('code');
          setScreen('lobby');
        }
      }
      return;
    }

    if (!prof) { setScreen('profile'); return; }
    setScreen('lobby');
  }, [game]); // eslint-disable-line

  // ESC
  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      haptics.click();
      setSelected(null); setShowTeamPanel(false); setEditingTeamName(false); setEditingProfile(false);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // ── Profile ────────────────────────────────────────────────────────
  async function joinTeamWithProfile(prof, team, code) {
    const r = await fetch('/api/teams', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: team.id, action: 'join', userId: prof.id, userName: prof.name, bio: prof.bio || '', code }),
    });
    const data = await r.json();
    if (r.ok) {
      haptics.success();
      saveTeamMembership(data.team.id);
      setMyTeam(data.team);
      connect(prof, data.team.id);
      // Clean up URL
      window.history.replaceState({}, '', '/');
      setScreen('game');
    } else {
      haptics.warning();
      setLobbyError(data.error || 'Could not join team');
      setLobbyTab('code');
      setScreen('lobby');
    }
  }

  function submitProfile(e) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const prof = createProfile(nameInput, bioInput);
    setProfile(prof);
    haptics.success();
    const membership = getTeamMembership();
    connect(prof, membership?.teamId);
    if (joinCode) { setLobbyTab('code'); setScreen('lobby'); }
    else setScreen('lobby');
  }

  async function submitProfileJoin(e) {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const prof = createProfile(nameInput, bioInput);
    setProfile(prof);
    haptics.success();
    connect(prof, null);
    const team = (game?.teams || []).find(t => t.code === joinCode.toUpperCase());
    if (team) {
      await joinTeamWithProfile(prof, team, joinCode);
    } else {
      setLobbyError('Team code not found');
      setLobbyTab('code');
      setScreen('lobby');
    }
  }

  function saveProfileEdit(e) {
    e.preventDefault();
    const updated = { ...profile, name: nameInput || profile.name, bio: bioInput ?? profile.bio };
    saveProfile(updated);
    setProfile(updated);
    haptics.success();
    setEditingProfile(false);
    // Reconnect with updated name
    connect(updated, myTeam?.id);
  }

  // ── Lobby ──────────────────────────────────────────────────────────
  async function createTeam(e) {
    e.preventDefault();
    if (!newTeamName.trim() || !profile) return;
    setLobbyLoading(true); setLobbyError('');
    log('createTeam:', newTeamName);
    const r = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: newTeamName, leaderId: profile.id, leaderName: profile.name, leaderBio: profile.bio }),
    });
    const data = await r.json();
    log('createTeam response:', r.status, JSON.stringify(data));
    if (r.ok) {
      haptics.success();
      setKicked(false);
      saveTeamMembership(data.team.id);
      setMyTeam(data.team);
      connect(profile, data.team.id);
      setScreen('game');
    } else {
      haptics.warning(); setLobbyError(data.error || 'Failed');
    }
    setLobbyLoading(false);
  }

  async function joinTeam(team, code = '') {
    if (!profile) return;
    setLobbyLoading(true); setLobbyError('');
    log('joinTeam:', team.name, team.id, 'code:', code);
    const r = await fetch('/api/teams', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: team.id, action: 'join', userId: profile.id, userName: profile.name, bio: profile.bio || '', code }),
    });
    const data = await r.json();
    log('joinTeam response:', r.status, JSON.stringify(data));
    if (r.ok) {
      haptics.success();
      setKicked(false);
      saveTeamMembership(data.team.id);
      setMyTeam(data.team);
      connect(profile, data.team.id);
      setScreen('game');
    } else {
      haptics.warning(); setLobbyError(data.error || 'Could not join');
    }
    setLobbyLoading(false);
  }

  async function leaveTeam() {
    if (!profile || !myTeam) return;
    log('leaveTeam: leaving', myTeam.name);
    const teamId = myTeam.id;

    // Clear local state first so the next broadcast doesn't trigger kicked
    saveTeamMembership(null);
    setMyTeam(null);
    setKicked(false);
    setShowTeamPanel(false);

    // Reconnect WS without teamId BEFORE calling leave API
    // so the server's client record is updated before the broadcast
    connect(profile, null);

    // Then call the leave API
    const r = await fetch('/api/teams', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, action: 'leave', userId: profile.id }),
    });
    if (!r.ok) log('leaveTeam: API error', await r.text());

    haptics.click();
    setScreen('lobby');
    window.location.reload(); // full reload to clear any lingering state from team
  }

  async function toggleDone(challengeId) {
    if (!myTeam) return;
    const isDone = myTeam.doneIds?.includes(challengeId);
    isDone ? haptics.undone() : haptics.done();
    await fetch('/api/teams', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: myTeam.id, action: 'markDone', challengeId, done: !isDone }),
    });
  }

  async function renameTeam(e) {
    e.preventDefault();
    if (!newTeamNameEdit.trim() || !myTeam || !profile) return;
    setRenameError('');
    const r = await fetch('/api/teams', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: myTeam.id, action: 'rename', userId: profile.id, name: newTeamNameEdit }),
    });
    if (r.ok) { haptics.success(); setEditingTeamName(false); }
    else { const d = await r.json(); setRenameError(d.error || 'Failed'); haptics.warning(); }
  }

  async function toggleLock() {
    if (!myTeam || !profile) return;
    await fetch('/api/teams', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: myTeam.id, action: 'toggleLock', userId: profile.id }),
    });
    haptics.click();
  }

  function copyJoinLink() {
    if (!myTeam) return;
    const url = `${window.location.origin}/?code=${myTeam.code}`;
    navigator.clipboard.writeText(url).then(() => {
      haptics.success();
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }

  // ── SCREENS ────────────────────────────────────────────────────────

  if (screen === 'loading' || !game) return (
    <div className={styles.loading}>
      <div className={styles.loadingText}>{wsStatus === 'connecting' ? 'CONNECTING...' : 'RECONNECTING...'}</div>
    </div>
  );

  // PROFILE SETUP
  if (screen === 'profile') return (
    <div className={styles.setupWrap}>
      <div className={styles.setupBox}>
        <div className={styles.setupLogo}>⬡</div>
        <h1 className={styles.setupTitle}>WHO ARE YOU?</h1>
        <p className={styles.setupSub}>SET UP YOUR PLAYER PROFILE</p>
        <form onSubmit={submitProfile} className={styles.setupForm}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>YOUR NAME</label>
            <input className={styles.fieldInput} type="text" maxLength={15}
              placeholder="Best to use your real name"
              value={nameInput} onChange={e => setNameInput(e.target.value)} required autoFocus />
            <span className={styles.fieldHint}>Use your real name — teammates will see this</span>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>BIO <span className={styles.optional}>(optional)</span></label>
            <input className={styles.fieldInput} type="text" maxLength={80}
              placeholder="e.g. The driver" value={bioInput}
              onChange={e => setBioInput(e.target.value)} />
          </div>
          <button className={styles.primaryBtn} type="submit">CONTINUE</button>
        </form>
      </div>
    </div>
  );

  // PROFILE + JOIN (combined — arrives via share link)
  if (screen === 'profile_join') {
    const joiningTeam = (game?.teams || []).find(t => t.code === joinCode.toUpperCase());
    return (
      <div className={styles.setupWrap}>
        <div className={styles.setupBox}>
          <div className={styles.setupLogo}>⬡</div>
          <h1 className={styles.setupTitle}>YOU'RE INVITED</h1>
          {joiningTeam
            ? <p className={styles.setupSub}>JOINING: {joiningTeam.name.toUpperCase()}</p>
            : <p className={styles.setupSub}>CODE: {joinCode.toUpperCase()}</p>}
          <form onSubmit={submitProfileJoin} className={styles.setupForm}>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>YOUR NAME</label>
              <input className={styles.fieldInput} type="text" maxLength={15}
                placeholder="Use your real name so teammates recognise you"
                value={nameInput} onChange={e => setNameInput(e.target.value)} required autoFocus />
              <span className={styles.fieldHint}>Use your real name — teammates will see this</span>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>BIO <span className={styles.optional}>(optional)</span></label>
              <input className={styles.fieldInput} type="text" maxLength={80}
                placeholder="e.g. The navigator" value={bioInput}
                onChange={e => setBioInput(e.target.value)} />
            </div>
            <button className={styles.primaryBtn} type="submit">
              JOIN {joiningTeam ? joiningTeam.name.toUpperCase() : 'TEAM'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // LOBBY
if (screen === 'lobby') {
  const teams = game.teams || [];
  const canCreate = game.teamMode?.allowUserCreate !== false;

  // Auto reload after 10 seconds if kicked
  if (kicked) {
    setTimeout(() => {
      window.location.reload();
    }, 10000);
  }

  return (
    <div className={styles.lobbyWrap}>
      <header className={styles.header}>
  <div className={styles.headerTitle}>
    <span className={styles.titleFull}>⬡ SCAVENGER HUNT</span>
    <span className={styles.titleShort}>⬡</span>
  </div>

        <div
          className={styles.profilePill}
          onClick={() => {
            setNameInput(profile?.name || '');
            setBioInput(profile?.bio || '');
            setEditingProfile(true);
          }}
        >
          {profile?.name}
        </div>
      </header>

      <main className={styles.lobbyMain}>
        {kicked && (
          <div className={styles.kickedBanner}>
            <p>⚠ You were removed from your team or the team was disbanded.</p>

            <button
              className={styles.joinBtn}
              onClick={() => {
                haptics.click();
                window.location.reload();
              }}
              style={{ marginTop: '4px' }}
            >
              OK
            </button>

            <p style={{ marginTop: '4px', opacity: 0.7 }}>
              Reloading automatically in 10 seconds...
            </p>
          </div>
        )}

        {!kicked ? (
          <>
            <h1 className={styles.lobbyTitle}>TEAMS</h1>
            <p className={styles.lobbySub}>
              {teams.length} / {game.teamMode?.maxTeams || 8} TEAMS
            </p>

            <div className={styles.lobbyTabs}>
              <button
                className={`${styles.lobbyTab} ${
                  lobbyTab === 'list' ? styles.lobbyTabActive : ''
                }`}
                onClick={() => {
                  haptics.click();
                  setLobbyTab('list');
                  setLobbyError('');
                }}
              >
                ALL TEAMS
              </button>

              {canCreate && (
                <button
                  className={`${styles.lobbyTab} ${
                    lobbyTab === 'create' ? styles.lobbyTabActive : ''
                  }`}
                  onClick={() => {
                    haptics.click();
                    setLobbyTab('create');
                    setLobbyError('');
                  }}
                >
                  + CREATE
                </button>
              )}

              <button
                className={`${styles.lobbyTab} ${
                  lobbyTab === 'code' ? styles.lobbyTabActive : ''
                }`}
                onClick={() => {
                  haptics.click();
                  setLobbyTab('code');
                  setLobbyError('');
                }}
              >
                🔑 JOIN BY CODE
              </button>
            </div>

            {lobbyError && (
              <p className={styles.lobbyError}>{lobbyError}</p>
            )}

            {lobbyTab === 'list' && (
              <div className={styles.teamList}>
                {teams.length === 0 && (
                  <div className={styles.emptyTeams}>
                    {canCreate
                      ? 'No teams yet — create one!'
                      : 'No teams yet — wait for the admin to set them up.'}
                  </div>
                )}

                {teams.map((t) => (
                  <div key={t.id} className={styles.teamCard}>
                    <div className={styles.teamCardLeft}>
                      <div className={styles.teamCardNameRow}>
                        <span className={styles.teamCardName}>
                          {t.name}
                        </span>

                        {t.locked ? (
                          <span className={styles.teamCardLock}>
                            🔒 BY CODE
                          </span>
                        ) : (
                          <span className={styles.teamCardOpen}>
                            🔓 OPEN
                          </span>
                        )}
                      </div>

                      <span className={styles.teamCardMembers}>
                        {t.members.length} member
                        {t.members.length !== 1 ? 's' : ''}
                      </span>

                      <div className={styles.teamMemberPills}>
                        {t.members.map((m) => (
                          <span
                            key={m.id}
                            className={`${styles.memberPill} ${
                              m.id === t.leaderId
                                ? styles.leaderPill
                                : ''
                            }`}
                          >
                            {m.id === t.leaderId ? '★ ' : ''}
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {!t.locked && (
                      <button
                        className={styles.joinBtn}
                        disabled={lobbyLoading}
                        onClick={() => {
                          haptics.tap();
                          joinTeam(t);
                        }}
                      >
                        JOIN
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {lobbyTab === 'create' && canCreate && (
              <form onSubmit={createTeam} className={styles.createForm}>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>TEAM NAME</label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    maxLength={32}
                    placeholder="e.g. The Chaos Crew"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <p className={styles.createNote}>
                  You'll be the team leader. Team starts locked — share your code
                  for others to join.
                </p>

                <button
                  className={styles.primaryBtn}
                  type="submit"
                  disabled={lobbyLoading}
                >
                  {lobbyLoading ? 'CREATING...' : 'CREATE TEAM'}
                </button>
              </form>
            )}

            {lobbyTab === 'code' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = joinCode.toUpperCase().trim();
                  const team = (game.teams || []).find(
                    (t) => t.code === code
                  );
                  if (!team) {
                    setLobbyError('No team with that code');
                    return;
                  }
                  joinTeam(team, code);
                }}
                className={styles.createForm}
              >
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel}>TEAM CODE</label>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    maxLength={5}
                    placeholder="5-letter code"
                    value={joinCode}
                    onChange={(e) =>
                      setJoinCode(e.target.value.toUpperCase())
                    }
                    required
                    autoFocus
                  />
                </div>

                <button
                  className={styles.primaryBtn}
                  type="submit"
                  disabled={lobbyLoading}
                >
                  JOIN
                </button>
              </form>
            )}
          </>
        ) : (
          <div className={styles.emptyTeams}>
            Team lobby is unavailable right now.
          </div>
        )}
      </main>

      {editingProfile && (
        <div
          className={styles.overlay}
          onClick={() => setEditingProfile(false)}
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTop}>
              <span className={styles.modalNum}>EDIT PROFILE</span>
              <button
                className={styles.closeBtn}
                onClick={() => setEditingProfile(false)}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={saveProfileEdit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                padding: '16px 0 4px',
              }}
            >
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>YOUR NAME</label>
                <input
                  className={styles.fieldInput}
                  type="text"
                  maxLength={15}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  required
                />
                <span className={styles.fieldHint}>Use your real name</span>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>
                  BIO <span className={styles.optional}>(optional)</span>
                </label>
                <input
                  className={styles.fieldInput}
                  type="text"
                  maxLength={80}
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                />
              </div>

              <button className={styles.primaryBtn} type="submit">
                SAVE
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

  // GAME
  const { timer, rules, requirements, disqualifications, challenges, challengesHidden } = game;
  const secs = timer.secondsRemaining;
  const doneIds = myTeam?.doneIds || [];
  const isLeader = myTeam && profile && myTeam.leaderId === profile.id;

  let visible = challenges.filter(c => {
    const matchType = filter === 'all' || c.type === filter;
    const q = search.toLowerCase();
    return matchType && (!q || c.desc.toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q));
  });
  if (showDoneFirst) visible = [...visible.filter(c => !doneIds.includes(c.id)), ...visible.filter(c => doneIds.includes(c.id))];

  const timerClass = !timer.started ? styles.timerIdle : timer.paused ? styles.timerPaused : timer.expired ? styles.timerExpired : '';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
  <div className={styles.headerTitle}>
    <span className={styles.titleFull}>⬡ SCAVENGER HUNT</span>
    <span className={styles.titleShort}>⬡</span>
  </div>

  <div className={styles.headerPills}>
    {profile && (
      <div
        className={styles.profilePill}
        onClick={() => {
          setNameInput(profile.name);
          setBioInput(profile.bio || '');
          setEditingProfile(true);
        }}
      >
        {profile.name}
      </div>
    )}

    {myTeam && (
      <button
        className={styles.teamPill}
        onClick={() => {
          haptics.tap();
          setShowTeamPanel(true);
        }}
      >
        {myTeam.name} · {myTeam.members.length}
      </button>
    )}
  </div>

  <div className={`${styles.timer} ${timerClass}`}>
    {!timer.started ? 'WAITING' : formatTime(secs)}
  </div>
</header>

      <main className={styles.main}>
        <div className={styles.briefHeader}><span className={styles.briefLabel}>// MISSION BRIEFING</span></div>
        <h1 className={styles.briefTitle}>RULES &amp;<br />REGS</h1>
        <p className={styles.briefSub}>READ BEFORE YOU ROLL. IGNORANCE IS NOT AN EXCUSE.</p>

        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <h3 className={styles.infoCardTitle}>General Rules</h3>
            <ul className={styles.infoList}>{rules.map((r, i) => <li key={i}>{linkify(r)}</li>)}</ul>
          </div>
          <div className={`${styles.infoCard} ${styles.blue}`}>
            <h3 className={styles.infoCardTitle}>Requirements</h3>
            <ul className={styles.infoList}>{requirements.map((r, i) => <li key={i}>{linkify(r)}</li>)}</ul>
            <h3 className={`${styles.infoCardTitle} ${styles.spaced}`}>Challenge Types</h3>
            <ul className={styles.infoList}>
              {Object.entries(CHALLENGE_TYPES).map(([k, v]) => (
                <li key={k}><strong style={{ color: v.color }}>{k.toUpperCase()}</strong> — {v.desc}</li>
              ))}
            </ul>
          </div>
          <div className={`${styles.infoCard} ${styles.danger}`}>
            <h3 className={styles.infoCardTitle}>Disqualifications</h3>
            <ul className={styles.infoList}>{disqualifications.map((d, i) => <li key={i}>{linkify(d)}</li>)}</ul>
            <p className={styles.forfeit}>VIOLATIONS = FORFEIT OF PRIZE</p>
          </div>
        </div>

        <div className={styles.sectionRow}>
          <h2 className={styles.sectionTitle}>CHALLENGES</h2>
          <div className={styles.line} />
          <span className={styles.count}>
            {challengesHidden ? (timer.expired ? 'TIME EXPIRED' : 'HIDDEN UNTIL START') : `${visible.length} / ${challenges.length}`}
          </span>
        </div>

        {challengesHidden ? (
          <div className={styles.hiddenMsg}>
            <div className={styles.hiddenIcon}>{timer.expired ? '🏁' : '⏳'}</div>
            <p className={styles.hiddenText}>{timer.expired ? 'TIME IS UP — CHALLENGES ARE NOW HIDDEN' : 'CHALLENGES WILL BE REVEALED WHEN THE TIMER STARTS'}</p>
          </div>
        ) : (
          <>
            <div className={styles.controls}>
              <input className={styles.search} type="text" placeholder="SEARCH CHALLENGES..."
                value={search} onChange={e => setSearch(e.target.value)} />
              <div className={styles.filters}>
                {['all','action','picture','grab'].map(f => (
                  <button key={f}
                    className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''} ${f !== 'all' ? styles[f] : ''}`}
                    onClick={() => { haptics.click(); setFilter(f); }}>
                    {f === 'all' ? 'All' : `⬤ ${f}`}
                  </button>
                ))}
                <button className={`${styles.filterBtn} ${showDoneFirst ? styles.filterDone : ''}`}
                  onClick={() => { haptics.click(); setShowDoneFirst(x => !x); }}>↑ NOT DONE FIRST</button>
              </div>
            </div>
            <div className={styles.grid}>
              {visible.length === 0 ? <div className={styles.empty}>NO CHALLENGES MATCH</div>
                : visible.map(c => {
                  const done = doneIds.includes(c.id);
                  return (
                    <div key={c.id}
                      className={`${styles.card} ${styles[c.type]} ${done ? styles.cardDone : ''}`}
                      onClick={() => { haptics.tap(); setSelected(c); }}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && (haptics.tap(), setSelected(c))}>
                      <div className={styles.cardTop}>
                        <span className={styles.cardNum}>#{String(c.id).padStart(2,'0')}</span>
                        <span className={`${styles.badge} ${styles[c.type]}`}>{c.type}</span>
                        {done && <span className={styles.doneTag}>✓ DONE</span>}
                      </div>
                      {c.image && <div className={styles.cardImg}><img src={`/images/${c.image}`} alt="" /></div>}
                      <p className={styles.cardDesc}>{c.desc}</p>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardPts}>{c.pts}<span>PTS</span></span>
                        {c.note && <span className={styles.cardNote}>{c.note}</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </main>

      <footer className={styles.footer}>
        JUDGES' DECISIONS ARE FINAL &nbsp;·&nbsp; HAVE FUN OUT THERE &nbsp;·&nbsp; ⬡
        {wsStatus !== 'connected' && <span className={styles.wsStatus}> · {wsStatus.toUpperCase()}</span>}
      </footer>

      {/* CHALLENGE MODAL */}
      {selected && (
        <div className={styles.overlay} onClick={() => { haptics.click(); setSelected(null); }}>
          <div className={`${styles.modal} ${styles[selected.type]}`} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTop}>
              <span className={styles.modalNum}>CHALLENGE #{String(selected.id).padStart(2,'00')}</span>
              <button className={styles.closeBtn} onClick={() => { haptics.click(); setSelected(null); }}>✕</button>
            </div>
            {selected.image && <div className={styles.modalImg}><img src={`/images/${selected.image}`} alt="" /></div>}
            <span className={`${styles.badge} ${styles[selected.type]}`}>{selected.type}</span>
            <p className={styles.modalDesc}>{linkify(selected.desc)}</p>
            <div className={styles.modalPtsRow}>
              <span className={styles.modalPts}>{selected.pts}</span>
              <span className={styles.modalPtsLabel}>POINTS</span>
            </div>
            <div className={styles.modalDivider} />
            <div className={styles.modalTypeRule}>
              <span className={styles.modalTypeLabel}>// HOW THIS TYPE WORKS</span>
              <p className={styles.modalTypeDesc}>{CHALLENGE_TYPES[selected.type]?.desc}</p>
            </div>
            {selected.note && (
              <div className={styles.modalNote}>
                <span className={styles.modalNoteLabel}>JUDGE NOTE</span>
                <span className={styles.modalNoteText}>{linkify(selected.note)}</span>
              </div>
            )}
            <button
              className={`${styles.doneBtn} ${doneIds.includes(selected.id) ? styles.doneBtnActive : ''}`}
              onClick={() => toggleDone(selected.id)}>
              {doneIds.includes(selected.id) ? '✓ MARKED AS DONE' : 'MARK AS DONE'}
            </button>
            <p className={styles.modalHint}>CLICK OUTSIDE OR PRESS ESC TO CLOSE</p>
          </div>
        </div>
      )}

      {/* TEAM PANEL */}
      {showTeamPanel && myTeam && (
        <div className={styles.overlay} onClick={() => { haptics.click(); setShowTeamPanel(false); }}>
          <div className={styles.teamPanel} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTop}>
              {editingTeamName && isLeader ? (
                <form onSubmit={renameTeam} className={styles.inlineRename}>
                  <input className={styles.renameInput} value={newTeamNameEdit}
                    onChange={e => setNewTeamNameEdit(e.target.value)} autoFocus maxLength={32} />
                  <button type="submit" className={styles.renameSubmit}>✓</button>
                  <button type="button" className={styles.renameCancel} onClick={() => { setEditingTeamName(false); setRenameError(''); }}>✕</button>
                </form>
              ) : (
                <div className={styles.teamPanelName}>
                  {myTeam.name}
                  {isLeader && (
                    <button className={styles.editNameBtn} onClick={() => { setNewTeamNameEdit(myTeam.name); setEditingTeamName(true); setRenameError(''); }}>✎</button>
                  )}
                </div>
              )}
              <button className={styles.closeBtn} onClick={() => { haptics.click(); setShowTeamPanel(false); }}>✕</button>
            </div>
            {renameError && <p className={styles.renameError}>{renameError}</p>}

            {/* Code + lock + share */}
            <div className={styles.teamCodeRow}>
              <span className={styles.teamCodeLabel}>CODE</span>
              <span className={styles.teamCode}>{myTeam.code}</span>
              <div className={styles.teamActions}>
                {isLeader && (
                  <button className={styles.lockBtn} onClick={toggleLock}>
                    {myTeam.locked ? '🔒 LOCKED' : '🔓 OPEN'}
                  </button>
                )}
                {isLeader && (
                  <button className={`${styles.copyLinkBtn} ${copySuccess ? styles.copyLinkSuccess : ''}`} onClick={copyJoinLink}>
                    {copySuccess ? '✓ COPIED!' : '⎘ SHARE LINK'}
                  </button>
                )}
              </div>
            </div>

            {/* Score */}
            <div className={styles.teamScore}>
              <span className={styles.teamScoreNum}>
                {challenges.filter(c => myTeam.doneIds?.includes(c.id)).reduce((sum, c) => sum + c.pts, 0)}
              </span>
              <span className={styles.teamScoreLabel}>PTS · {myTeam.doneIds?.length || 0} done</span>
            </div>

            {/* Members */}
            <div className={styles.memberList}>
              <div className={styles.memberListLabel}>MEMBERS ({myTeam.members.length})</div>
              {myTeam.members.map(m => (
                <div key={m.id} className={styles.memberRow}>
                  <div className={styles.memberInfo}>
                    <span className={styles.memberName}>
                      {m.id === myTeam.leaderId && <span className={styles.starIcon}>★ </span>}
                      {m.name}
                      {m.id === profile?.id && <span className={styles.youTag}> (you)</span>}
                    </span>
                    {m.bio && <span className={styles.memberBio}>{m.bio}</span>}
                  </div>
                </div>
              ))}
            </div>

            <button className={styles.leaveBtn} onClick={leaveTeam}>LEAVE TEAM</button>
          </div>
        </div>
      )}

      {/* PROFILE EDIT */}
      {editingProfile && (
        <div className={styles.overlay} onClick={() => setEditingProfile(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTop}>
              <span className={styles.modalNum}>EDIT PROFILE</span>
              <button className={styles.closeBtn} onClick={() => setEditingProfile(false)}>✕</button>
            </div>
            <form onSubmit={saveProfileEdit} style={{ display:'flex', flexDirection:'column', gap:'14px', padding:'16px 0 4px' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>YOUR NAME</label>
                <input className={styles.fieldInput} type="text" maxLength={15} value={nameInput} onChange={e => setNameInput(e.target.value)} required />
                <span className={styles.fieldHint}>Use your real name</span>
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>BIO <span className={styles.optional}>(optional)</span></label>
                <input className={styles.fieldInput} type="text" maxLength={80} value={bioInput} onChange={e => setBioInput(e.target.value)} />
              </div>
              <button className={styles.primaryBtn} type="submit">SAVE</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
