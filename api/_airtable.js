export async function airtableList({ baseId, tableName, viewName, apiKey }) {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  if (viewName) url.searchParams.set("view", viewName);
  url.searchParams.set("pageSize", "100");

  const records = [];
  let offset = null;

  while (true) {
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error ${res.status}: ${text}`);
    }

    const json = await res.json();
    records.push(...(json.records || []));

    offset = json.offset;
    if (!offset) break;
  }

  return records;
}

export function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
