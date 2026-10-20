
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL =
  process.env.OPENROUTER_MODEL ||
  "google/gemma-4-26b-a4b-it:free";

const API_KEY = process.env.OPENROUTER_API_KEY;

// Support either public/index.html or index.html in the project root.
const publicDir = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public")
  : __dirname;

app.use(express.json({ limit: "100kb" }));

// If the frontend is in the project root, don't serve backend/config files.
app.use((req, res, next) => {
  if (
    req.path.startsWith("/.") ||
    ["/server.js", "/package.json", "/package-lock.json"].includes(req.path) ||
    req.path.startsWith("/node_modules/")
  ) {
    return res.sendStatus(404);
  }
  next();
});

app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "OpenRouter",
    model: MODEL
  });
});

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error: "Server configuration error: OPENROUTER_API_KEY is missing."
    });
  }

  // Support common frontend request formats.
  const userMessage =
    typeof req.body?.message === "string"
      ? req.body.message
      : typeof req.body?.prompt === "string"
        ? req.body.prompt
        : typeof req.body?.messages?.[req.body.messages.length - 1]?.content === "string"
          ? req.body.messages[req.body.messages.length - 1].content
          : "";

  if (!userMessage.trim()) {
    return res.status(400).json({
      error: "Please enter a message."
    });
  }

  if (userMessage.length > 20000) {
    return res.status(413).json({
      error: "Message is too long. Please use shorter text."
    });
  }

  let upstream;

  try {
    upstream = await fetch(API_URL, {
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
              "You are a helpful AI assistant. Give accurate, clear, concise answers. If asked to summarize notes, use the supplied notes and do not invent facts."
          },
          {
            role: "user",
            content: userMessage.trim()
          }
        ],
        max_tokens: 500,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(90000)
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("OpenRouter error:", upstream.status, detail);

      return res.status(502).json({
        error:
          upstream.status === 429
            ? "The AI provider rate limit was reached. Please wait and try again."
            : "The hosted AI request failed. Check the model availability and API configuration."
      });
    }

    if (!upstream.body) {
      return res.status(502).json({
        error: "The AI provider returned no response stream."
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const line = event
          .split("\n")
          .find((item) => item.startsWith("data:"));

        if (!line) continue;

        const raw = line.slice(5).trim();
        if (raw === "[DONE]") continue;

        let chunk;
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }

        if (chunk.error) {
          console.error("OpenRouter stream error:", chunk.error);
          continue;
        }

        const token = chunk.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token.length > 0) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Chat request failed:", error.message);

    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({
          error: "The AI connection ended unexpectedly. Please try again."
        })}\n\n`
      );
      return res.end();
    }

    return res.status(502).json({
      error: "Could not reach the hosted AI service. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`AI provider: OpenRouter | Model: ${MODEL}`);
});
