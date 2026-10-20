
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const messages = document.getElementById("messages");
const welcome = document.getElementById("welcome");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearChat");

let busy = false;

function addMessage(role, text = "") {
  const row = document.createElement("div");
  row.className = `message ${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "R";
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  row.appendChild(bubble);
  messages.appendChild(row);

  return bubble;
}

async function sendMessage(text) {
  text = text.trim();

  if (!text || busy) return;

  busy = true;
  sendBtn.disabled = true;
  welcome.hidden = true;

  addMessage("user", text);

  input.value = "";
  input.style.height = "auto";

  const reply = addMessage("assistant", "AI উত্তর তৈরি করছে...");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question: text })
    });

    if (!response.ok) {
      let errorMessage = `Request failed (${response.status})`;

      try {
        const data = await response.json();
        errorMessage = data.error || data.message || errorMessage;
      } catch {}

      throw new Error(errorMessage);
    }

    const contentType = response.headers.get("content-type") || "";

    // Handle streaming responses from the current backend
    if (contentType.includes("text/event-stream")) {
      if (!response.body) {
        throw new Error("No response stream received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

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
            .find(line => line.startsWith("data:"));

          if (!dataLine) continue;

          const data = dataLine.slice(5).trim();

          if (data === "[DONE]") continue;

          let item;

          try {
            item = JSON.parse(data);
          } catch {
            continue;
          }

          if (item.error) {
            throw new Error(item.error);
          }

          if (item.token) {
            answer += item.token;
            reply.textContent = answer;
          }
        }

        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth"
        });

        if (done) break;
      }

      if (!answer) {
        reply.textContent = "কোনো উত্তর পাওয়া যায়নি। আবার চেষ্টা করো।";
      }
    } else {
      // Handle ordinary JSON responses
      const data = await response.json();

      reply.textContent =
        data.answer ||
        data.reply ||
        data.message ||
        data.content ||
        "কোনো উত্তর পাওয়া যায়নি।";
    }
  } catch (error) {
    reply.textContent = "সমস্যা: " + error.message;
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});

document.querySelectorAll(".suggestion").forEach(button => {
  button.addEventListener("click", () => {
    sendMessage(button.dataset.prompt || "");
  });
});

clearBtn.addEventListener("click", () => {
  if (busy) return;

  messages.replaceChildren();
  welcome.hidden = false;
  input.value = "";
  input.focus();
});
