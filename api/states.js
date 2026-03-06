import { airtableList, envOrThrow } from "./_airtable";

function firstValue(v) {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  return [v];
}

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

    const states = records.map((record) => {
      const f = record.fields || {};

      return {
        id: record.id,
        state: firstValue(f.State),
        calculatedRiskLevel: firstValue(f["Calculated Risk Level"]) || firstValue(f["Risk Level"]) || "No Data",
        riskScoreTotal: Number(firstValue(f["Risk Score Total"]) || 0),
        entryCount: Number(firstValue(f["Entry Count"]) || 0),
        topRiskSignals: asArray(f["Top Risk Signals"]),
        gridRegions:
          asArray(f["Grid Regions (from Grid Regions)"]).length
            ? asArray(f["Grid Regions (from Grid Regions)"])
            : asArray(f["Grid Regions"]),
        summary: firstValue(f.Summary),
        lastUpdated: firstValue(f["Last Updated"]),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ states });
  } catch (err) {
    console.error("api/states error:", err);
    res.status(500).json({
      error: "States API failed",
      detail: String(err?.message || err)
    });
  }
}
