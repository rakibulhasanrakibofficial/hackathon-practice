
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL =
  process.env.OPENROUTER_MODEL ||
  "google/gemma-4-26b-a4b-it:free";

app.use(express.json({ limit: "100kb" }));

const publicDir = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public")
  : __dirname;

// Don't expose backend/config files as static assets.
app.use((req, res, next) => {
  if (
    ["/server.js", "/package.json", "/package-lock.json"].includes(req.path) ||
    req.path.startsWith("/node_modules/") ||
    req.path.startsWith("/.")
  ) {
    return res.sendStatus(404);
  }
  next();
});

app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "OK",
    provider: "OpenRouter",
    model: MODEL
  });
});

app.post("/api/chat", async (req, res) => {
  const API_KEY = process.env.OPENROUTER_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "OPENROUTER_API_KEY is missing from server environment variables."
    });
  }

  const body = req.body || {};
  const lastMessage = Array.isArray(body.messages)
    ? body.messages[body.messages.length - 1]
    : null;

  const question = [
    body.question,
    body.message,
    body.prompt,
    body.text,
    body.content,
    body.userMessage,
    lastMessage?.content
  ].find((value) => typeof value === "string" && value.trim());

  if (!question) {
    return res.status(400).json({
      error: "Please enter a question."
    });
  }

  if (question.length > 20000) {
    return res.status(413).json({
      error: "Your message is too long. Please use shorter text."
    });
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful AI assistant. Answer directly in simple language, using 2-3 short sentences unless more detail is needed. When summarizing notes, do not invent facts."
          },
          {
            role: "user",
            content: question.trim()
          }
        ],
        max_tokens: 500,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(90000)
    });

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => "");
      console.error("OpenRouter error:", response.status, details);

      return res.status(502).json({
        error:
          response.status === 429
            ? "Free model rate limit reached. Wait a little and try again."
            : "Hosted AI request failed. Check the model availability and API key."
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), {
        stream: !done
      });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data:"));

        if (!dataLine) continue;

        const data = dataLine.slice(5).trim();
        if (data === "[DONE]") continue;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        if (chunk.error) {
          console.error("OpenRouter stream error:", chunk.error);
          continue;
        }

        const token = chunk.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }

      if (done) break;
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Chat request failed:", error.message);

    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({
          error: "AI connection ended unexpectedly. Please try again."
        })}\n\n`
      );
      return res.end();
    }

    return res.status(502).json({
      error: "Could not connect to hosted AI. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Provider: OpenRouter | Model: ${MODEL}`);
});
