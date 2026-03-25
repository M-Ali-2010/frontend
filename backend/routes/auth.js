// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { PublicKey } = require('@solana/web3.js');

const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/connect', async (req, res) => {
  try {
    const wallet = req.body?.wallet;
    if (!wallet || typeof wallet !== 'string') return res.status(400).json({ error: 'wallet required' });

    let pk;
    try {
      pk = new PublicKey(wallet);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const walletStr = pk.toString();

    let user = await User.findOne({ wallet: walletStr });
    if (!user) {
      user = await User.create({ wallet: walletStr, balanceLamports: '0', roles: ['user'] });
    }

    const token = jwt.sign(
      { wallet: user.wallet, roles: user.roles },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    return res.json({
      token,
      user: {
        wallet: user.wallet,
        balanceLamports: user.balanceLamports,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'AUTH_CONNECT_FAILED' });
  }
});

module.exports = router;