const https = require('https');

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log("API key present:", !!apiKey);
    console.log("API key length:", apiKey ? apiKey.length : 0);
    
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
    }

    const body = event.body;
    console.log("Request body length:", body ? body.length : 0);

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log("Anthropic response status:", res.statusCode);
          resolve({ status: res.statusCode, body: data });
        });
      });

      req.on('error', (err) => {
        console.log("Request error:", err.message);
        reject(err);
      });
      req.write(body);
      req.end();
    });

    return { statusCode: result.status, headers, body: result.body };

  } catch (err) {
    console.log("Caught error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
