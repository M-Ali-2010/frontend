const express = require('express');

const Bet = require('../models/Bet');
const Market = require('../models/Market');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function lamportsToSol(lamports) {
  const x = typeof lamports === 'bigint' ? lamports : BigInt(lamports || 0);
  const whole = x / 1000000000n;
  const frac = x % 1000000000n;
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return fracStr.length ? `${whole.toString()}.${fracStr}` : whole.toString();
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const bets = await Bet.find({})
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();
    const marketIds = [...new Set(bets.map((b) => b.marketId.toString()))];
    const markets = await Market.find({ _id: { $in: marketIds } }).lean();
    const marketById = new Map(markets.map((m) => [m._id.toString(), m.title]));

    const activity = bets.map((b) => ({
      id: b._id.toString(),
      wallet: b.userWallet,
      side: b.side,
      amountSol: lamportsToSol(b.amountLamports),
      marketId: b.marketId.toString(),
      marketTitle: marketById.get(b.marketId.toString()) || 'Unknown market',
      createdAt: b.placedAt || b.createdAt,
    }));

    return res.json({ activity });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'ACTIVITY_FETCH_FAILED' });
  }
});

module.exports = router;
