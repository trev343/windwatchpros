exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { email, code } = JSON.parse(event.body);
    if (!email || !code) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Missing email or code" }) };

    const baseUrl = "https://api.airtable.com/v0/appuT8I6375ZPeNh1/Companies";
    const atHeaders = {
      "Authorization": `Bearer ${process.env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    };

    const formula = encodeURIComponent(`LOWER({Email}) = "${email.toLowerCase().replace(/"/g, '')}"`);
    const findRes = await fetch(`${baseUrl}?filterByFormula=${formula}`, { headers: atHeaders });
    const findData = await findRes.json();

    if (!findData.records || !findData.records.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: "invalid" }) };
    }

    // The code lives on the first record for this email
    const holder = findData.records.find(r => r.fields["Verify Code"]);
    const validCode = holder && String(holder.fields["Verify Code"]) === String(code).trim();
    const notExpired = holder && holder.fields["Verify Code Expires"] &&
      new Date(holder.fields["Verify Code Expires"]) > new Date();

    if (!validCode || !notExpired) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: "invalid_or_expired" }) };
    }

    // Burn the code so it can't be reused
    await fetch(`${baseUrl}/${holder.id}`, {
      method: "PATCH",
      headers: atHeaders,
      body: JSON.stringify({ fields: { "Verify Code": "", "Verify Code Expires": null } })
    });

    // Return all of this customer's monitoring records
    const accounts = findData.records.map(r => ({
      record_id: r.id,
      company_name: r.fields["Company Name"] || "",
      zip_code: r.fields["Zip Code"] || "",
      wind_threshold_mph: r.fields["Wind Threshold (mph)"] || null,
      manager_phone: r.fields["Manager Phone"] || "",
      owner_phone: r.fields["Owner Phone"] || "",
      active: !!r.fields["Active"],
      alert_status: r.fields["Alert Status"] || "",
      snooze_until: r.fields["Snooze Until"] || ""
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, accounts }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
