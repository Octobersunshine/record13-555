require('dotenv').config();
const http = require('http');
const crypto = require('crypto');

const APP_ID = 'client_app_001';
const BASE_URL = 'localhost';
const PORT = process.env.PORT || 3000;
const KEY_VERSION = 'V1';
const SECRET_KEY = process.env[`SIGNATURE_SECRET_KEY_${KEY_VERSION}`] || 'your_super_secret_key_here_2024';

function generateSignature(method, path, timestamp, nonce, appId, body, secretKey) {
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

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function sendRequest(method, path, body = null, withSignature = false) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (withSignature) {
      const timestamp = Date.now().toString();
      const nonce = generateNonce();
      const signature = generateSignature(method, path, timestamp, nonce, APP_ID, body, SECRET_KEY);
      
      headers['X-Timestamp'] = timestamp;
      headers['X-Nonce'] = nonce;
      headers['X-App-Id'] = APP_ID;
      headers['X-Key-Version'] = KEY_VERSION;
      headers['X-Signature'] = signature;
    }

    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const respData = JSON.parse(data);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: respData
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            rawData: data
          });
        }
      });
    });

    req.on('error', reject);

    if (body && method !== 'GET') {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function printResponse(title, response, showData = true) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📋 ${title}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`状态码: ${response.statusCode}`);
  
  const interestingHeaders = [
    'x-key-status', 'x-key-days-left', 'x-key-expire-date',
    'x-key-expiration-warning', 'x-key-expiration-hint',
    'x-key-deprecated', 'x-key-latest-version', 'x-key-current-version',
    'x-key-upgrade-hint'
  ];
  
  const foundHeaders = [];
  for (const h of interestingHeaders) {
    if (response.headers[h]) {
      let value = response.headers[h];
      if (h.includes('hint') && value) {
        try {
          value = Buffer.from(value, 'base64').toString('utf8');
        } catch (e) {}
      }
      foundHeaders.push(`  ${h}: ${value}`);
    }
  }
  
  if (foundHeaders.length > 0) {
    console.log('响应头:');
    console.log(foundHeaders.join('\n'));
  }
  
  if (showData && response.data) {
    console.log('响应数据:');
    console.log(JSON.stringify(response.data, null, 2));
  }
  console.log(`${'='.repeat(70)}`);
}

async function runTests() {
  console.log('================================================================');
  console.log('  密钥过期预警功能测试');
  console.log('================================================================');
  console.log(`测试日期: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`使用密钥版本: ${KEY_VERSION}`);
  console.log(`密钥: ${SECRET_KEY.slice(0, 8)}...`);
  console.log('================================================================');

  try {
    console.log('\n🧪 测试 1: 查看密钥状态 API');
    const statusResp = await sendRequest('GET', '/api/admin/key-status');
    printResponse('GET /api/admin/key-status', statusResp);
    
    if (statusResp.data) {
      const { keys, warningKeys, expiredKeys } = statusResp.data.data || statusResp.data;
      console.log('\n📊 密钥状态汇总:');
      for (const key of keys) {
        const icon = key.status === 'normal' ? '🟢' : key.status === 'warning' ? '🟡' : key.status === 'expired' ? '🔴' : '🔵';
        console.log(`  ${icon} ${key.version}: ${key.statusLabel} | 剩余 ${key.daysLeft} 天 | 过期: ${key.expireStr}`);
      }
      console.log(`  🟡 即将过期: ${warningKeys.length} 个`);
      console.log(`  🔴 已过期: ${expiredKeys.length} 个`);
    }

    console.log('\n🧪 测试 2: 立即触发密钥检查');
    const checkResp = await sendRequest('POST', '/api/admin/key-check');
    printResponse('POST /api/admin/key-check', checkResp);

    console.log('\n🧪 测试 3: 使用即将过期的 V1 密钥发起请求（检查响应头预警）');
    const apiResp = await sendRequest('GET', '/api/user/info', null, true);
    printResponse('GET /api/user/info (使用 V1 密钥)', apiResp);
    
    if (apiResp.headers['x-key-expiration-warning'] === 'true') {
      console.log('\n✅ 成功: 响应头正确包含过期预警信息！');
      const daysLeft = apiResp.headers['x-key-days-left'];
      console.log(`   密钥版本 ${KEY_VERSION} 将在 ${daysLeft} 天后过期`);
    } else if (apiResp.headers['x-key-status']) {
      console.log(`\nℹ️  密钥状态: ${apiResp.headers['x-key-status']}`);
      if (apiResp.headers['x-key-status'] === 'notice') {
        console.log('   (距离过期还有一段距离，未触发预警阈值)');
      }
    }

    console.log('\n🧪 测试 4: 重置通知状态');
    const resetResp = await sendRequest('POST', '/api/admin/key-reset-notification');
    printResponse('POST /api/admin/key-reset-notification', resetResp);

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('  测试完成');
  console.log('================================================================');
}

runTests();
