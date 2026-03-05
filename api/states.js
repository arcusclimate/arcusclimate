import { airtableList, envOrThrow } from "./_airtable";

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_STATES_TABLE || "States";
    const viewName = process.env.AIRTABLE_STATES_VIEW || "Map API";

    const records = await airtableList({ baseId, tableName, viewName, apiKey });

    const states = records.map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        state: f.State || f.state || "",
        calculatedRiskLevel: f["Calculated Risk Level"] || "",
        riskScoreTotal: f["Risk Score Total"] ?? 0,
        entryCount: f["Entry Count"] ?? 0,
        topRiskSignals: f["Top Risk Signals"] || [],
        lastUpdated: f["Last Updated"] || null,
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ states });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
