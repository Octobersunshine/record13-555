require('dotenv').config();
const crypto = require('crypto');
const http = require('http');

const KEY_VERSION = process.env.SIGNATURE_ACTIVE_VERSION || 'V2';
const SECRET_KEY = process.env[`SIGNATURE_SECRET_KEY_${KEY_VERSION}`] || 'your_super_secret_key_here_2024';
const APP_ID = 'client_app_001';
const BASE_URL = 'localhost';
const PORT = process.env.PORT || 3000;

console.log(`当前使用密钥版本: ${KEY_VERSION}`);
console.log(`密钥: ${SECRET_KEY}`);

function generateSignature(method, path, timestamp, nonce, appId, body) {
  let bodyStr = '';
  if (body && Object.keys(body).length > 0) {
    bodyStr = JSON.stringify(body);
  }
  const signStr = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${appId}\n${bodyStr}`;
  
  console.log('签名原始字符串:');
  console.log(signStr);
  console.log('---');
  
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(signStr, 'utf8')
    .digest('hex');
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function sendRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const nonce = generateNonce();
    const signature = generateSignature(method, path, timestamp, nonce, APP_ID, body);

    const headers = {
      'Content-Type': 'application/json',
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-App-Id': APP_ID,
      'X-Key-Version': KEY_VERSION,
      'X-Signature': signature
    };

    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: headers
    };

    console.log(`\n=== ${method} ${path} ===`);
    console.log('请求头:', JSON.stringify(headers, null, 2));
    if (body) console.log('请求体:', JSON.stringify(body, null, 2));

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log('响应状态:', res.statusCode);
        if (res.headers['x-key-deprecated'] === 'true') {
          console.warn('⚠️  警告: 当前使用的密钥版本已过时，请尽快升级到版本:', res.headers['x-key-latest-version']);
        }
        console.log('响应数据:', JSON.stringify(JSON.parse(data), null, 2));
        resolve({ status: res.statusCode, data: JSON.parse(data) });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  try {
    await sendRequest('GET', '/api/public/health');
    await sendRequest('GET', '/api/user/info');
    await sendRequest('POST', '/api/order/create', {
      productId: 'PROD001',
      quantity: 2,
      amount: 199.99
    });
    await sendRequest('PUT', '/api/user/profile', {
      nickname: '新昵称',
      avatar: 'https://example.com/avatar.jpg'
    });
    await sendRequest('DELETE', '/api/order/ORD123456');
  } catch (error) {
    console.error('请求失败:', error.message);
  }
}

main();
