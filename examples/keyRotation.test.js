require('dotenv').config();
const crypto = require('crypto');
const http = require('http');

const APP_ID = 'client_app_001';
const BASE_URL = 'localhost';
const PORT = process.env.PORT || 3000;

const OLD_SECRET_KEY = process.env.SIGNATURE_SECRET_KEY_V1 || 'your_super_secret_key_here_2024';
const NEW_SECRET_KEY = process.env.SIGNATURE_SECRET_KEY_V2 || 'your_super_secret_key_here_2025_V2';

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

function sendRequest(method, path, body, secretKey, keyVersion, testName) {
  return new Promise((resolve) => {
    const timestamp = Date.now().toString();
    const nonce = generateNonce();
    const signature = generateSignature(method, path, timestamp, nonce, APP_ID, body, secretKey);

    const headers = {
      'Content-Type': 'application/json',
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-App-Id': APP_ID,
      'X-Signature': signature
    };
    
    if (keyVersion) {
      headers['X-Key-Version'] = keyVersion;
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
        const respData = JSON.parse(data);
        const isDeprecated = res.headers['x-key-deprecated'] === 'true';
        const latestVersion = res.headers['x-key-latest-version'];
        const upgradeHint = res.headers['x-key-upgrade-hint'];
        
        const result = {
          testName,
          statusCode: res.statusCode,
          success: res.statusCode === 200,
          isDeprecated,
          latestVersion,
          upgradeHint,
          response: respData
        };
        resolve(result);
      });
    });

    req.on('error', (e) => {
      resolve({
        testName,
        statusCode: 0,
        success: false,
        error: e.message
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function printResult(result) {
  const statusIcon = result.success ? '✅' : '❌';
  console.log(`\n${statusIcon} 测试: ${result.testName}`);
  console.log(`   状态码: ${result.statusCode}`);
  console.log(`   响应: ${result.response?.code} - ${result.response?.message}`);
  
  if (result.success) {
    if (result.isDeprecated) {
      console.log(`   ⚠️  密钥状态: 使用旧版本密钥 (${result.latestVersion ? '最新版本: ' + result.latestVersion : ''})`);
      if (result.upgradeHint) {
        console.log(`   💡 升级提示: ${result.upgradeHint}`);
      }
    } else {
      console.log(`   ✨ 密钥状态: 使用最新版本密钥`);
    }
  } else {
    if (result.response?.data) {
      console.log(`   调试信息: 尝试版本=${JSON.stringify(result.response.data.triedVersions)}, 可用版本=${JSON.stringify(result.response.data.availableVersions)}, 当前版本=${result.response.data.activeVersion}`);
    }
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  多密钥平滑切换测试 - 服务端已启用 V1+V2 双密钥，当前版本 V2');
  console.log('================================================================');
  console.log(`旧密钥 (V1): ${OLD_SECRET_KEY}`);
  console.log(`新密钥 (V2): ${NEW_SECRET_KEY}`);
  console.log('================================================================');

  const results = [];

  results.push(await sendRequest(
    'GET', '/api/user/info', null,
    NEW_SECRET_KEY, 'V2',
    '场景1: 使用新密钥 V2 + 指定版本号 V2（理想情况）'
  ));

  results.push(await sendRequest(
    'GET', '/api/user/info', null,
    OLD_SECRET_KEY, 'V1',
    '场景2: 使用旧密钥 V1 + 指定版本号 V1（升级过渡期，客户端未升级）'
  ));

  results.push(await sendRequest(
    'POST', '/api/order/create',
    { productId: 'PROD001', quantity: 1, amount: 99.99 },
    OLD_SECRET_KEY, null,
    '场景3: 使用旧密钥 V1（不指定版本号）- 自动识别匹配'
  ));

  results.push(await sendRequest(
    'PUT', '/api/user/profile',
    { nickname: '测试用户' },
    NEW_SECRET_KEY, null,
    '场景4: 使用新密钥 V2（不指定版本号）- 自动识别匹配'
  ));

  results.push(await sendRequest(
    'GET', '/api/user/info', null,
    OLD_SECRET_KEY, 'V2',
    '场景5: 使用旧密钥 V1 + 错误指定版本号 V2（版本与密钥不匹配，自动兜底校验）'
  ));

  results.push(await sendRequest(
    'DELETE', '/api/order/ORD_TEST001', null,
    'wrong_secret_key_123456', 'V2',
    '场景6: 使用错误密钥（预期失败）'
  ));

  console.log('\n================================================================');
  console.log('  测试结果汇总');
  console.log('================================================================');
  
  for (const result of results) {
    await printResult(result);
  }

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n================================================================');
  console.log(`  总计: ${results.length} 项测试 | ✅ 通过: ${passed} | ❌ 失败: ${failed}`);
  console.log('================================================================');
  
  console.log('\n📌 密钥切换平滑过渡策略说明:');
  console.log('');
  console.log('   阶段1: 服务端新增 V2 密钥，保留 V1，ACTIVE_VERSION=V2');
  console.log('           ↓ 客户端使用 V1 或 V2 均可正常访问');
  console.log('   阶段2: 客户端分批升级到 V2（服务端无感知）');
  console.log('           ↓ 响应头带 X-Key-Deprecated 提醒升级');
  console.log('   阶段3: 监控确认所有客户端已升级');
  console.log('           ↓ ');
  console.log('   阶段4: 服务端移除 V1 密钥，切换完成 ✓');
  console.log('');
}

runTests().catch(err => console.error('测试执行失败:', err));
