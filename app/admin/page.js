'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './admin.module.css';
import { haptics } from '../../lib/haptics';

const TYPES = ['action', 'picture', 'grab'];
const EMPTY_FORM = { type: 'action', pts: '', desc: '', note: '', image: '' };

function formatTime(secs) {
  const abs = Math.abs(Math.round(secs));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const str = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return secs < 0 ? `-${str}` : str;
}

export default function AdminPage() {
  const [authed, setAuthed]         = useState(false);
  const [loginErr, setLoginErr]     = useState('');
  const [creds, setCreds]           = useState({ username: '', password: '' });
  const [game, setGame]             = useState(null);
  const [tab, setTab]               = useState('challenges');
  const [search, setSearch]         = useState('');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [newAdminTeamName, setNewAdminTeamName] = useState('');
  const [adminTeamError, setAdminTeamError] = useState('');
  const [aboutUser, setAboutUser] = useState(null);
  const [assigningUser, setAssigningUser] = useState(null); // { userId, userName, bio }
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  // Challenge form
  const [showForm, setShowForm]     = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [imgPreview, setImgPreview] = useState('');
  const [saving, setSaving]         = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const fileRef = useRef();

  // Import
  const [showImport, setShowImport]     = useState(false);
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importFileRef = useRef();

  // Rules editing
  const [editingRules, setEditingRules] = useState(false);
  const [rulesForm, setRulesForm]       = useState({ rules: [], requirements: [], disqualifications: [] });

  // Timer editing
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationInput, setDurationInput]     = useState('120');

  // ── WebSocket ──
  const connect = useCallback(() => {
    // Don't open a second connection if one already exists
    if (wsRef.current && wsRef.current.readyState <= 1) return wsRef.current;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?role=admin`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state' || msg.type === 'tick' || msg.type === 'ping') {
        if (msg.data) setGame(msg.data);
        if (msg.connectedUsers) setConnectedUsers(msg.connectedUsers);
      }
    };
    ws.onclose = () => { wsRef.current = null; reconnectRef.current = setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
    return ws;
  }, []);

  // Check auth on load — connect WS if already authed
  useEffect(() => {
    fetch('/api/admin/game').then(r => {
      if (r.ok) { setAuthed(true); connect(); }
    }).catch(() => {});
    return () => { clearTimeout(reconnectRef.current); wsRef.current?.close(); };
  }, [connect]);

  async function api(body) {
    return fetch('/api/admin/game', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function login(e) {
    e.preventDefault(); setLoginErr('');
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (r.ok) { setAuthed(true); connect(); }
    else setLoginErr('Invalid credentials');
  }

  async function logout() {
    await fetch('/api/admin/login', { method: 'DELETE' });
    clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setAuthed(false); setGame(null);
  }

  // ── TIMER ──
  async function startTimer()  { haptics.timerStart(); await api({ action: 'startTimer', durationSeconds: Number(durationInput) * 60 }); }
  async function pauseTimer()  { haptics.timerPause(); await api({ action: 'pauseTimer' }); }
  async function resumeTimer() { haptics.timerResume(); await api({ action: 'resumeTimer' }); }
  async function stopTimer()   { haptics.timerStop(); await api({ action: 'stopTimer' }); }
  async function resetTimer()  { haptics.timerStop(); await api({ action: 'resetTimer', durationSeconds: Number(durationInput) * 60 }); }
  async function saveDuration() {
    haptics.click();
    await api({ action: 'editDuration', durationSeconds: Number(durationInput) * 60 });
    setEditingDuration(false);
  }

  // ── CHALLENGES ──
  function openNew() { setForm(EMPTY_FORM); setImgPreview(''); setEditingId(null); setShowForm(true); }
  function openEdit(c) {
    setForm({ type: c.type, pts: c.pts, desc: c.desc, note: c.note || '', image: c.image || '' });
    setImgPreview(c.image ? `/images/${c.image}` : '');
    setEditingId(c.id); setShowForm(true);
  }

  async function handleImageUpload(file) {
    if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    if (r.ok) {
      const { filename } = await r.json();
      setForm(f => ({ ...f, image: filename }));
      setImgPreview(`/images/${filename}`);
    }
  }

  async function saveChallenge(e) {
    e.preventDefault(); setSaving(true);
    const payload = { ...form, pts: Number(form.pts) };
    if (editingId !== null) await api({ challengeUpdate: { id: editingId, ...payload } });
    else await api({ challengeAdd: payload });
    haptics.success();
    setShowForm(false); setEditingId(null); setSaving(false);
  }

  async function deleteChallenge(id) {
    haptics.warning();
    await api({ challengeDelete: id }); setDeleteConfirm(null);
  }

  // ── IMPORT ──
  async function handleImport(file) {
    if (!file) return;
    setImporting(true); setImportResult(null);
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/api/admin/import', { method: 'POST', body: fd });
    const data = await r.json();
    data.ok ? haptics.success() : haptics.warning();
    setImportResult(data); setImporting(false);
  }

  // ── EXPORT ──
  function exportExcel() {
    window.location.href = '/api/admin/export';
  }

  // ── RULES ──
  function openRules() {
    setRulesForm({
      rules: [...(game.rules || [])],
      requirements: [...(game.requirements || [])],
      disqualifications: [...(game.disqualifications || [])],
    });
    setEditingRules(true);
  }

  async function saveRules(e) {
    e.preventDefault();
    await api({ rules: rulesForm.rules });
    await api({ requirements: rulesForm.requirements });
    await api({ disqualifications: rulesForm.disqualifications });
    setEditingRules(false);
  }

  function updateListItem(key, idx, val) {
    setRulesForm(f => { const a = [...f[key]]; a[idx] = val; return { ...f, [key]: a }; });
  }
  function addListItem(key)           { setRulesForm(f => ({ ...f, [key]: [...f[key], ''] })); }
  function removeListItem(key, idx)   { setRulesForm(f => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) })); }

  // ── LOGIN SCREEN ──
  if (!authed || !game) return (
    <div className={styles.loginWrap}>
      <div className={styles.loginBox}>
        <div className={styles.loginLogo}>⬡</div>
        <h1 className={styles.loginTitle}>ADMIN ACCESS</h1>
        <p className={styles.loginSub}>SCAVENGER HUNT CONTROL PANEL</p>
        <form onSubmit={login} className={styles.loginForm}>
          <div className={styles.field}>
            <label className={styles.label}>USERNAME</label>
            <input className={styles.input} type="text" autoComplete="username"
              value={creds.username} onChange={e => setCreds(c => ({ ...c, username: e.target.value }))} required />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>PASSWORD</label>
            <input className={styles.input} type="password" autoComplete="current-password"
              value={creds.password} onChange={e => setCreds(c => ({ ...c, password: e.target.value }))} required />
          </div>
          {loginErr && <p className={styles.loginErr}>{loginErr}</p>}
          <button className={styles.loginBtn} type="submit">ENTER</button>
        </form>
      </div>
    </div>
  );

  const { timer, challenges = [], rules = [], requirements = [], disqualifications = [] } = game;
  const secs = timer.secondsRemaining;

  const timerDisplayClass = !timer.started ? styles.timerIdle
    : timer.paused ? styles.timerPaused : '';

  const filteredChallenges = challenges.filter(c => {
    const q = search.toLowerCase();
    return !q || c.desc.toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q);
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>⬡ ADMIN</div>
        <div className={`${styles.timerDisplay} ${timerDisplayClass}`}>
          {!timer.started ? 'STOPPED' : timer.paused ? `⏸ ${formatTime(secs)}` : formatTime(secs)}
        </div>
        <nav className={styles.tabs}>
          {['challenges','rules','timer','teams','users'].map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}>{t.toUpperCase()}</button>
          ))}
        </nav>
        <a href="/" target="_blank" className={styles.viewSite}>↗ SITE</a>
        <button className={styles.logoutBtn} onClick={logout}>LOGOUT</button>
      </header>

      <main className={styles.main}>

        {/* ── TIMER TAB ── */}
        {tab === 'timer' && (
          <div className={styles.timerPanel}>
            <div className={`${styles.timerBig} ${timer.paused ? styles.timerBigPaused : timer.expired ? styles.timerBigExpired : ''}`}>
              {formatTime(secs)}
            </div>
            <div className={styles.timerStatus}>
              {!timer.started && '○ STOPPED — challenges hidden from players'}
              {timer.started && !timer.paused && !timer.expired && '● RUNNING — challenges visible to players'}
              {timer.started && !timer.paused && timer.expired && '● EXPIRED — counting negative, challenges hidden'}
              {timer.started && timer.paused && '⏸ PAUSED — challenges still visible'}
            </div>

            <div className={styles.timerControls}>
              <div className={styles.field}>
                <label className={styles.label}>DURATION (MINUTES)</label>
                <div className={styles.durationRow}>
                  <input className={styles.input} type="number" min="1" step="1"
                    value={durationInput}
                    onChange={e => setDurationInput(e.target.value)}
                    disabled={timer.started && !timer.paused && !editingDuration}
                  />
                  {timer.started && (
                    editingDuration
                      ? <button className={styles.saveDurBtn} onClick={saveDuration}>APPLY</button>
                      : <button className={styles.editDurBtn}
                          onClick={() => { setDurationInput(String(Math.max(1, Math.ceil(Math.abs(secs) / 60)))); setEditingDuration(true); }}>
                          EDIT TIME
                        </button>
                  )}
                </div>
              </div>

              <div className={styles.timerBtns}>
                {!timer.started && <button className={styles.startBtn} onClick={startTimer}>▶ START</button>}
                {timer.started && !timer.paused && <button className={styles.pauseBtn} onClick={pauseTimer}>⏸ PAUSE</button>}
                {timer.started && timer.paused && <button className={styles.resumeBtn} onClick={resumeTimer}>▶ RESUME</button>}
                {timer.started && <button className={styles.stopBtn} onClick={stopTimer}>■ STOP</button>}
                <button className={styles.resetBtn} onClick={resetTimer}>↺ RESET</button>
              </div>
            </div>

            <div className={styles.timerNote}>
              Start reveals challenges. Pause freezes clock (challenges stay visible).<br />
              Stop hides challenges. After time expires, clock goes negative and challenges hide.<br />
              Edit Time lets you adjust remaining time while paused.
            </div>
          </div>
        )}

        {/* ── RULES TAB ── */}
        {tab === 'rules' && (
          <div>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>RULES &amp; INFO</h2>
              <div className={styles.line} />
              <button className={styles.editRulesBtn} onClick={openRules}>EDIT</button>
            </div>
            {[
              { key: 'rules', label: 'General Rules', items: rules },
              { key: 'requirements', label: 'Requirements', items: requirements },
              { key: 'disqualifications', label: 'Disqualifications', items: disqualifications },
            ].map(({ key, label, items }) => (
              <div key={key} className={styles.ruleSection}>
                <h3 className={styles.ruleSectionTitle}>{label}</h3>
                <ul className={styles.ruleList}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
              </div>
            ))}
          </div>
        )}

        {/* ── TEAMS TAB ── */}
        {tab === 'teams' && (
          <div>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>TEAMS</h2>
              <div className={styles.line} />
              <span className={styles.countLabel}>{(game.teams||[]).length} / {game.teamMode?.maxTeams||8}</span>
            </div>

            {/* Team mode settings */}
            <div className={styles.teamSettings}>
              <div className={styles.teamSettingRow}>
                <div>
                  <div className={styles.teamSettingLabel}>TEAM MODE</div>
                  <div className={styles.teamSettingDesc}>When off, landing page skips team selection</div>
                </div>
                <button
                  className={`${styles.toggleBtn} ${game.teamMode?.enabled ? styles.toggleOn : ''}`}
                  onClick={async () => {
                    await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'setTeamMode', settings: { enabled: !game.teamMode?.enabled } }) });
                    haptics.click();
                  }}>
                  {game.teamMode?.enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className={styles.teamSettingRow}>
                <div>
                  <div className={styles.teamSettingLabel}>PLAYER-CREATED TEAMS</div>
                  <div className={styles.teamSettingDesc}>When off, only admin can create teams</div>
                </div>
                <button
                  className={`${styles.toggleBtn} ${game.teamMode?.allowUserCreate !== false ? styles.toggleOn : ''}`}
                  onClick={async () => {
                    await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'setTeamMode', settings: { allowUserCreate: game.teamMode?.allowUserCreate === false } }) });
                    haptics.click();
                  }}>
                  {game.teamMode?.allowUserCreate !== false ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className={styles.teamSettingRow}>
                <div><div className={styles.teamSettingLabel}>MAX TEAMS</div></div>
                <input type="number" min="1" max="32" className={styles.maxTeamsInput}
                  defaultValue={game.teamMode?.maxTeams || 8}
                  onBlur={async e => {
                    await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'setTeamMode', settings: { maxTeams: Number(e.target.value) } }) });
                  }} />
              </div>

              {/* Admin create team */}
              <div className={styles.adminCreateTeamRow}>
                <div className={styles.teamSettingLabel}>CREATE TEAM</div>
                <div className={styles.adminCreateTeamForm}>
                  <input className={`${styles.input} ${styles.adminTeamNameInput}`} type="text" maxLength={32}
                    placeholder="Team name..." value={newAdminTeamName}
                    onChange={e => { setNewAdminTeamName(e.target.value); setAdminTeamError(''); }} />
                  <button className={styles.adminCreateTeamBtn} onClick={async () => {
                    if (!newAdminTeamName.trim()) return;
                    const r = await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'createTeam', name: newAdminTeamName }) });
                    const d = await r.json();
                    if (r.ok) { haptics.success(); setNewAdminTeamName(''); setAdminTeamError(''); }
                    else { haptics.warning(); setAdminTeamError(d.error || 'Failed'); }
                  }}>CREATE</button>
                </div>
                {adminTeamError && <p className={styles.adminTeamError}>{adminTeamError}</p>}
              </div>

              <button className={styles.clearTeamsBtn} onClick={async () => {
                if (!confirm('Clear all teams? This cannot be undone.')) return;
                await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'clearAllTeams' }) });
                haptics.warning();
              }}>CLEAR ALL TEAMS</button>
            </div>

            {/* Team cards */}
            <div className={styles.adminTeamList}>
              {(game.teams||[]).length === 0 && (
                <div className={styles.emptyTeamsAdmin}>No teams yet. Players create them on the home page.</div>
              )}
              {(game.teams||[]).map(team => (
                <div key={team.id} className={styles.adminTeamCard}>
                  <div className={styles.adminTeamHeader}>
                    <div className={styles.adminTeamName}>{team.name}</div>
                    <div className={styles.adminTeamMeta}>
                      <span className={styles.teamCodeBadge}>{team.code}</span>
                      {team.locked && <span className={styles.lockedBadge}>🔒 LOCKED</span>}
                      <span className={styles.adminTeamPts}>
                        {(game.challenges||[]).filter(c => team.doneIds?.includes(c.id)).reduce((s,c)=>s+c.pts,0)} PTS
                      </span>
                    </div>
                    <button className={styles.removeTeamBtn} onClick={async () => {
                      if (!confirm(`Remove team "${team.name}"?`)) return;
                      await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'removeTeam', teamId: team.id }) });
                      haptics.warning();
                    }}>✕</button>
                  </div>
                  <div className={styles.adminMemberList}>
                    {team.members.map(m => (
                      <div key={m.id} className={styles.adminMemberRow}>
                        <span className={styles.adminMemberName}>
                          {m.id === team.leaderId && <span style={{color:'var(--accent-yellow)'}}>★ </span>}
                          {m.name}
                        </span>
                        {m.bio && <span className={styles.adminMemberBio}>{m.bio}</span>}
                        <div className={styles.adminMemberBtns}>
                          {m.id !== team.leaderId && (
                            <button className={styles.assignLeaderBtn} onClick={async () => {
                              await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'assignLeader', teamId: team.id, userId: m.id }) });
                              haptics.click();
                            }}>MAKE LEADER</button>
                          )}
                          <button className={styles.kickBtn} onClick={async () => {
                            await fetch('/api/admin/teams', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'removeMember', teamId: team.id, userId: m.id }) });
                            haptics.click();
                          }}>KICK</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>CONNECTED</h2>
              <div className={styles.line} />
              <span className={styles.countLabel}>{connectedUsers.length} ONLINE</span>
            </div>
            {connectedUsers.length === 0 ? (
              <div className={styles.emptyTeamsAdmin}>No players connected right now.</div>
            ) : (
              <div className={styles.userList}>
                {connectedUsers.map(u => {
                  const team = (game.teams || []).find(t => t.members.some(m => m.id === u.userId));
                  return (
                    <div key={u.userId} className={styles.userRow}>
                      <div className={styles.userInfo}>
                        <span className={styles.userName}>
                          {u.isAdmin && <span className={styles.adminBadge}>ADMIN </span>}
                          {u.userName}
                        </span>
                        {team
                          ? <span className={styles.userTeam}>
                              {team.name}{u.userId === team.leaderId ? ' ★' : ''}
                            </span>
                          : <span className={styles.userNoTeam}>No team</span>
                        }
                      </div>
                      <div className={styles.userBtns}>
                        {!u.isAdmin && (
                          <button className={styles.assignTeamBtn}
                            onClick={() => setAssigningUser(u)}>
                            ASSIGN TEAM
                          </button>
                        )}
                        <button className={styles.aboutBtn}
                          onClick={() => setAboutUser(u)}>
                          ABOUT
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── CHALLENGES TAB ── */}
        {tab === 'challenges' && (
          <div>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>CHALLENGES</h2>
              <div className={styles.line} />
              <span className={styles.countLabel}>{challenges.length} TOTAL</span>
              <button className={styles.exportBtn} onClick={exportExcel}>↓ EXPORT</button>
              <button className={styles.importBtn} onClick={() => { setShowImport(true); setImportResult(null); }}>↑ IMPORT</button>
            </div>

            <input className={styles.search} type="text" placeholder="SEARCH CHALLENGES..."
              value={search} onChange={e => setSearch(e.target.value)} />

            <div className={styles.grid}>
              <button className={styles.addCard} onClick={openNew}>
                <span className={styles.addIcon}>+</span>
                <span className={styles.addLabel}>ADD CHALLENGE</span>
              </button>
              {filteredChallenges.map(c => (
                <div key={c.id} className={`${styles.card} ${styles[c.type]}`}>
                  <div className={styles.cardTop}>
                    <span className={styles.cardNum}>#{String(c.id).padStart(2,'0')}</span>
                    <span className={`${styles.badge} ${styles[c.type]}`}>{c.type}</span>
                  </div>
                  {c.image && <div className={styles.cardThumb}><img src={`/images/${c.image}`} alt="" /></div>}
                  <p className={styles.cardDesc}>{c.desc}</p>
                  {c.note && <p className={styles.cardNote}>{c.note}</p>}
                  <div className={styles.cardFooter}>
                    <span className={styles.cardPts}>{c.pts}<span>PTS</span></span>
                    <div className={styles.cardActions}>
                      <button className={styles.editBtn} onClick={() => openEdit(c)}>EDIT</button>
                      <button className={styles.deleteBtn} onClick={() => setDeleteConfirm(c.id)}>✕</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── IMPORT MODAL ── */}
      {showImport && (
        <div className={styles.overlay} onClick={() => setShowImport(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>IMPORT FROM EXCEL</h2>
              <button className={styles.closeBtn} onClick={() => setShowImport(false)}>✕</button>
            </div>
            <div className={styles.importBody}>
              <p className={styles.importInfo}>
                Upload a challenge spreadsheet. All existing challenges will be replaced.
                Image URLs in the IMAGE column are downloaded automatically.
              </p>
              <a href="/challenge_template.xlsx" download className={styles.templateLink}>↓ DOWNLOAD TEMPLATE</a>
              <div className={`${styles.uploadArea} ${importing ? styles.uploading : ''}`}
                onClick={() => !importing && importFileRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleImport(e.dataTransfer.files[0]); }}>
                {importing
                  ? <div className={styles.uploadPlaceholder}><span className={styles.uploadIcon}>⟳</span><span>IMPORTING...</span></div>
                  : <div className={styles.uploadPlaceholder}><span className={styles.uploadIcon}>↑</span><span>CLICK OR DRAG .XLSX FILE HERE</span></div>}
              </div>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={e => handleImport(e.target.files[0])} />
              {importResult && (
                <div className={`${styles.importResult} ${importResult.ok ? styles.importOk : styles.importErr}`}>
                  {importResult.ok ? (
                    <>
                      <p>✓ Imported {importResult.imported} challenges</p>
                      {importResult.imagesDownloaded > 0 && <p>↓ Downloaded {importResult.imagesDownloaded} images</p>}
                      {importResult.skipped > 0 && <p>⚠ Skipped {importResult.skipped} invalid rows</p>}
                      {importResult.errors?.map((err, i) => <p key={i} className={styles.importErrLine}>✕ {err}</p>)}
                    </>
                  ) : <p>✕ {importResult.error}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CHALLENGE FORM MODAL ── */}
      {showForm && (
        <div className={styles.overlay} onClick={() => setShowForm(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{editingId !== null ? `EDIT #${String(editingId).padStart(2,'0')}` : 'NEW CHALLENGE'}</h2>
              <button className={styles.closeBtn} onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={saveChallenge} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>TYPE</label>
                <div className={styles.typeToggle}>
                  {TYPES.map(t => (
                    <button key={t} type="button"
                      className={`${styles.typeBtn} ${styles[t]} ${form.type === t ? styles.typeBtnActive : ''}`}
                      onClick={() => setForm(f => ({ ...f, type: t }))}>{t}</button>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>POINTS</label>
                <input className={styles.input} type="number" min="0" step="25" placeholder="e.g. 200"
                  value={form.pts} onChange={e => setForm(f => ({ ...f, pts: e.target.value }))} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>DESCRIPTION</label>
                <textarea className={`${styles.input} ${styles.textarea}`} rows={3}
                  placeholder="What does the team need to do?" value={form.desc}
                  onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} required />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>JUDGE NOTE <span className={styles.optional}>(optional)</span></label>
                <input className={styles.input} type="text" placeholder="e.g. Must be clearly visible"
                  value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>CONTEXT IMAGE <span className={styles.optional}>(optional)</span></label>
                <div className={styles.uploadArea} onClick={() => fileRef.current.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleImageUpload(e.dataTransfer.files[0]); }}>
                  {imgPreview
                    ? <img src={imgPreview} alt="preview" className={styles.preview} />
                    : <div className={styles.uploadPlaceholder}><span className={styles.uploadIcon}>↑</span><span>CLICK OR DRAG</span></div>}
                </div>
                {imgPreview && (
                  <button type="button" className={styles.clearImage}
                    onClick={() => { setImgPreview(''); setForm(f => ({ ...f, image: '' })); }}>REMOVE IMAGE</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => handleImageUpload(e.target.files[0])} />
              </div>
              <div className={styles.formFooter}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowForm(false)}>CANCEL</button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? 'SAVING...' : editingId !== null ? 'SAVE CHANGES' : 'ADD CHALLENGE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── RULES EDIT MODAL ── */}
      {editingRules && (
        <div className={styles.overlay} onClick={() => setEditingRules(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>EDIT RULES</h2>
              <button className={styles.closeBtn} onClick={() => setEditingRules(false)}>✕</button>
            </div>
            <form onSubmit={saveRules} className={styles.form}>
              {[
                { key: 'rules', label: 'General Rules' },
                { key: 'requirements', label: 'Requirements' },
                { key: 'disqualifications', label: 'Disqualifications' },
              ].map(({ key, label }) => (
                <div key={key} className={styles.field}>
                  <label className={styles.label}>{label}</label>
                  {rulesForm[key].map((item, idx) => (
                    <div key={idx} className={styles.ruleInputRow}>
                      <input className={styles.input} type="text" value={item}
                        onChange={e => updateListItem(key, idx, e.target.value)} />
                      <button type="button" className={styles.removeRuleBtn}
                        onClick={() => removeListItem(key, idx)}>✕</button>
                    </div>
                  ))}
                  <button type="button" className={styles.addRuleBtn} onClick={() => addListItem(key)}>+ ADD</button>
                </div>
              ))}
              <div className={styles.formFooter}>
                <button type="button" className={styles.cancelBtn} onClick={() => setEditingRules(false)}>CANCEL</button>
                <button type="submit" className={styles.saveBtn}>SAVE RULES</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {deleteConfirm !== null && (
        <div className={styles.overlay} onClick={() => setDeleteConfirm(null)}>
          <div className={styles.confirmBox} onClick={e => e.stopPropagation()}>
            <p className={styles.confirmText}>Delete challenge #{String(deleteConfirm).padStart(2,'0')}?</p>
            <p className={styles.confirmSub}>This cannot be undone.</p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setDeleteConfirm(null)}>CANCEL</button>
              <button className={styles.deleteConfirmBtn} onClick={() => deleteChallenge(deleteConfirm)}>DELETE</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ABOUT USER MODAL ── */}
      {aboutUser && (() => {
        const team = (game.teams || []).find(t => t.members.some(m => m.id === aboutUser.userId));
        const member = team?.members.find(m => m.id === aboutUser.userId);
        const ua = aboutUser.userAgent || '';
        // Parse device info from user agent
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        const isTablet = /iPad|Tablet/i.test(ua);
        const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|SamsungBrowser)\/[\d.]+/)?.[0]
          || ua.match(/(Chrome|Firefox|Safari|Edge|Opera)/)?.[0] || 'Unknown';
        const os = ua.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] || 'Unknown';
        const deviceType = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';

        return (
          <div className={styles.overlay} onClick={() => setAboutUser(null)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>{aboutUser.userName}</h2>
                <button className={styles.closeBtn} onClick={() => setAboutUser(null)}>✕</button>
              </div>
              <div className={styles.aboutBody}>
                {aboutUser.isAdmin && <div className={styles.aboutAdminBadge}>ADMIN</div>}

                <div className={styles.aboutSection}>
                  <div className={styles.aboutLabel}>PROFILE</div>
                  <div className={styles.aboutRow}><span>Name</span><span>{aboutUser.userName}</span></div>
                  {member?.bio && <div className={styles.aboutRow}><span>Bio</span><span>{member.bio}</span></div>}
                  <div className={styles.aboutRow}><span>User ID</span><span className={styles.aboutMono}>{aboutUser.userId}</span></div>
                </div>

                <div className={styles.aboutSection}>
                  <div className={styles.aboutLabel}>TEAM</div>
                  {team
                    ? <>
                        <div className={styles.aboutRow}><span>Team</span><span>{team.name}</span></div>
                        <div className={styles.aboutRow}><span>Role</span><span>{aboutUser.userId === team.leaderId ? '★ Leader' : 'Member'}</span></div>
                        <div className={styles.aboutRow}><span>Code</span><span className={styles.aboutMono}>{team.code}</span></div>
                      </>
                    : <div className={styles.aboutRow}><span>Team</span><span className={styles.aboutMuted}>None</span></div>
                  }
                </div>

                <div className={styles.aboutSection}>
                  <div className={styles.aboutLabel}>CONNECTION</div>
                  <div className={styles.aboutRow}><span>IP Address</span><span className={styles.aboutMono}>{aboutUser.ip}</span></div>
                  <div className={styles.aboutRow}><span>Connected</span><span>{new Date(aboutUser.connectedAt).toLocaleTimeString()}</span></div>
                  <div className={styles.aboutRow}><span>Last ping</span><span>{aboutUser.lastPing ? new Date(aboutUser.lastPing).toLocaleTimeString() : '—'}</span></div>
                </div>

                <div className={styles.aboutSection}>
                  <div className={styles.aboutLabel}>DEVICE</div>
                  <div className={styles.aboutRow}><span>Type</span><span>{deviceType}</span></div>
                  <div className={styles.aboutRow}><span>Browser</span><span>{browser}</span></div>
                  <div className={styles.aboutRow}><span>OS</span><span>{os}</span></div>
                  <div className={styles.aboutRow}><span>User Agent</span><span className={`${styles.aboutMono} ${styles.aboutUa}`}>{ua || 'Unknown'}</span></div>
                </div>

                {!aboutUser.isAdmin && (
                  <button className={styles.saveBtn} style={{ width: '100%', marginTop: '4px' }}
                    onClick={() => { setAboutUser(null); setAssigningUser(aboutUser); }}>
                    ASSIGN TO TEAM
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── ASSIGN TEAM MODAL ── */}
      {assigningUser && (
        <div className={styles.overlay} onClick={() => setAssigningUser(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>ASSIGN {assigningUser.userName.toUpperCase()}</h2>
              <button className={styles.closeBtn} onClick={() => setAssigningUser(null)}>✕</button>
            </div>
            <div className={styles.assignBody}>
              <p className={styles.assignHint}>Pick a team or create a new one for this player.</p>
              <div className={styles.assignTeamList}>
                {(game.teams || []).map(t => (
                  <button key={t.id} className={styles.assignTeamOption}
                    onClick={async () => {
                      await fetch('/api/admin/teams', {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'assignUserToTeam',
                          userId: assigningUser.userId,
                          userName: assigningUser.userName,
                          userBio: '',
                          teamId: t.id,
                        }),
                      });
                      haptics.success();
                      setAssigningUser(null);
                    }}>
                    <span className={styles.assignTeamName}>{t.name}</span>
                    <span className={styles.assignTeamCount}>{t.members.length} members</span>
                  </button>
                ))}
              </div>

              {/* Create new team for this user */}
              <div className={styles.assignNewTeam}>
                <div className={styles.aboutLabel}>CREATE NEW TEAM</div>
                <div className={styles.adminCreateTeamForm}>
                  <input className={`${styles.input} ${styles.adminTeamNameInput}`} type="text"
                    maxLength={32} placeholder="Team name..."
                    id="assign-new-team-input" />
                  <button className={styles.adminCreateTeamBtn} onClick={async () => {
                    const nameEl = document.getElementById('assign-new-team-input');
                    const name = nameEl?.value?.trim();
                    if (!name) return;

                    // Create team
                    const cr = await fetch('/api/admin/teams', {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'createTeam', name }),
                    });
                    if (!cr.ok) { haptics.warning(); return; }

                    // Fetch fresh teams list from the broadcast (game state via WS will update,
                    // but we need it immediately) — use the public teams endpoint
                    const tr = await fetch('/api/teams');
                    const td = await tr.json();
                    const newTeam = (td.teams || []).find(t => t.name.toLowerCase() === name.toLowerCase());
                    if (!newTeam) { haptics.warning(); return; }

                    // Assign user to the newly created team
                    await fetch('/api/admin/teams', {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'assignUserToTeam',
                        userId: assigningUser.userId,
                        userName: assigningUser.userName,
                        userBio: '',
                        teamId: newTeam.id,
                      }),
                    });
                    haptics.success();
                    setAssigningUser(null);
                  }}>CREATE + ASSIGN</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
