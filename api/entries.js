import { airtableList, envOrThrow } from "./_airtable";

function firstValue(v) {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_ENTRIES_TABLE || "Entries";
    const viewName = process.env.AIRTABLE_ENTRIES_VIEW || "Map API";

    const records = await airtableList({
      baseId,
      tableName,
      viewName,
      apiKey
    });

    const entries = records.map((record) => {
      const f = record.fields || {};

      return {
        id: record.id,
        title: firstValue(f.Title),
        summary: firstValue(f.Summary),
        link: firstValue(f.Link),
        publishedDate: firstValue(f["Published Date"]),
        state:
          firstValue(f["State (from State)"]) ||
          firstValue(f["State Name"]) ||
          firstValue(f.State),

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
    res.status(500).json({
      error: "Entries API failed",
      detail: String(err?.message || err)
    });
  }
}
