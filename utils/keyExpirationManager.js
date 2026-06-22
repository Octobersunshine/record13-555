const https = require('https');
const http = require('http');
const crypto = require('crypto');
const url = require('url');

const WARNING_DAYS = parseInt(process.env.SIGNATURE_KEY_WARNING_DAYS || '7', 10);
const CHECK_INTERVAL = parseInt(process.env.SIGNATURE_KEY_CHECK_INTERVAL || '3600000', 10);
const WEBHOOK_URL = process.env.SIGNATURE_KEY_WARNING_WEBHOOK || '';
const WEBHOOK_METHOD = (process.env.SIGNATURE_KEY_WARNING_WEBHOOK_METHOD || 'POST').toUpperCase();
const WEBHOOK_SECRET = process.env.SIGNATURE_KEY_WARNING_WEBHOOK_SECRET || '';

const DAY_MS = 24 * 60 * 60 * 1000;

class KeyExpirationManager {
  constructor() {
    this.keyExpirations = new Map();
    this.notifiedKeys = new Set();
    this.checkTimer = null;
    this.loadKeyExpirations();
    this.startPeriodicCheck();
  }

  loadKeyExpirations() {
    this.keyExpirations.clear();
    const expirePrefix = 'SIGNATURE_KEY_EXPIRE_';
    const keyPrefix = 'SIGNATURE_SECRET_KEY_';

    for (const envKey of Object.keys(process.env)) {
      if (envKey.startsWith(expirePrefix)) {
        const version = envKey.substring(expirePrefix.length);
        const expireStr = process.env[envKey];
        const secretKey = process.env[`${keyPrefix}${version}`];
        
        if (expireStr && secretKey) {
          try {
            const expireDate = new Date(expireStr);
            if (!isNaN(expireDate.getTime())) {
              this.keyExpirations.set(version, {
                version,
                expireDate,
                expireStr,
                secretKeyPreview: secretKey.slice(0, 8) + '...'
              });
            } else {
              console.warn(`[KeyExpiration] 警告: 密钥版本 ${version} 的过期时间格式无效: ${expireStr}`);
            }
          } catch (e) {
            console.error(`[KeyExpiration] 解析密钥版本 ${version} 过期时间失败:`, e.message);
          }
        }
      }
    }

    console.log(`[KeyExpiration] 已加载 ${this.keyExpirations.size} 个密钥的过期配置`);
    for (const [version, info] of this.keyExpirations) {
      const daysLeft = this.getDaysLeft(info.expireDate);
      const status = this.getKeyStatus(info.expireDate);
      console.log(`  - ${version}: 过期时间 ${info.expireStr}, 剩余 ${daysLeft.toFixed(1)} 天 [${status.label}]`);
    }
  }

  getDaysLeft(expireDate) {
    const now = new Date();
    const diffMs = expireDate.getTime() - now.getTime();
    return diffMs / DAY_MS;
  }

  getKeyStatus(expireDate) {
    const daysLeft = this.getDaysLeft(expireDate);
    
    if (daysLeft <= 0) {
      return { level: 'expired', label: '已过期', color: 'red' };
    } else if (daysLeft <= WARNING_DAYS) {
      return { level: 'warning', label: `即将过期(<${WARNING_DAYS}天)`, color: 'yellow' };
    } else if (daysLeft <= WARNING_DAYS * 2) {
      return { level: 'notice', label: '临近过期', color: 'blue' };
    } else {
      return { level: 'normal', label: '正常', color: 'green' };
    }
  }

  getExpiringKeys(level = null) {
    const result = [];
    for (const [version, info] of this.keyExpirations) {
      const status = this.getKeyStatus(info.expireDate);
      const daysLeft = this.getDaysLeft(info.expireDate);
      
      if (!level || status.level === level) {
        result.push({
          ...info,
          daysLeft: Number(daysLeft.toFixed(2)),
          status: status.level,
          statusLabel: status.label
        });
      }
    }
    return result.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  getAllKeysStatus() {
    return this.getExpiringKeys();
  }

  async sendWebhookNotification(warningKeys) {
    if (!WEBHOOK_URL) {
      return false;
    }

    const payload = {
      type: 'signature_key_expiration_warning',
      timestamp: new Date().toISOString(),
      warningDays: WARNING_DAYS,
      keys: warningKeys.map(k => ({
        version: k.version,
        expireDate: k.expireStr,
        daysLeft: k.daysLeft,
        secretKeyPreview: k.secretKeyPreview
      })),
      serverInfo: {
        hostname: require('os').hostname(),
        pid: process.pid
      }
    };

    const payloadStr = JSON.stringify(payload);
    
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Signature-Key-Expiration-Warning/1.0'
    };

    if (WEBHOOK_SECRET) {
      const signature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(payloadStr)
        .digest('hex');
      headers['X-Webhook-Signature'] = signature;
      headers['X-Webhook-Timestamp'] = Date.now().toString();
    }

    return new Promise((resolve) => {
      try {
        const parsedUrl = url.parse(WEBHOOK_URL);
        const httpModule = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.path,
          method: WEBHOOK_METHOD,
          headers: headers
        };

        const req = httpModule.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`[KeyExpiration] Webhook 推送成功, 状态码: ${res.statusCode}`);
            resolve(true);
          });
        });

        req.on('error', (err) => {
          console.error(`[KeyExpiration] Webhook 推送失败:`, err.message);
          resolve(false);
        });

        req.setTimeout(10000, () => {
          req.destroy(new Error('Webhook 请求超时'));
        });

        if (WEBHOOK_METHOD !== 'GET' && WEBHOOK_METHOD !== 'HEAD') {
          req.write(payloadStr);
        }
        req.end();
      } catch (err) {
        console.error(`[KeyExpiration] Webhook 推送异常:`, err.message);
        resolve(false);
      }
    });
  }

  async checkAndNotify(force = false) {
    const warningKeys = this.getExpiringKeys('warning');
    const expiredKeys = this.getExpiringKeys('expired');
    const allWarningKeys = [...expiredKeys, ...warningKeys];
    
    if (allWarningKeys.length === 0) {
      if (force) {
        console.log(`[KeyExpiration] 检查完成: 所有密钥状态正常`);
      }
      return { hasWarning: false, keys: [] };
    }

    const newWarningKeys = allWarningKeys.filter(k => 
      force || !this.notifiedKeys.has(k.version)
    );

    if (newWarningKeys.length === 0) {
      console.log(`[KeyExpiration] 检查完成: 有 ${allWarningKeys.length} 个密钥需要关注，但已推送过通知`);
      return { hasWarning: true, keys: allWarningKeys, alreadyNotified: true };
    }

    console.log('\n' + '='.repeat(70));
    console.log('⚠️  【密钥过期预警】发现需要关注的密钥');
    console.log('='.repeat(70));
    console.log(`预警阈值: 距离到期 ${WARNING_DAYS} 天`);
    console.log(`预警时间: ${new Date().toLocaleString('zh-CN')}`);
    console.log('-'.repeat(70));

    for (const key of newWarningKeys) {
      const icon = key.status === 'expired' ? '🔴' : '🟡';
      console.log(`${icon} 版本: ${key.version}`);
      console.log(`   密钥预览: ${key.secretKeyPreview}`);
      console.log(`   过期时间: ${key.expireStr}`);
      console.log(`   剩余天数: ${key.daysLeft} 天`);
      console.log(`   状态: ${key.statusLabel}`);
      
      if (key.status === 'expired') {
        console.log(`   🔥 紧急: 该密钥已过期，请立即完成密钥轮换！`);
      } else if (key.daysLeft <= 1) {
        console.log(`   🔥 紧急: 密钥将在 1 天内过期，请立即轮换！`);
      } else if (key.daysLeft <= 3) {
        console.log(`   ⚡ 高优: 密钥将在 3 天内过期，请尽快轮换！`);
      }
      
      console.log('-'.repeat(70));
    }

    console.log('📋 密钥轮换步骤:');
    console.log('   1. 在 .env 中新增 SIGNATURE_SECRET_KEY_Vn 及对应过期时间');
    console.log('   2. 修改 SIGNATURE_ACTIVE_VERSION 为新版本');
    console.log('   3. 重启服务（旧版本密钥保留，平滑过渡）');
    console.log('   4. 通知客户端升级到新版本密钥');
    console.log('   5. 确认所有客户端升级后，移除旧版本配置');
    console.log('='.repeat(70) + '\n');

    if (WEBHOOK_URL) {
      console.log(`[KeyExpiration] 正在推送 Webhook 通知到: ${WEBHOOK_URL}`);
      await this.sendWebhookNotification(newWarningKeys);
    }

    for (const key of newWarningKeys) {
      this.notifiedKeys.add(key.version);
    }

    return { hasWarning: true, keys: newWarningKeys };
  }

  startPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = setInterval(() => {
      this.checkAndNotify(false);
    }, CHECK_INTERVAL);

    setTimeout(() => {
      this.checkAndNotify(false);
    }, 5000);

    console.log(`[KeyExpiration] 已启动定期检查，间隔: ${CHECK_INTERVAL}ms (${(CHECK_INTERVAL / 3600000).toFixed(1)}小时)`);
  }

  stopPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      console.log('[KeyExpiration] 已停止定期检查');
    }
  }

  resetNotification(version = null) {
    if (version) {
      this.notifiedKeys.delete(version);
      console.log(`[KeyExpiration] 已重置版本 ${version} 的通知状态`);
    } else {
      this.notifiedKeys.clear();
      console.log('[KeyExpiration] 已重置所有版本的通知状态');
    }
  }

  reload() {
    this.loadKeyExpirations();
    this.notifiedKeys.clear();
    console.log('[KeyExpiration] 已重新加载密钥过期配置');
    return this.checkAndNotify(true);
  }
}

const keyExpirationManager = new KeyExpirationManager();

module.exports = {
  keyExpirationManager,
  KeyExpirationManager
};
