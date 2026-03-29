export const API_BASE =
  process.env.REACT_APP_API_URL || 'http://localhost:5056';

export async function registerUser({ email, password, name }) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: name || '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Registration failed');
  }
  return data;
}

export async function loginUser({ email, password }) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Login failed');
  }
  return data;
}

export async function fetchMe(token) {
  const res = await fetch(`${API_BASE}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Session invalid');
  }
  return data;
}

const STORAGE_KEY = 'zariya_auth';

export function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuth({ token, user }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}
