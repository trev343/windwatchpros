exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;

  if (!token) {
    return { statusCode: 400, body: 'Missing token' };
  }

  const baseUrl = 'https://api.airtable.com/v0/appuT8I6375ZPeNh1/Companies';
  const headers = {
    'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Find the record with this token
  const formula = encodeURIComponent(`{Confirm Token} = "${token}"`);
  const findRes = await fetch(`${baseUrl}?filterByFormula=${formula}&maxRecords=1`, { headers });
  const findData = await findRes.json();

  if (!findData.records || !findData.records.length) {
    return { statusCode: 404, body: 'Invalid or expired link' };
  }

  const recordId = findData.records[0].id;

  // Snooze for 8 hours from now (UTC)
  const snoozeUntil = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  await fetch(`${baseUrl}/${recordId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: {
        'Alert Status': 'None',      // re-arm — snooze is now the gate
        'Snooze Until': snoozeUntil,
        'Confirm Token': '',         // invalidate the link after use
      },
    }),
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `
      <html>
        <body style="font-family: Inter, Arial, sans-serif; background: #080e14; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; padding: 24px;">
            <h1 style="color: #2fc4f0;">&#10003; Alert Confirmed</h1>
            <p>Wind notifications paused for the next 8 hours.</p>
            <p style="color: #8aa3b5; font-size: 14px;">Alerts will automatically resume after that.</p>
          </div>
        </body>
      </html>
    `,
  };
};
