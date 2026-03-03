export default async function handler(req, res) {
  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE || "Entries";

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
      return res.status(500).json({ error: "Missing Airtable env vars" });
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
      AIRTABLE_TABLE
    )}?filterByFormula=${encodeURIComponent("{Status}='Published'")}`;

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }

    const data = await r.json();

    const out = (data.records || []).map((rec) => ({
      Title: rec.fields.Title || "",
      Summary: rec.fields.Summary || "",
      Link: rec.fields.Link || "",
      Date: rec.fields.Date || "",
      State: rec.fields.State || "",
      Status: rec.fields.Status || "",
    }));

    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
