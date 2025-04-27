const utilities = (function () {
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
    console.log("Post-task data to be saved:", data);
    const payload = {
      event: "postTaskSurvey",
      data: data,
    };
    if (wsInstance) {
      wsInstance.send(
        JSON.stringify({
          type: "sendData",
          payload: payload,
        })
      );
    } else {
      console.error("WebSocket instance not set in utilities");
    }
  }

  function formatFighterNames(text) {
    if (!text) return "";
    return text
      .replace(/Red Fighter/g, "Fighter A")
      .replace(/Blue Fighter/g, "Fighter B");
  }

  return {
    getWallet,
    setWallet,
    savePostTaskData,
    setWebSocket,
    formatFighterNames,
  };
})();