const EXPIRE_TIME = parseInt(process.env.SIGNATURE_EXPIRE_TIME || '300000', 10);

class NonceManager {
  constructor() {
    this.nonceStore = new Map();
    this.startCleanup();
  }

  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [nonce, timestamp] of this.nonceStore.entries()) {
        if (now - timestamp > EXPIRE_TIME) {
          this.nonceStore.delete(nonce);
        }
      }
    }, EXPIRE_TIME);
  }

  isNonceUsed(nonce, timestamp) {
    if (this.nonceStore.has(nonce)) {
      return true;
    }
    return false;
  }

  addNonce(nonce, timestamp) {
    this.nonceStore.set(nonce, timestamp);
  }
}

module.exports = {
  NonceManager
};
