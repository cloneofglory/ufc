// modules/preTask.js

const preTask = (function () {
  let appContainer;
  let preTaskScreen, waitingRoomScreen;
  let waitingTimerId;
  let ws; // WebSocket instance
  let sessionInfo = null;
  let preTaskData = null;
  let hasRouted = false;

  function init(webSocketInstance) {
    ws = webSocketInstance;
    appContainer = document.getElementById("app-container");

    preTaskScreen = document.createElement("div");
    preTaskScreen.classList.add("screen");
    preTaskScreen.innerHTML = `
      <h1>Welcome to the UFC Prediction Experiment</h1>
      <p>Please complete the following survey:</p>
      <label for="survey-name">Name:</label>
      <input type="text" id="survey-name" placeholder="Enter your name" required /><br/><br/>
      
      <label for="slider-feature1">Rank Importance of Fighter Speed (0-100):</label>
      <input type="range" id="slider-feature1" min="0" max="100" value="50" /><br/><br/>
      
      <label for="slider-feature2">Rank Importance of Fighter Strength (0-100):</label>
      <input type="range" id="slider-feature2" min="0" max="100" value="50" /><br/><br/>
      
      <label for="ai-trust">Rate your Trust in AI Predictions (0-100):</label>
      <input type="range" id="ai-trust" min="0" max="100" value="50" /><br/><br/>
      
      <button id="btn-start-waiting">Submit Survey & Enter Waiting Room</button>
    `;
    appContainer.appendChild(preTaskScreen);

    waitingRoomScreen = document.createElement("div");
    waitingRoomScreen.classList.add("screen");
    waitingRoomScreen.innerHTML = `
      <h2>Waiting Room</h2>
      <p id="waiting-message">Waiting for other participants...</p>
      <p id="timer-display"></p>
      <p id="routing-message" style="display:none;"></p>
    `;
    appContainer.appendChild(waitingRoomScreen);

    preTaskScreen
      .querySelector("#btn-start-waiting")
      .addEventListener("click", submitSurveyAndStartWaiting);

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.error("Invalid JSON received:", event.data);
        return;
      }
      if (data.type === "sessionStarted") {
        console.log("Session started:", data);
        sessionStorage.setItem("sessionID", data.sessionID);
        sessionInfo = data;
        // Once we have a sessionStarted (with sessionID), send the pre-task data.
        sendPreTaskSurveyData();
        if (data.mode === "waiting") {
          // Show waiting room only if session is in waiting mode
          startWaitingRoom(data.waitingEndTime);
        } else {
          // Session is already running (group or solo), hide waiting room
          waitingRoomScreen.style.display = "none";
        }
      } else if (data.type === "sessionUpdate") {
        console.log("Session update received:", data);
        if (data.status === "running") {
          // Hide waiting room when session is running
          waitingRoomScreen.style.display = "none";
          if (!hasRouted) {
            finalizeWaitingRoom(data.mode);
            hasRouted = true;
          }
        }
      } else if (data.type === "participantCount") {
        console.log("Participant count update:", data.count);
      }
    };

    ws.onerror = (error) => console.error("WebSocket error:", error);
    ws.onclose = () => console.log("WebSocket connection closed");
  }

  function submitSurveyAndStartWaiting() {
    const name = preTaskScreen.querySelector("#survey-name").value;
    if (!name) {
      alert("Please enter your name.");
      return;
    }
    const clientID = sessionStorage.getItem("PROLIFIC_PID") || name;
    preTaskData = {
      clientID: clientID,
      name: name,
      fighterSpeedImportance:
        preTaskScreen.querySelector("#slider-feature1").value,
      fighterStrengthImportance:
        preTaskScreen.querySelector("#slider-feature2").value,
      aiTrust: preTaskScreen.querySelector("#ai-trust").value,
      timestamp: new Date().toISOString(),
    };
    console.log("Pre-task survey captured:", preTaskData);
    // Do not send survey data immediately; wait for sessionStarted.
    ws.send(JSON.stringify({ type: "startSession", clientID: clientID }));
    hideAllScreens();
  }

  function sendPreTaskSurveyData() {
    if (preTaskData) {
      ws.send(
        JSON.stringify({
          type: "sendData",
          payload: { event: "preTaskSurvey", data: preTaskData },
        })
      );
      console.log("Pre-task survey data sent:", preTaskData);
    }
  }

  function startWaitingRoom(waitingEndTime) {
    const timerDisplay = waitingRoomScreen.querySelector("#timer-display");
    function updateCountdown() {
      const remaining = Math.max(
        0,
        Math.floor((waitingEndTime - Date.now()) / 1000)
      );
      timerDisplay.textContent = `${remaining} seconds remaining`;
      if (remaining <= 0 && !hasRouted) {
        clearInterval(waitingTimerId);
        waitingTimerId = null;
        finalizeWaitingRoom("solo");
        hasRouted = true;
      }
    }
    updateCountdown();
    waitingTimerId = setInterval(updateCountdown, 1000);
    waitingRoomScreen.style.display = "block";
  }

  function finalizeWaitingRoom(mode) {
    const routingMessage = waitingRoomScreen.querySelector("#routing-message");
    routingMessage.style.display = "block";
    routingMessage.textContent =
      mode === "group"
        ? "Proceeding to Group Deliberation..."
        : "Proceeding to Solo Mode...";
    console.log("Routing to", mode, "mode.");
    trialPhase.setMode(mode === "solo"); // true = solo, false = group
  }

  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.style.display = "none";
    });
  }

  return {
    init,
    showPreTaskScreen: () => {
      preTaskScreen.style.display = "block";
    },
  };
})();

document.addEventListener("DOMContentLoaded", () => {});
