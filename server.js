
const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Backend is running!" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body || {};

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "Please enter a question." });
    }

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:e2b",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful hackathon assistant. Answer directly in simple language, using 2-3 short sentences unless more detail is needed."
          },
          {
            role: "user",
            content: question.trim()
          }
        ],
        stream: true,
        think: false,
        keep_alive: "30m",
        options: {
          num_predict: 80,
          temperature: 0.2
        }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok || !response.body) {
      const details = await response.text();
      console.error("Ollama error:", details);
      return res.status(502).json({ error: "Ollama request failed." });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      buffer += decoder.decode(value || new Uint8Array(), {
        stream: !done
      });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const item = JSON.parse(line);
          const token = item.message?.content || "";

          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }

          if (item.error) {
            res.write(`data: ${JSON.stringify({ error: item.error })}\n\n`);
          }

          if (item.done) {
            res.write("data: [DONE]\n\n");
          }
        } catch (error) {
          console.error("Invalid Ollama chunk:", error.message);
        }
      }

      if (done) break;
    }

    if (buffer.trim()) {
      try {
        const item = JSON.parse(buffer);
        const token = item.message?.content || "";

        if (token) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      } catch (error) {
        console.error("Final chunk error:", error.message);
      }
    }

    res.end();
  } catch (error) {
    console.error("Chat error:", error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: "AI request failed: " + error.message
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
