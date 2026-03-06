import { airtableList, envOrThrow } from "./_airtable";

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

    const entries = records.map(record => {
      const f = record.fields || {};
      return {
        id: record.id,
        title: f.Title || "",
        summary: f.Summary || "",
        link: f.Link || "",
        publishedDate: f["Published Date"] || "",
        state:
          f["State (from State)"] ||
          (Array.isArray(f.State) ? f.State[0] : f.State) ||
          "",
        category:
          f["Category (linked)"] ||
          f.Category ||
          "",
        impactLevel:
          f["Impact Level (linked)"] ||
          f["Impact Level"] ||
          "",
        signalType:
          f["Signal Type (linked)"] ||
          f["Signal Type"] ||
          "",
        signalDirection:
          f["Signal Direction (linked)"] ||
          f["Signal Direction"] ||
          "",
        signalCategory:
          f["Signal Category"] ||
          "",
        impactRank:
          f["Impact Rank"] ?? 999,
        sourceDomain:
          f["Source Domain"] ||
          ""
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ entries });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ entries });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
