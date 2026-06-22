require('dotenv').config();

const express = require('express');
const { signatureAuth, getAvailableVersions, getActiveVersion, SECRET_KEYS } = require('./middleware/signatureAuth');
const { keyExpirationManager } = require('./utils/keyExpirationManager');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  if (Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

app.get('/api/admin/key-status', (req, res) => {
  const warningDays = parseInt(process.env.SIGNATURE_KEY_WARNING_DAYS || '7', 10);
  const checkInterval = parseInt(process.env.SIGNATURE_KEY_CHECK_INTERVAL || '3600000', 10);
  
  res.json({
    code: 200,
    message: '获取密钥状态成功',
    data: {
      warningDays,
      checkIntervalMs: checkInterval,
      checkIntervalHours: (checkInterval / 3600000).toFixed(1),
      webhookEnabled: !!process.env.SIGNATURE_KEY_WARNING_WEBHOOK,
      keys: keyExpirationManager.getAllKeysStatus(),
      warningKeys: keyExpirationManager.getExpiringKeys('warning'),
      expiredKeys: keyExpirationManager.getExpiringKeys('expired'),
      notifiedVersions: Array.from(keyExpirationManager.notifiedKeys || [])
    }
  });
});

app.post('/api/admin/key-check', async (req, res) => {
  const result = await keyExpirationManager.checkAndNotify(true);
  res.json({
    code: 200,
    message: result.hasWarning ? '发现需要关注的密钥' : '所有密钥状态正常',
    data: result
  });
});

app.post('/api/admin/key-reload', async (req, res) => {
  const result = await keyExpirationManager.reload();
  res.json({
    code: 200,
    message: '已重新加载密钥配置',
    data: {
      ...result,
      keys: keyExpirationManager.getAllKeysStatus()
    }
  });
});

app.post('/api/admin/key-reset-notification', (req, res) => {
  const { version } = req.body;
  keyExpirationManager.resetNotification(version);
  res.json({
    code: 200,
    message: version ? `已重置版本 ${version} 的通知状态` : '已重置所有版本的通知状态',
    data: null
  });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/public/')) {
    return next();
  }
  return signatureAuth(req, res, next);
}, apiRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    data: null
  });
});

app.listen(PORT, async () => {
  const versions = getAvailableVersions();
  const activeVersion = getActiveVersion();
  const warningDays = parseInt(process.env.SIGNATURE_KEY_WARNING_DAYS || '7', 10);
  
  const keyStatusList = keyExpirationManager.getAllKeysStatus();
  const checkResult = await keyExpirationManager.checkAndNotify(true);
  
  console.log('================================================================');
  console.log('  Express Signature Auth Server');
  console.log('================================================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Signature Expire Time: ${process.env.SIGNATURE_EXPIRE_TIME || '300000'}ms`);
  console.log('');
  console.log('🔑 密钥版本配置（平滑切换支持）:');
  
  for (const version of versions) {
    const marker = version === activeVersion ? ' ⭐ 活跃版本' : '';
    const keyPreview = SECRET_KEYS[version].slice(0, 8) + '...';
    const statusInfo = keyStatusList.find(k => k.version === version);
    
    let statusLabel = '';
    if (statusInfo) {
      const statusIcons = {
        normal: '🟢',
        notice: '🔵',
        warning: '🟡',
        expired: '🔴'
      };
      const icon = statusIcons[statusInfo.status] || '⚪';
      statusLabel = ` | ${icon} ${statusInfo.statusLabel} | 剩余 ${statusInfo.daysLeft.toFixed(1)} 天 | 过期: ${statusInfo.expireStr}`;
    }
    
    console.log(`   ${version}: ${keyPreview}${marker}${statusLabel}`);
  }
  console.log('');
  console.log(`💡 当前活跃版本: ${activeVersion}`);
  console.log(`💡 并行生效版本数: ${versions.length} 个（平滑过渡期使用）`);
  console.log(`⏰ 过期预警阈值: 距离到期 ${warningDays} 天`);
  
  if (checkResult.hasWarning) {
    console.log(`⚠️  预警状态: 发现 ${checkResult.keys.length} 个密钥需要关注`);
  } else {
    console.log(`✅ 预警状态: 所有密钥状态正常`);
  }
  
  if (process.env.SIGNATURE_KEY_WARNING_WEBHOOK) {
    console.log(`📡 Webhook 通知: 已启用 → ${process.env.SIGNATURE_KEY_WARNING_WEBHOOK}`);
  } else {
    console.log(`📡 Webhook 通知: 未配置`);
  }
  
  console.log('================================================================');
  console.log('Public API: GET /api/public/health');
  console.log('Admin APIs (无需签名):');
  console.log('  GET    /api/admin/key-status           查看所有密钥状态');
  console.log('  POST   /api/admin/key-check            立即触发密钥检查');
  console.log('  POST   /api/admin/key-reload           重新加载密钥配置');
  console.log('  POST   /api/admin/key-reset-notification  重置通知状态');
  console.log('Protected APIs:');
  console.log('  GET    /api/user/info');
  console.log('  POST   /api/order/create');
  console.log('  PUT    /api/user/profile');
  console.log('  DELETE /api/order/:id');
  console.log('================================================================');
  console.log('📋 密钥切换流程:');
  console.log('   1. 在 .env 中新增 SIGNATURE_SECRET_KEY_Vn 及 SIGNATURE_KEY_EXPIRE_Vn');
  console.log('   2. 修改 SIGNATURE_ACTIVE_VERSION 为新版本');
  console.log('   3. 重启服务 → 新旧版本同时生效，平滑过渡');
  console.log('   4. 客户端分批升级使用新版本');
  console.log('   5. 监控日志和 /api/admin/key-status，确认升级完成');
  console.log('   6. 移除旧版本配置，完成切换 ✓');
  console.log('================================================================');
});
