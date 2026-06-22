const crypto = require('crypto');
const { NonceManager } = require('../utils/nonceManager');

const nonceManager = new NonceManager();

const SECRET_KEY = process.env.SIGNATURE_SECRET_KEY || 'default_secret_key';
const EXPIRE_TIME = parseInt(process.env.SIGNATURE_EXPIRE_TIME || '300000', 10);

const HEADER_TIMESTAMP = process.env.SIGNATURE_HEADER_TIMESTAMP || 'X-Timestamp';
const HEADER_NONCE = process.env.SIGNATURE_HEADER_NONCE || 'X-Nonce';
const HEADER_APP_ID = process.env.SIGNATURE_HEADER_APP_ID || 'X-App-Id';
const HEADER_SIGNATURE = process.env.SIGNATURE_HEADER_SIGNATURE || 'X-Signature';

function generateSignature(method, path, timestamp, nonce, appId, body) {
  let bodyStr = '';
  if (body && Object.keys(body).length > 0) {
    bodyStr = JSON.stringify(body);
  }
  const signStr = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${appId}\n${bodyStr}`;
  
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(signStr, 'utf8')
    .digest('hex');
}

function signatureAuth(req, res, next) {
  const timestamp = req.headers[HEADER_TIMESTAMP.toLowerCase()];
  const nonce = req.headers[HEADER_NONCE.toLowerCase()];
  const appId = req.headers[HEADER_APP_ID.toLowerCase()];
  const signature = req.headers[HEADER_SIGNATURE.toLowerCase()];

  if (!timestamp || !nonce || !appId || !signature) {
    return res.status(401).json({
      code: 40101,
      message: '缺少签名必要参数',
      data: null
    });
  }

  const timestampNum = parseInt(timestamp, 10);
  const now = Date.now();
  
  if (isNaN(timestampNum) || Math.abs(now - timestampNum) > EXPIRE_TIME) {
    return res.status(401).json({
      code: 40102,
      message: '请求已过期或时间戳无效',
      data: null
    });
  }

  if (nonceManager.isNonceUsed(nonce, timestampNum)) {
    return res.status(401).json({
      code: 40103,
      message: '请求已被重放',
      data: null
    });
  }

  const method = req.method;
  const path = req.originalUrl.split('?')[0];
  const body = req.body || {};

  const expectedSignature = generateSignature(method, path, timestamp, nonce, appId, body);

  if (signature !== expectedSignature) {
    return res.status(401).json({
      code: 40104,
      message: '签名校验失败',
      data: null
    });
  }

  nonceManager.addNonce(nonce, timestampNum);
  
  next();
}

module.exports = {
  signatureAuth,
  generateSignature
};
