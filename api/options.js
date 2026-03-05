import { airtableList, envOrThrow } from "./_airtable";

export default async function handler(req, res) {
  try {
    const apiKey = envOrThrow("AIRTABLE_API_KEY");
    const baseId = envOrThrow("AIRTABLE_BASE_ID");
    const tableName = process.env.AIRTABLE_OPTIONS_TABLE || "Filter Options";
    const viewName = process.env.AIRTABLE_OPTIONS_VIEW || "Active Options";

    const records = await airtableList({ baseId, tableName, viewName, apiKey });

    const options = records.map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        option: f.Option || "",
        group: f["Filter Group"] || "",
        key: f["Option Key"] || "",
        sortOrder: f["Sort Order"] ?? null,
        active: f.Active !== false, // default true if blank
      };
    });

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({ options });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
