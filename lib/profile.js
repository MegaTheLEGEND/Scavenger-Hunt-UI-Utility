// Profile stored in localStorage
const KEY = 'sh_profile';

export function getProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (p?.id && p?.name) return p;
  } catch {}
  return null;
}

export function saveProfile(profile) {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function createProfile(name, bio = '') {
  const profile = {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    name: name.trim(),
    bio: bio.trim(),
    createdAt: new Date().toISOString(),
  };
  saveProfile(profile);
  return profile;
}

export function getTeamMembership() {
  try { return JSON.parse(localStorage.getItem('sh_team') || 'null'); } catch { return null; }
}

export function saveTeamMembership(teamId) {
  if (teamId) localStorage.setItem('sh_team', JSON.stringify({ teamId }));
  else localStorage.removeItem('sh_team');
}
