const SECRET_KEY = 'your_super_secret_key_here_2024';
const APP_ID = 'client_app_001';
const BASE_URL = 'http://localhost:3000';

function generateSignature(method, path, timestamp, nonce, appId, body) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const signStr = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${appId}\n${bodyStr}`;
  
  console.log('签名原始字符串:');
  console.log(signStr);
  console.log('---');
  
  return CryptoJS.HmacSHA256(signStr, SECRET_KEY).toString(CryptoJS.enc.Hex);
}

function generateNonce() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendRequest(method, path, body = null) {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  const signature = generateSignature(method, path, timestamp, nonce, APP_ID, body);

  const headers = {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-App-Id': APP_ID,
    'X-Signature': signature
  };

  console.log(`\n=== ${method} ${path} ===`);
  console.log('请求头:', JSON.stringify(headers, null, 2));
  if (body) console.log('请求体:', JSON.stringify(body, null, 2));

  const options = {
    method: method,
    headers: headers
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json();
    
    console.log('响应状态:', response.status);
    console.log('响应数据:', JSON.stringify(data, null, 2));
    
    return { status: response.status, data };
  } catch (error) {
    console.error('请求失败:', error.message);
    throw error;
  }
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
    console.error('执行失败:', error.message);
  }
}

main();
