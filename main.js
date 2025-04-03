// main.js
document.addEventListener("DOMContentLoaded", () => {
  const ws = new WebSocket('ws://localhost:8080');

  ws.onopen = () => {
    console.log('Connected to WebSocket server');
    const clientID = generateAndStoreClientID();
    console.log('Using clientID:', clientID);
    ws.send(JSON.stringify({ type: 'register', clientID }));

    preTask.init(ws);
    trialPhase.init(ws);
    postTask.init(ws);
    chat.init(ws); // Assuming chat uses ws.
    utilities.setWebSocket(ws);

    preTask.showPreTaskScreen();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };
});
  
function generateAndStoreClientID() {
  if (!sessionStorage.getItem("PROLIFIC_PID")) {
    const dummyID = 'client-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    sessionStorage.setItem("PROLIFIC_PID", dummyID);
    console.log("Generated dummy client ID:", dummyID);
  }
  return sessionStorage.getItem("PROLIFIC_PID");
}

