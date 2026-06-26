import { airtableList, envOrThrow } from "./_airtable";

function firstValue(v) {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_TARIFFS_TABLE || "Tariffs";
    const viewName = process.env.AIRTABLE_TARIFFS_VIEW || "Map API";

    const records = await airtableList({ baseId, tableName, viewName, apiKey });

    const tariffs = records.map((record) => {
      const f = record.fields || {};

      return {
        id: record.id,
        state: firstValue(f["State Name"]) || firstValue(f.State),
        status: firstValue(f.Status) || firstValue(f["Tariff Status"]),
        tariffName: firstValue(f["Tariff Name"]) || firstValue(f.Name) || "",
        utility: firstValue(f.Utility) || "",
        effectiveDate: firstValue(f["Effective Date"]) || "",
        notes: firstValue(f.Notes) || "",
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ tariffs });
  } catch (err) {
    console.error("api/tariffs error:", err);
    res.status(500).json({ error: "Tariffs API failed", detail: String(err?.message || err) });
  }
}
