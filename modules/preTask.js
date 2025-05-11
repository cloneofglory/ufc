const preTask = (function () {
  let appContainer;
  let preTaskScreen, waitingRoomScreen;
  let waitingTimerId;
  let ws;
  let sessionInfo = null;
  let preTaskData = null;
  let hasRouted = false;

  function init(webSocketInstance) {
    ws = webSocketInstance;
    appContainer = document.getElementById("app-container");
    createConsentModal();
    preTaskScreen = document.createElement("div");
    preTaskScreen.classList.add("screen");
    preTaskScreen.innerHTML = `
      <h1>Welcome to the UFC Prediction Experiment</h1>
      <p>Please complete the following survey:</p><br/>
      <label for="survey-name">Username:</label>
      <input type="text" id="survey-name" placeholder="Enter your name" required /><br/><br/>
      
      <p>Before we begin the main task, we'd like to understand how important you think each of the following fighter stats is when predicting who will win a UFC fight.</p> <br/>
      <p>Use the slider to assign a value between 1 (Not important at all) and 100 (Extremely important) for each feature based on your personal judgment.</p> <br/>
      <p>Please base your ratings on your current intuition or knowledge—there are no right or wrong answers.</p><br/>
  
      <div class="feature-sliders">
        <div class="slider-group">
          <label>Career Wins (Total number of fights the fighter has won)</label>
          <input type="range" id="slider-wins" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Career Losses (Total number of fights the fighter has lost)</label>
          <input type="range" id="slider-losses" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Age (The fighter’s current age in years)</label>
          <input type="range" id="slider-age" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Height (The fighter’s height, which can affect reach and leverage)</label>
          <input type="range" id="slider-height" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Strikes Landed/Minute (Average number of strikes the fighter lands per minute)</label>
          <input type="range" id="slider-slpm" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Strike Accuracy (Percentage of strikes that land successfully)</label>
          <input type="range" id="slider-accuracy" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Strike Defense (Percentage of opponent strikes the fighter avoids)</label>
          <input type="range" id="slider-defense" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Takedown Defense (Percentage of opponent takedown attempts successfully defended)</label>
          <input type="range" id="slider-td-defense" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Strikes Avoided/Minute (Average number of strikes the fighter avoids per minute)</label>
          <input type="range" id="slider-sapm" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
        
        <div class="slider-group">
          <label>Takedown Accuracy (Percentage of takedown attempts that are successful)</label>
          <input type="range" id="slider-td-accuracy" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
      </div>
  
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

    preTaskScreen.querySelectorAll('input[type="range"]').forEach((slider) => {
      const valueDisplay = slider.nextElementSibling;
      slider.addEventListener("input", () => {
        valueDisplay.textContent = slider.value;
      });
    });

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
      
      if (data.type === "sessionStarted" || 
          (data.type === "sessionUpdate" && data.status === "waiting")) {
        console.log("Session started/waiting:", data);
        if (data.sessionID) {
          sessionStorage.setItem("sessionID", data.sessionID);
          sessionInfo = data;
          sendPreTaskSurveyData();
        }
        
        if (data.mode === "waiting" || data.status === "waiting") {
          const waitEndTime = data.waitingEndTime || (Date.now() + 30000);
          startWaitingRoom(waitEndTime);
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
    sessionStorage.setItem("userName", name);
    const clientID = sessionStorage.getItem("PROLIFIC_PID") || name;
    preTaskData = {
      clientID: clientID,
      timestamp: new Date().toISOString(),
      name: name,
      wins: parseInt(preTaskScreen.querySelector("#slider-wins").value),
      losses: parseInt(preTaskScreen.querySelector("#slider-losses").value),
      age: parseInt(preTaskScreen.querySelector("#slider-age").value),
      height: parseInt(preTaskScreen.querySelector("#slider-height").value),
      slpm: parseInt(preTaskScreen.querySelector("#slider-slpm").value),
      accuracy: parseInt(preTaskScreen.querySelector("#slider-accuracy").value),
      defense: parseInt(preTaskScreen.querySelector("#slider-defense").value),
      tdDefense: parseInt(
        preTaskScreen.querySelector("#slider-td-defense").value
      ),
      sapm: parseInt(preTaskScreen.querySelector("#slider-sapm").value),
      tdAccuracy: parseInt(
        preTaskScreen.querySelector("#slider-td-accuracy").value
      ),
    };

    console.log("Pre-task survey captured:", preTaskData);
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
    hideAllScreens();
    waitingRoomScreen.style.display = "block";  }

  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.style.display = "none";
    });
  }

  function createConsentModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "consent-modal";

    modal.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <h2>Welcome to the Study</h2>
        </div>
        <div class="modal-content" id="consent-content">
          <p class="consent-text">Thank you for participating!</p><br/>

          <p class="consent-text">In this study, you will engage in a 
          <strong>decision-making task</strong> involving predictions about the outcomes of real UFC fights. 
          You'll be shown fighter statistics (such as age, height, win/loss record, and performance metrics), 
          and in some cases, a prediction from an AI system along with a brief explanation.</p><br/>
          
          <p class="consent-text">Depending on your assigned condition, you will either complete the task 
          <strong>individually</strong> (solo mode) or <strong>collaborate with two other participants</strong> (group mode). 
          Your goal is to make the most accurate predictions possible by placing confidence-based wagers.</p><br/>
          
          <p class="consent-text">The study takes approximately <strong>50 – 60 minutes</strong>.</p><br/>
          
          <h3>Study Information</h3>
          <ul class="consent-list">
            <li><strong>Purpose:</strong> This research explores how people make decisions with or without AI assistance and how groups reach consensus in uncertain situations.</li>
            <li><strong>Procedures:</strong> You will review information, interact with or without an AI system, place wagers, and receive feedback across multiple trials.</li>
            <li><strong>Voluntary Participation:</strong> Your participation is completely voluntary. You may withdraw at any time without penalty or loss of compensation.</li>
            <li><strong>Compensation:</strong> You will receive payment ($15) via Prolific as advertised, regardless of your performance. You may also earn a bonus of up to $10 additional based on your performance (i.e. how big your virtual bankroll is at the end of the study)</li>
            <li><strong>Risks & Benefits:</strong> There are no known risks beyond those of everyday computer use. While there are no direct personal benefits, your participation will contribute to research on human-AI interaction and group dynamics.</li>
            <li><strong>Alternatives:</strong> There are no alternative procedures available. The only alternative is not to participate in this study.</li>
            <li><strong>Confidentiality:</strong> The data you provide may be collected and used by Prolific as per its privacy agreement. All data collected will be kept strictly confidential and stored securely. No personal identifying information will be collected.</li>
            <li><strong>Age Requirement:</strong> You must be above 18 years old to participate.</li>
            <li><strong>IRB Approval:</strong> This study has been reviewed and approved by the Institutional Review Board (IRB) atUniversity of California, Irvine.</li>
          </ul>
          
          <h3>Consent to Participate</h3>
          <p class="consent-text">By clicking <strong>"I Consent and Continue"</strong>, you confirm that:</p>
          <ul class="consent-list">
            <li>You understand the nature and purpose of the study.</li>
            <li>You voluntarily agree to participate.</li>
            <li>You may withdraw at any time without penalty.</li>
            <li>You are at least 18 years old.</li>
            <li>You understand that your data will remain confidential.</li>
          </ul>
          
          <p class="consent-text">If you do <strong>not consent</strong>, you may click below to return to Prolific without participating.</p><br/>
          
          <h3>Contact Information</h3>
          <p class="consent-text">If you have any questions about this study or your rights as a participant, you may contact the research team at:</p>
          <p class="consent-text">Ramesh Srinivasan<br>
          Email: r.srinivasan@uci.edu<br>
          IRB Reference Number: #6933</p>
          
          <div class="checkbox-container">
            <input type="checkbox" id="consent-checkbox">
            <label for="consent-checkbox">I have read and understood the information above</label>
          </div>
        </div>
        <div class="modal-footer">
          <button id="decline-consent" class="modal-btn btn-secondary">I Do Not Consent – Exit to Prolific</button>
          <button id="accept-consent" class="modal-btn btn-primary" disabled>I Consent and Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const checkbox = document.getElementById("consent-checkbox");
    const acceptButton = document.getElementById("accept-consent");
    const contentElement = document.getElementById("consent-content");

    let hasScrolledToBottom = false;

    function checkEnableButton() {
      acceptButton.disabled = !(hasScrolledToBottom && checkbox.checked);
    }

    contentElement.addEventListener("scroll", function () {
      if (
        contentElement.scrollHeight - contentElement.scrollTop <=
        contentElement.clientHeight + 10
      ) {
        hasScrolledToBottom = true;
        checkEnableButton();
      }
    });

    checkbox.addEventListener("change", checkEnableButton);

    document
      .getElementById("accept-consent")
      .addEventListener("click", function () {
        modal.style.display = "none";
        preTaskScreen.style.display = "block";
      });

    document
      .getElementById("decline-consent")
      .addEventListener("click", function () {
        const prolificURL = window.CONFIG?.prolificRedirectURL;
        window.location.href = prolificURL;
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