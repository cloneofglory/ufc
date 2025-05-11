document.addEventListener("DOMContentLoaded", () => {
  const wsUrl = window.CONFIG.wsUrl;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("Connected to WebSocket server");
    const clientID = generateAndStoreClientID();
    const userName = sessionStorage.getItem("userName");
    console.log("Using clientID:", clientID);
    ws.send(JSON.stringify({ type: "register", clientID, userName }));

    preTask.init(ws);
    trialPhase.init(ws);
    postTask.init(ws);
    chat.init(ws);
    utilities.setWebSocket(ws);

    preTask.showPreTaskScreen();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("Received message:", data);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };
});

function generateAndStoreClientID() {
  const urlParams = new URLSearchParams(window.location.search);
  const prolificId = urlParams.get("PROLIFIC_PID");

  if (prolificId) {
    console.log("Using Prolific ID from URL:", prolificId);
    sessionStorage.setItem("PROLIFIC_PID", prolificId);
    return prolificId;
  }

  const storedId = sessionStorage.getItem("PROLIFIC_PID");
  if (storedId) {
    console.log("Using previously stored client ID:", storedId);
    return storedId;
  }

  const fallbackId =
    "client-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
  sessionStorage.setItem("PROLIFIC_PID", fallbackId);
  console.log("Generated fallback client ID:", fallbackId);
  return fallbackId;
}