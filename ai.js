
const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Please enter a question."
      });
    }

    const response = await fetch(
      "http://localhost:11434/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gemma4:e2b",
          messages: [
            {
              role: "user",
              content: question
            }
          ],
          stream: false
        }),
        signal: AbortSignal.timeout(120000)
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: "The AI model returned an error."
      });
    }

    const data = await response.json();

    res.json({
      answer: data.message.content
    });
  } catch (error) {
    console.error(error.message);

    res.status(500).json({
      error: "Could not get an AI response. Check Ollama."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
