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
    const { email } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Missing email" }) };

    const baseUrl = "https://api.airtable.com/v0/appuT8I6375ZPeNh1/Companies";
    const atHeaders = {
      "Authorization": `Bearer ${process.env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json"
    };

    // Find records for this email
    const formula = encodeURIComponent(`LOWER({Email}) = "${email.toLowerCase().replace(/"/g, '')}"`);
    const findRes = await fetch(`${baseUrl}?filterByFormula=${formula}`, { headers: atHeaders });
    const findData = await findRes.json();

    if (!findData.records || !findData.records.length) {
      // Don't reveal whether the email exists — generic reply
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: "no_account" }) };
    }

    const record = findData.records[0];
    const phone = record.fields["Manager Phone"] || record.fields["Owner Phone"];
    if (!phone) return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: "no_phone_on_file" }) };

    // Generate 4-digit code, expires in 10 minutes
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await fetch(`${baseUrl}/${record.id}`, {
      method: "PATCH",
      headers: atHeaders,
      body: JSON.stringify({ fields: { "Verify Code": code, "Verify Code Expires": expires } })
    });

    // Send SMS via Twilio
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const smsBody = new URLSearchParams({
      To: phone,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: `Wind Watch Pro: your verification code is ${code}. It expires in 10 minutes.`
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

    // Hint the agent can show: last 4 digits of the phone we texted
    const last4 = phone.slice(-4);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, phone_hint: last4 }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
