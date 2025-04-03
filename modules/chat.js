// modules/chat.js
const chat = (() => {
  let ws = null;

  /**
   * Initializes the chat module with a WebSocket connection.
   * @param {WebSocket} wsConnection - Optional WebSocket; if not provided, uses window._ws.
   */
  function init(wsConnection) {
    ws = wsConnection || window._ws;
    if (!ws) {
      console.error("Chat: No WebSocket connection available.");
    } else {
      // Listen for incoming messages on the WebSocket.
      ws.addEventListener("message", function(event) {
        try {
          const data = JSON.parse(event.data);
          console.log("Received message:", data);
  
          // Get the current user's sessionID and clientID
          const currentSessionID = sessionStorage.getItem('sessionID');
          const currentClientID = sessionStorage.getItem('PROLIFIC_PID');
  
          // Only process the message if:
          // 1. It belongs to the same session, AND
          // 2. It is not from the current user
          if (
            data.type === "chat" &&
            data.sessionID === currentSessionID &&
            data.clientID !== currentClientID 
          ) {
            // Append the received message to the chat container.
            appendMessage(data.clientID, data.message);
          }
        } catch (error) {
          console.error("Chat: Error parsing incoming message", error);
        }
      });
    }
  }

  /**
   * Appends a chat message to the chat container.
   * @param {string} clientID - Sender's ID.
   * @param {string} message - Message text.
   */
  function appendMessage(clientID, message) {
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer) {
      console.error("Chat container not found.");
      return;
    }
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("chat-message");
    msgDiv.innerHTML = `<span class="user-name">${clientID}:</span> <span class="message-text">${message}</span>`;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  /**
   * Sends a chat message via the WebSocket connection.
   * @param {string} message - The message to send.
   */
  function sendMessage(message) {
    const clientID = sessionStorage.getItem("PROLIFIC_PID");
    const sessionID = sessionStorage.getItem('sessionID'); 
    if (!clientID || !sessionID) {
      console.error("Client ID or Session ID not found in sessionStorage.");
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = {
        type: "chat",
        clientID: clientID,
        sessionID: sessionID, 
        message: message,
        timestamp: new Date().toISOString()
      };
      ws.send(JSON.stringify(payload));
    } else {
      console.error("WebSocket is not open; cannot send message.");
    }
  }

  return {
    init,
    appendMessage,
    sendMessage
  };
})();
