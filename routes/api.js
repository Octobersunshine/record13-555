const express = require('express');
const router = express.Router();

router.get('/public/health', (req, res) => {
  res.json({
    code: 200,
    message: '服务运行正常',
    data: {
      timestamp: Date.now(),
      status: 'ok'
    }
  });
});

router.get('/user/info', (req, res) => {
  res.json({
    code: 200,
    message: '获取用户信息成功',
    data: {
      id: 1001,
      username: 'test_user',
      email: 'test@example.com',
      role: 'admin'
    }
  });
});

router.post('/order/create', (req, res) => {
  const { productId, quantity, amount } = req.body;
  
  res.json({
    code: 200,
    message: '订单创建成功',
    data: {
      orderId: 'ORD' + Date.now(),
      productId,
      quantity,
      amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    }
  });
});

router.put('/user/profile', (req, res) => {
  const { nickname, avatar } = req.body;
  
  res.json({
    code: 200,
    message: '用户资料更新成功',
    data: {
      id: 1001,
      nickname,
      avatar,
      updatedAt: new Date().toISOString()
    }
  });
});

router.delete('/order/:id', (req, res) => {
  const { id } = req.params;
  
  res.json({
    code: 200,
    message: '订单删除成功',
    data: {
      orderId: id,
      deletedAt: new Date().toISOString()
    }
  });
});

module.exports = router;
