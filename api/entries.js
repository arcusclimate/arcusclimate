import { airtableList, envOrThrow } from "./_airtable";

function firstValue(v) {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

function num(v) {
  const n = Number(firstValue(v));
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_ENTRIES_TABLE || "Entries";
    const viewName = process.env.AIRTABLE_ENTRIES_VIEW || "Map API";

    const records = await airtableList({ baseId, tableName, viewName, apiKey });

    const entries = records.map((record) => {
      const f = record.fields || {};

      return {
        id: record.id,
        title: firstValue(f.Title),
        summary: firstValue(f.Summary),
        link: firstValue(f.Link),
        publishedDate: firstValue(f["Published Date"]),
        state: firstValue(f["State Name"]), // <-- human-readable state name (first linked state)
        states: asArray(f["State Name"]),   // every linked state, so multi-state signals count everywhere
        dims: {
          grid: num(f["Dim: Grid"]),
          regulatory: num(f["Dim: Regulatory"]),
          water: num(f["Dim: Water"]),
          clean: num(f["Dim: Clean Energy"]),
          saturation: num(f["Dim: Saturation"]),
        },
        category: firstValue(f["Category (linked)"]) || firstValue(f.Category),
        impactLevel: firstValue(f["Impact Level (linked)"]) || firstValue(f["Impact Level"]),
        signalType: firstValue(f["Signal Type (linked)"]) || firstValue(f["Signal Type"]),
        signalDirection: firstValue(f["Signal Direction (linked)"]) || firstValue(f["Signal Direction"]),
        signalCategory: firstValue(f["Signal Category"]),
        impactRank: Number(firstValue(f["Impact Rank"]) || 999),
        sourceDomain: firstValue(f["Source Domain"]),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ entries });
  } catch (err) {
    console.error("api/entries error:", err);
    res.status(500).json({ error: "Entries API failed", detail: String(err?.message || err) });
  }
}
