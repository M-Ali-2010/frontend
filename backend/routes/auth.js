const express = require('express');
const jwt = require('jsonwebtoken');
const { PublicKey, Connection } = require('@solana/web3.js');

const User = require('../models/User');

const router = express.Router();

// 🔥 подключение к RPC
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

router.post('/connect', async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET not set' });
    if (!process.env.SOLANA_RPC_URL) return res.status(500).json({ error: 'SOLANA_RPC_URL not set' });

    const wallet = req.body?.wallet;
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'wallet required' });
    }

    let pk;
    try {
      pk = new PublicKey(wallet);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const walletStr = pk.toString();

    // blockchain balance (display-only)
    let chainLamports = 0;
    try {
      chainLamports = await connection.getBalance(pk);
    } catch (e) {
      console.error('[balance error]', e.message);
    }

    let user = await User.findOne({ wallet: walletStr });

    if (!user) {
      user = await User.create({
        wallet: walletStr,
        balanceLamports: chainLamports.toString(),
        chainBalanceLamports: chainLamports.toString(),
        chainBalanceUpdatedAt: new Date(),
        roles: ['user'],
      });
    } else {
      user.chainBalanceLamports = chainLamports.toString();
      user.chainBalanceUpdatedAt = new Date();
      await user.save();
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
        chainBalanceLamports: user.chainBalanceLamports,
      },
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'AUTH_CONNECT_FAILED' });
  }
});

module.exports = router;