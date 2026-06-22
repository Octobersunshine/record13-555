require('dotenv').config();

const express = require('express');
const { signatureAuth } = require('./middleware/signatureAuth');
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
  console.log('========================================');
  console.log('  Express Signature Auth Server');
  console.log('========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Signature Secret: ${process.env.SIGNATURE_SECRET_KEY || 'default_secret_key'}`);
  console.log(`Signature Expire Time: ${process.env.SIGNATURE_EXPIRE_TIME || '300000'}ms`);
  console.log('========================================');
  console.log('Public API: GET /api/public/health');
  console.log('Protected APIs:');
  console.log('  GET    /api/user/info');
  console.log('  POST   /api/order/create');
  console.log('  PUT    /api/user/profile');
  console.log('  DELETE /api/order/:id');
  console.log('========================================');
});
