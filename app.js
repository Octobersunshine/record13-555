require('dotenv').config();

const express = require('express');
const { signatureAuth, getAvailableVersions, getActiveVersion, SECRET_KEYS } = require('./middleware/signatureAuth');
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

app.listen(PORT, () => {
  const versions = getAvailableVersions();
  const activeVersion = getActiveVersion();
  
  console.log('========================================');
  console.log('  Express Signature Auth Server');
  console.log('========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Signature Expire Time: ${process.env.SIGNATURE_EXPIRE_TIME || '300000'}ms`);
  console.log('');
  console.log('🔑 密钥版本配置（平滑切换支持）:');
  for (const version of versions) {
    const marker = version === activeVersion ? ' ⭐ 活跃版本' : '';
    const keyPreview = SECRET_KEYS[version].slice(0, 8) + '...';
    console.log(`   ${version}: ${keyPreview}${marker}`);
  }
  console.log('');
  console.log(`💡 当前活跃版本: ${activeVersion}`);
  console.log(`💡 并行生效版本数: ${versions.length} 个（平滑过渡期使用）`);
  console.log('========================================');
  console.log('Public API: GET /api/public/health');
  console.log('Protected APIs:');
  console.log('  GET    /api/user/info');
  console.log('  POST   /api/order/create');
  console.log('  PUT    /api/user/profile');
  console.log('  DELETE /api/order/:id');
  console.log('========================================');
  console.log('📋 密钥切换流程:');
  console.log('   1. 新增 SIGNATURE_SECRET_KEY_V3 配置');
  console.log('   2. 修改 SIGNATURE_ACTIVE_VERSION=V3');
  console.log('   3. 重启服务 → V1+V2+V3 同时生效');
  console.log('   4. 客户端分批升级使用 V3');
  console.log('   5. 监控日志，所有客户端升级完成后');
  console.log('   6. 移除 V1 配置，完成切换 ✓');
  console.log('========================================');
});
