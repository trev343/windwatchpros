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
    const { phone, company_name, zip_codes, wind_threshold_mph } = JSON.parse(event.body);
    if (!phone) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Missing phone" }) };

    const zips = Array.isArray(zip_codes) ? zip_codes.join(", ") : zip_codes;
    const msg = `🌬️ Welcome to Wind Watch Pro! We're now monitoring zip ${zips} for ${company_name}. You'll get a text here if winds exceed ${wind_threshold_mph} mph. When an alert arrives, tap the link in it to confirm & pause that location's alerts for 8 hrs. Save this number!`;

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const smsBody = new URLSearchParams({
      To: phone,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: msg
    });

    const twRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: smsBody
    });

    if (!twRes.ok) {
      const twErr = await twRes.json();
      return { statusCode: 502, headers, body: JSON.stringify({ success: false, error: twErr.message || "SMS failed" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
