// Backend/shuffleHelper.js

/**
 * Performs an in‑place Fisher–Yates shuffle on an array of indices.
 * @param {number[]} order - Array of indices to shuffle.
 */
function shuffleIndices(order) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  
  /**
   * Shuffles the trial data for a session and persists the shuffled order.
   * @param {import('firebase-admin').firestore.DocumentReference} sessionRef
   * @param {Object[]} trialData - Array of trial objects (length 50).
   * @returns {Promise<Object[]>} - The randomized trialData array.
   */
  async function shuffleAndPersist(sessionRef, trialData) {
    // Build [0,1,2,...,n-1]
    const order = trialData.map((_, idx) => idx);
  
    // Shuffle that index array
    shuffleIndices(order);
  
    // Persist to Firestore
    await sessionRef.update({ trialOrder: order });
  
    // Assemble randomized trials in that order
    return order.map(idx => trialData[idx]);
  }
  
  module.exports = { shuffleAndPersist };
  