const base_url = new URL("https://api.inaturalist.org/v2/")

function encode_rison(obj) {
  // Simple base cases
  if (obj === null) return '!n';
  if (obj === true) return '!t';
  if (obj === false) return '!f';

  const type = typeof obj;

  if (type === 'number') { // Make sure number is valid
    return Number.isFinite(obj) ? String(obj) : '!n';
  }

  if (type === 'string') { // Ensure this is a valid RISON string before converting format
    const idRegex = /^[a-zA-Z_.\-/~][a-zA-Z0-9_.\-/~]*\$/;
    if (idRegex.test(obj) && obj !== 'true' && obj !== 'false' && obj !== 'null') {
      return obj;
    }
    return `'${obj.replace(/[!']/g, '!$&')}'`;
  }

  if (Array.isArray(obj)) { // Convert to RISON array
    const parts = obj.map(item => encode_rison(item));
    return `!(${parts.join(',')})`;
  }

  if (type === 'object') {
    const keys = Object.keys(obj).sort(); // Lexical key sort
    const parts = keys.map(key => { // Recursively encode fields
      const encodedKey = encode_rison(key);
      return `${encodedKey}:${encode_rison(obj[key])}`;
    });
    return `(${parts.join(',')})`;
  }

  return '!n'; // Return null if unsupported
}

// iNaturalist asks for about 1 request per second: https://www.inaturalist.org/pages/api+recommended+practices
const MIN_REQUEST_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let next_request_at = 0;

// Reserve the next free request slot and wait for it, so even overlapping calls stay spaced out
async function throttle() {
  const now = Date.now();
  const wait = next_request_at - now;
  next_request_at = Math.max(now, next_request_at) + MIN_REQUEST_INTERVAL_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

// Cache responses per browser tab so refreshes and back-navigation don't re-hit the API.
// Storage can be unavailable (private mode, full quota), so failures just skip the cache.
function cache_get(key) {
  try {
    const entry = JSON.parse(sessionStorage.getItem(key));
    if (entry && Date.now() - entry.time < CACHE_TTL_MS) return entry.data;
  } catch (err) {}
  return null;
}

function cache_set(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ time: Date.now(), data: data }));
  } catch (err) {}
}

async function inat_request(path,resp_fields,params) {
  const searchUrl = new URL(path, base_url);
  searchUrl.searchParams.append("fields",encode_rison(resp_fields))
  Object.entries(params).forEach(([key, value]) => {
    searchUrl.searchParams.append(key, value);
  });

  const cache_key = "inat:" + searchUrl;
  const cached = cache_get(cache_key);
  if (cached) return cached;

  await throttle();
  return fetch(searchUrl)
  .then((response) => {
    if (!response.ok) { throw new Error(response.status+': '+response.statusText); };
    return response.json();
  })
  .then((json) => {
    cache_set(cache_key, json);
    return json;
  })
  .catch((err) => { console.error(err); });
};
