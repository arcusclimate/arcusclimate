import { airtableList, envOrThrow } from "./_airtable";

function firstValue(v) {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_TARIFFS_TABLE || "tblaGqx8ATslqyZ0h";

    const records = await airtableList({ baseId, tableName, apiKey });

    const tariffs = records.map((record) => {
      const f = record.fields || {};

      return {
        id: record.id,
        state: firstValue(f["State Name"]),
        status: firstValue(f["Status"]),
        tariffName: firstValue(f["Tariff Program Name"]) || "",
        utility: firstValue(f["Utility Name"]) || "",
        mwThreshold: f["MW Threshold"] || null,
        effectiveDate: firstValue(f["Effective Date"]) || "",
        costAllocationMethod: firstValue(f["Cost Allocation Method"]) || "",
        keyProvisions: firstValue(f["Key Provisions"]) || "",
        arcusAssessment: firstValue(f["Arcus Assessment"]) || "",
        sourceUrl: firstValue(f["Source URL"]) || "",
        lastVerified: firstValue(f["Last Verified"]) || "",
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ tariffs });
  } catch (err) {
    console.error("api/tariffs error:", err);
    res.status(500).json({ error: "Tariffs API failed", detail: String(err?.message || err) });
  }
}
