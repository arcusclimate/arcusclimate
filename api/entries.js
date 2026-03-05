import { airtableList, envOrThrow } from "./_airtable.js";

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_ENTRIES_TABLE || "Entries";
    const viewName = process.env.AIRTABLE_ENTRIES_VIEW || "Map API";

    const records = await airtableList({ baseId, tableName, viewName, apiKey });

    const entries = records.map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        title: f.Title || "",
        summary: f.Summary || "",
        url: f.Link || "",
        publishedDate: f["Published Date"] || "",
        state: f["State (from State)"] || f.State || "",
        status: f.Status || "",
        category: f["Category (linked)"] ? String(f["Category (linked)"]) : (f.Category || ""),
        impact: f["Impact Level (linked)"] ? String(f["Impact Level (linked)"]) : (f["Impact Level"] || ""),
        signalType: f["Signal Type (linked)"] ? String(f["Signal Type (linked)"]) : (f["Signal Type"] || ""),
        signalDirection: f["Signal Direction (linked)"] ? String(f["Signal Direction (linked)"]) : (f["Signal Direction"] || ""),
        signalCategory: f["Signal Category"] || "",
        impactRank: f["Impact Rank"] ?? null,
        riskScore: f["Risk Score"] ?? null,
        filterKeys: (f["Filter Keys"] || "").toString(),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ entries });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
