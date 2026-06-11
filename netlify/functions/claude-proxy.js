// Wind Watch Pro — Netlify Function: Claude Onboarding Proxy
// Handles CORS, routes chat to Claude, saves completed onboarding to Airtable,
// and sends a Twilio welcome SMS when the account is created.
//
// Required Netlify environment variables:
//   ANTHROPIC_API_KEY
//   AIRTABLE_API_KEY
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_PHONE_NUMBER   (your Twilio number in E.164, e.g. +19105551234)

const AIRTABLE_BASE_ID = "appuT8I6375ZPeNh1";
const AIRTABLE_TABLE = "Companies";

const SYSTEM_PROMPT = `You are the friendly onboarding assistant for Wind Watch Pro, a wind monitoring service that sends SMS alerts to tent rental companies when wind speeds exceed safe thresholds.

Your job is to collect the following information from the new customer, one or two questions at a time, in a warm conversational tone:

1. Company Name
2. Zip Code (5-digit US zip)
3. Wind Threshold in mph (the wind speed at which they want to be alerted — typical commercial tent thresholds are 20-40 mph)
4. Manager Phone (mobile number that will receive alerts)
5. Owner Phone (backup number for escalation)

Rules:
- Format all phone numbers in E.164 format (e.g. +19105551234). If the user gives a 10-digit US number, convert it by adding +1.
- Confirm all five values back to the user before finalizing.
- Once the user confirms everything is correct, respond with ONLY a JSON object in this exact format and nothing else (no markdown, no backticks, no extra text):

{"action":"save","companyName":"...","zipCode":"...","windThreshold":25,"managerPhone":"+1...","ownerPhone":"+1..."}

- windThreshold must be a number, not a string.
- Until the user confirms, keep chatting normally and never output the JSON.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your Framer domain in production
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: "messages array is required" });
  }

  try {
    // ---- 1. Call Claude ----
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude API error:", errText);
      return json(502, { error: "Claude API request failed" });
    }

    const claudeData = await claudeRes.json();
    const replyText = (claudeData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // ---- 2. Check if onboarding is complete ----
    const saveData = tryParseSaveAction(replyText);

    if (!saveData) {
      // Normal conversation turn — just relay Claude's reply
      return json(200, { reply: replyText, completed: false });
    }

    // ---- 3. Save to Airtable ----
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            "Company Name": saveData.companyName,
            "Zip Code": String(saveData.zipCode),
            "Wind Threshold (mph)": Number(saveData.windThreshold),
            "Manager Phone": saveData.managerPhone,
            "Owner Phone": saveData.ownerPhone,
            "Alert Status": "None",
            "Active": true,
          },
        }),
      }
    );

    if (!airtableRes.ok) {
      const errText = await airtableRes.text();
      console.error("Airtable error:", errText);
      return json(502, { error: "Failed to save account. Please try again." });
    }

    // ---- 4. Send Twilio welcome SMS ----
    let smsSent = false;
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: saveData.managerPhone,
            From: fromNumber,
            Body: "Welcome to Wind Watch Pro! Your account is active and we'll text you whenever wind speeds exceed your threshold. Stay safe out there!",
          }),
        }
      );

      smsSent = twilioRes.ok;
      if (!twilioRes.ok) {
        console.error("Twilio error:", await twilioRes.text());
      }
    } catch (smsErr) {
      // Don't fail the whole onboarding if the SMS hiccups
      console.error("Twilio send failed:", smsErr);
    }

    // ---- 5. Tell the frontend onboarding is done ----
    return json(200, {
      reply:
        "You're all set! Your Wind Watch Pro account is active" +
        (smsSent ? " — check your phone for a welcome text." : "."),
      completed: true,
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return json(500, { error: "Internal server error" });
  }
};

// ---- helpers ----

function tryParseSaveAction(text) {
  // Claude is instructed to output ONLY the JSON object when done,
  // but strip markdown fences just in case.
  const clean = text.replace(/```json|```/g, "").trim();
  if (!clean.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(clean);
    if (
      parsed.action === "save" &&
      parsed.companyName &&
      parsed.zipCode &&
      parsed.windThreshold != null &&
      parsed.managerPhone &&
      parsed.ownerPhone
    ) {
      return parsed;
    }
  } catch {
    /* not JSON — normal chat turn */
  }
  return null;
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
