// Single source for the backend base URL. Historically ~40 files each recomputed
// this inline; a few drifted into a non-anchored `.replace('/api', '')` (mis-strips
// if the host itself contains "api", e.g. an "api.example.com" domain) or skipped
// normalization entirely and hit relative `/api/...` paths (only works behind the
// dev-server rewrite proxy — breaks in the packaged Electron desktop build, which
// has no such proxy). New code should import from here instead of recomputing it.
//
// Leave NEXT_PUBLIC_API_BASE unset and the API is taken to be on port 8000 of
// whatever host served the page, so an on-prem box whose DHCP address moves (or
// is reached by a .local name or an SSH tunnel) needs no rebuild. The server-side
// render has no window and falls back to localhost; fetches run in the browser.
const hostBase =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.protocol}//${window.location.hostname}:8000/api`
    : 'http://localhost:8000/api';
const envBase = process.env.NEXT_PUBLIC_API_BASE || hostBase;

// Backend URL, always ending in /api.
export const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

// Backend URL with the /api suffix stripped, for building /static/... asset URLs.
export const STATIC_BASE = API_BASE.replace(/\/api$/, '');
