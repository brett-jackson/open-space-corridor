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

async function inat_request(path,resp_fields,params) {
  const searchUrl = new URL(path, base_url);
  searchUrl.searchParams.append("fields",encode_rison(resp_fields))
  Object.entries(params).forEach(([key, value]) => {
    searchUrl.searchParams.append(key, value);
  });
  return fetch(searchUrl)
  .then((response) => {
    if (!response.ok) { throw new Error(response.status+': '+response.statusText); };
    return response.json();
  })
  .catch((err) => { console.error(err); });
};