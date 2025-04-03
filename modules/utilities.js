// modules/utilities.js
const utilities = (function() {
  let wallet = 100;
  let wsInstance = null;

  function setWebSocket(ws) {
    wsInstance = ws;
  }

  function getWallet() {
    return wallet;
  }

  function setWallet(newVal) {
    wallet = newVal;
    console.log("Wallet updated to:", wallet);
  }

  function savePostTaskData(data) {
    const clientID = sessionStorage.getItem("PROLIFIC_PID") || "unknown";
    console.log("Post-task data to be saved:", data);
    const payload = {
      event: "postTaskSurvey",
      data: {
        clientID: clientID,
        performanceVal: data.performanceVal,
        aiPerfVal: data.aiPerfVal,
        finalWallet: getWallet(),
        timestamp: new Date().toISOString()
      }
    };
    if (wsInstance) {
      wsInstance.send(JSON.stringify({
        type: "sendData",
        payload: payload
      }));
    } else {
      console.error("WebSocket instance not set in utilities");
    }
  }

  return {
    getWallet,
    setWallet,
    savePostTaskData,
    setWebSocket
  };
})();


