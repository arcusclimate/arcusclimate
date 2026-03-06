import { airtableList, envOrThrow } from "./_airtable";

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_STATES_TABLE || "States";
    const viewName = process.env.AIRTABLE_STATES_VIEW || "Map API";

    const records = await airtableList({
      baseId,
      tableName,
      viewName,
      apiKey
    });

    const states = records.map(record => {
      const f = record.fields || {};
      return {
        id: record.id,
        state: f.State || "",
        calculatedRiskLevel: f["Calculated Risk Level"] || f["Risk Level"] || "No Data",
        riskScoreTotal: f["Risk Score Total"] ?? 0,
        entryCount: f["Entry Count"] ?? 0,
        topRiskSignals: f["Top Risk Signals"] || [],
        gridRegions: f["Grid Regions"] || [],
        summary: f.Summary || "",
        lastUpdated: f["Last Updated"] || ""
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ states });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
