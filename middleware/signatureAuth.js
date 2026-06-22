const crypto = require('crypto');
const { NonceManager } = require('../utils/nonceManager');

const nonceManager = new NonceManager();

const EXPIRE_TIME = parseInt(process.env.SIGNATURE_EXPIRE_TIME || '300000', 10);

const HEADER_TIMESTAMP = process.env.SIGNATURE_HEADER_TIMESTAMP || 'X-Timestamp';
const HEADER_NONCE = process.env.SIGNATURE_HEADER_NONCE || 'X-Nonce';
const HEADER_APP_ID = process.env.SIGNATURE_HEADER_APP_ID || 'X-App-Id';
const HEADER_SIGNATURE = process.env.SIGNATURE_HEADER_SIGNATURE || 'X-Signature';
const HEADER_KEY_VERSION = process.env.SIGNATURE_HEADER_KEY_VERSION || 'X-Key-Version';

function loadSecretKeys() {
  const keys = {};
  const envPrefix = 'SIGNATURE_SECRET_KEY_';
  
  for (const key of Object.keys(process.env)) {
    if (key.startsWith(envPrefix)) {
      const version = key.substring(envPrefix.length);
      keys[version] = process.env[key];
    }
  }
  
  if (Object.keys(keys).length === 0) {
    keys['DEFAULT'] = process.env.SIGNATURE_SECRET_KEY || 'default_secret_key';
  }
  
  return keys;
}

const SECRET_KEYS = loadSecretKeys();
const ACTIVE_VERSION = process.env.SIGNATURE_ACTIVE_VERSION || (Object.keys(SECRET_KEYS)[Object.keys(SECRET_KEYS).length - 1] || 'DEFAULT');

function getActiveSecretKey() {
  return SECRET_KEYS[ACTIVE_VERSION] || Object.values(SECRET_KEYS)[0];
}

function generateSignatureWithKey(method, path, timestamp, nonce, appId, body, secretKey) {
  let bodyStr = '';
  if (body && Object.keys(body).length > 0) {
    bodyStr = JSON.stringify(body);
  }
  const signStr = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${appId}\n${bodyStr}`;
  
  return crypto
    .createHmac('sha256', secretKey)
    .update(signStr, 'utf8')
    .digest('hex');
}

function generateSignature(method, path, timestamp, nonce, appId, body) {
  return generateSignatureWithKey(method, path, timestamp, nonce, appId, body, getActiveSecretKey());
}

function verifySignature(method, path, timestamp, nonce, appId, body, signature, requestedVersion) {
  const versionsToTry = [];
  
  if (requestedVersion && SECRET_KEYS[requestedVersion]) {
    versionsToTry.push(requestedVersion);
  }
  
  if (ACTIVE_VERSION !== requestedVersion && SECRET_KEYS[ACTIVE_VERSION]) {
    versionsToTry.push(ACTIVE_VERSION);
  }
  
  for (const version of Object.keys(SECRET_KEYS)) {
    if (!versionsToTry.includes(version)) {
      versionsToTry.push(version);
    }
  }
  
  for (const version of versionsToTry) {
    const secretKey = SECRET_KEYS[version];
    const expectedSig = generateSignatureWithKey(method, path, timestamp, nonce, appId, body, secretKey);
    
    if (signature === expectedSig) {
      return {
        valid: true,
        matchedVersion: version,
        isLatest: version === ACTIVE_VERSION
      };
    }
  }
  
  return {
    valid: false,
    matchedVersion: null,
    isLatest: false,
    triedVersions: versionsToTry
  };
}

function signatureAuth(req, res, next) {
  const timestamp = req.headers[HEADER_TIMESTAMP.toLowerCase()];
  const nonce = req.headers[HEADER_NONCE.toLowerCase()];
  const appId = req.headers[HEADER_APP_ID.toLowerCase()];
  const signature = req.headers[HEADER_SIGNATURE.toLowerCase()];
  const keyVersion = req.headers[HEADER_KEY_VERSION.toLowerCase()];

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

  const verifyResult = verifySignature(method, path, timestamp, nonce, appId, body, signature, keyVersion);

  if (!verifyResult.valid) {
    return res.status(401).json({
      code: 40104,
      message: '签名校验失败',
      data: {
        triedVersions: verifyResult.triedVersions,
        availableVersions: Object.keys(SECRET_KEYS),
        activeVersion: ACTIVE_VERSION
      }
    });
  }

  nonceManager.addNonce(nonce, timestampNum);

  req.signatureInfo = {
    matchedVersion: verifyResult.matchedVersion,
    isLatest: verifyResult.isLatest,
    activeVersion: ACTIVE_VERSION
  };

  if (!verifyResult.isLatest) {
    res.setHeader('X-Key-Deprecated', 'true');
    res.setHeader('X-Key-Latest-Version', ACTIVE_VERSION);
    res.setHeader('X-Key-Current-Version', verifyResult.matchedVersion);
    const upgradeHint = `Please upgrade signature key from version ${verifyResult.matchedVersion} to ${ACTIVE_VERSION}`;
    res.setHeader('X-Key-Upgrade-Hint', Buffer.from(upgradeHint, 'utf8').toString('base64'));
    console.warn(`[WARN] Client using deprecated signature key: AppId=${appId}, CurrentVersion=${verifyResult.matchedVersion}, LatestVersion=${ACTIVE_VERSION}, Path=${path}`);
  }

  next();
}

module.exports = {
  signatureAuth,
  generateSignature,
  generateSignatureWithKey,
  verifySignature,
  getActiveSecretKey,
  getActiveVersion: () => ACTIVE_VERSION,
  getAvailableVersions: () => Object.keys(SECRET_KEYS),
  SECRET_KEYS
};
