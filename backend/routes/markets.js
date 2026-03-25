// backend/routes/markets.js
const express = require('express');
const mongoose = require('mongoose');

const Market = require('../models/Market');
const Bet = require('../models/Bet');
const User = require('../models/User');

const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { PublicKey } = require('@solana/web3.js');

const router = express.Router();

function solToLamports(sol) {
  const s = String(sol).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new Error('Invalid SOL amount');
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000000').slice(0, 9);
  return BigInt(whole) * 1000000000n + BigInt(fracPadded);
}
function lamportsToSol(lamports) {
  const x = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
  const whole = x / 1000000000n;
  const frac = x % 1000000000n;
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return fracStr.length ? `${whole.toString()}.${fracStr}` : whole.toString();
}
function bigToStr(x) {
  return (typeof x === 'bigint' ? x : BigInt(x)).toString();
}

router.get('/', async (req, res) => {
  try {
    const markets = await Market.find({}).sort({ createdAt: -1 }).lean();

    const payload = markets.map((m) => {
      const yesPool = BigInt(m.yesPoolLamports);
      const noPool = BigInt(m.noPoolLamports);
      const total = yesPool + noPool;

      const yesOdds = yesPool > 0n ? Number(total) / Number(yesPool) : 0;
      const noOdds = noPool > 0n ? Number(total) / Number(noPool) : 0;

      return {
        id: m._id.toString(),
        title: m.title,
        description: m.description,
        creatorWallet: m.creatorWallet,
        yesPoolSol: lamportsToSol(yesPool),
        noPoolSol: lamportsToSol(noPool),
        participants: m.participantsCount,
        endsAt: m.endsAt,
        resolved: m.resolved,
        resultSide: m.resultSide,

        // Odds (helper for UI; computed off internal pool)
        yesOdds,
        noOdds,
      };
    });

    return res.json({ markets: payload });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'GET_MARKETS_FAILED' });
  }
});

// POST /markets/create
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const creatorWallet = req.user.wallet;
    const { title, description, endsAt } = req.body || {};

    if (!title || typeof title !== 'string' || title.length < 3) return res.status(400).json({ error: 'title invalid' });
    if (!description || typeof description !== 'string' || description.length < 5) return res.status(400).json({ error: 'description invalid' });

    const ends = new Date(endsAt);
    if (Number.isNaN(ends.getTime())) return res.status(400).json({ error: 'endsAt invalid' });
    if (ends.getTime() <= Date.now()) return res.status(400).json({ error: 'endsAt must be in the future' });

    const market = await Market.create({
      title,
      description,
      creatorWallet,
      yesPoolLamports: '0',
      noPoolLamports: '0',
      participantsCount: 0,
      endsAt: ends,
      resolved: false,
      resultSide: null,
    });

    const ioRef = req.app.get('io');
    ioRef.emit('market_created', { marketId: market._id.toString() });
    ioRef.emit('new_market', { marketId: market._id.toString() });

    return res.json({
      ok: true,
      market: { id: market._id.toString(), title: market.title, description: market.description },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'MARKET_CREATE_FAILED' });
  }
});

// POST /markets/bet
router.post('/bet', authMiddleware, async (req, res) => {
  try {
    const userWallet = req.user.wallet;
    const { marketId, amount, side, clientBetId } = req.body || {};

    if (!marketId || !mongoose.isValidObjectId(marketId)) return res.status(400).json({ error: 'marketId invalid' });
    if (!clientBetId || typeof clientBetId !== 'string') return res.status(400).json({ error: 'clientBetId required' });

    if (side !== 'YES' && side !== 'NO') return res.status(400).json({ error: 'side must be YES or NO' });
    if (amount === undefined || amount === null) return res.status(400).json({ error: 'amount required' });

    const amountLamports = solToLamports(amount);
    if (amountLamports <= 0n) return res.status(400).json({ error: 'amount must be > 0' });

    // Idempotency: if same clientBetId -> return existing bet
    const existing = await Bet.findOne({ marketId, userWallet, clientBetId });
    if (existing) {
      return res.json({ ok: true, bet: existing });
    }

    // Atomic-ish via session transaction (consistent balance/pools)
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
      const user = await User.findOne({ wallet: userWallet }).session(session);
      if (!user) throw new Error('User not found');

      const userBal = BigInt(user.balanceLamports);
      if (userBal < amountLamports) throw new Error('INSUFFICIENT_BALANCE');

      const market = await Market.findById(marketId).session(session);
      if (!market) throw new Error('MARKET_NOT_FOUND');
      if (market.resolved) throw new Error('MARKET_RESOLVED');
      if (market.endsAt.getTime() <= Date.now()) throw new Error('MARKET_ENDED');

      // participant count: increment if this is first bet from this wallet in this market
      const hadAnyBet = await Bet.exists({ marketId, userWallet }).session(session);

      // Update pools
      const yesPool = BigInt(market.yesPoolLamports);
      const noPool = BigInt(market.noPoolLamports);

      if (side === 'YES') {
        market.yesPoolLamports = bigToStr(yesPool + amountLamports);
      } else {
        market.noPoolLamports = bigToStr(noPool + amountLamports);
      }

      if (!hadAnyBet) market.participantsCount = (market.participantsCount || 0) + 1;

      // Decrement user balance
      user.balanceLamports = bigToStr(userBal - amountLamports);

      await user.save({ session });
      await market.save({ session });

      await Bet.create(
        [{
          marketId,
          userWallet,
          side,
          amountLamports: bigToStr(amountLamports),
          clientBetId,
          status: 'OPEN',
          payoutLamports: '0',
          placedAt: new Date(),
          resolvedAt: null,
        }],
        { session }
      );
      });
    } finally {
      await session.endSession();
    }

    // Fetch the created bet (best-effort)
    const bet = await Bet.findOne({ marketId, userWallet, clientBetId }).lean();
    const ioRef = req.app.get('io');

    ioRef.emit('bet_created', {
      marketId,
      bet: {
        id: bet._id.toString(),
        userWallet: bet.userWallet,
        side: bet.side,
        amountSol: lamportsToSol(bet.amountLamports),
      },
    });
    ioRef.emit('new_bet', {
      marketId,
      userWallet: bet.userWallet,
      side: bet.side,
      amountSol: lamportsToSol(bet.amountLamports),
    });

    ioRef.emit('market_updated', { marketId });

    return res.json({ ok: true, bet });
  } catch (e) {
    console.error(e);
    const msg = e?.message || String(e);

    if (msg === 'INSUFFICIENT_BALANCE') return res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });
    if (msg === 'MARKET_NOT_FOUND') return res.status(404).json({ error: 'Market not found' });
    if (msg === 'MARKET_RESOLVED') return res.status(400).json({ error: 'Market resolved' });
    if (msg === 'MARKET_ENDED') return res.status(400).json({ error: 'Market ended' });
    return res.status(500).json({ error: 'MARKET_BET_FAILED', detail: msg });
  }
});

// POST /markets/resolve
router.post('/resolve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { marketId, resultSide } = req.body || {};
    if (!marketId || !mongoose.isValidObjectId(marketId)) return res.status(400).json({ error: 'marketId invalid' });
    if (resultSide !== 'YES' && resultSide !== 'NO') return res.status(400).json({ error: 'resultSide invalid' });

    const market = await Market.findById(marketId);
    if (!market) return res.status(404).json({ error: 'Market not found' });
    if (market.resolved) return res.status(400).json({ error: 'Already resolved' });

    const yesPool = BigInt(market.yesPoolLamports);
    const noPool = BigInt(market.noPoolLamports);
    const total = yesPool + noPool;

    const winningPool = resultSide === 'YES' ? yesPool : noPool;

    // Resolve in transaction
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      market.resolved = true;
      market.resultSide = resultSide;
      market.resolvedAt = new Date();
      await market.save({ session });

      const openBets = await Bet.find({ marketId, status: 'OPEN' }).session(session);

      // No division by zero case -> everyone gets 0
      const payoutMultiplierDen = winningPool > 0n ? winningPool : 1n;

      // Group payouts per user
      const payoutByUser = new Map(); // wallet -> BigInt payout
      const payoutForBet = new Map(); // betId -> payout

      for (const b of openBets) {
        const betAmt = BigInt(b.amountLamports);
        let payout = 0n;

        const isWinner = b.side === resultSide;
        if (isWinner && total > 0n && winningPool > 0n) {
          // payout = betAmt * total / winningPool
          payout = (betAmt * total) / payoutMultiplierDen;
        }

        payoutForBet.set(b._id.toString(), payout);
        if (payout > 0n) {
          const prev = payoutByUser.get(b.userWallet) || 0n;
          payoutByUser.set(b.userWallet, prev + payout);
        }
      }

      // Update bets statuses
      for (const b of openBets) {
        const payout = payoutForBet.get(b._id.toString()) || 0n;
        const isWinner = b.side === resultSide;

        b.status = payout > 0n ? 'PAYOUT_PAID' : 'LOST';
        b.payoutLamports = bigToStr(payout);
        b.resolvedAt = new Date();
        await b.save({ session });
      }

      // Credit winners internal balances
      for (const [wallet, payoutLamports] of payoutByUser.entries()) {
        const user = await User.findOne({ wallet }).session(session);
        if (!user) continue; // should not happen
        const prev = BigInt(user.balanceLamports);
        user.balanceLamports = bigToStr(prev + payoutLamports);
        await user.save({ session });
      }
    });

    const ioRef = req.app.get('io');
    ioRef.emit('market_resolved', { marketId, resultSide });
    ioRef.emit('market_updated', { marketId });

    return res.json({ ok: true, marketId, resultSide });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'MARKET_RESOLVE_FAILED', detail: e?.message || String(e) });
  }
});

// Optional: portfolio for frontend compatibility
router.get('/portfolio', authMiddleware, async (req, res) => {
  try {
    const wallet = req.user.wallet;
    const user = await User.findOne({ wallet }).lean();
    if (!user) return res.json({ user: { wallet, balanceSol: '0' }, bets: [] });

    const bets = await Bet.find({ userWallet: wallet })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const balanceSol = lamportsToSol(user.balanceLamports);

    return res.json({
      user: { wallet, balanceSol },
      bets: bets.map((b) => ({
        betId: b._id.toString(),
        marketId: b.marketId.toString(),
        side: b.side,
        amountSol: lamportsToSol(b.amountLamports),
        status: b.status,
        payoutSol: lamportsToSol(b.payoutLamports),
        placedAt: b.placedAt,
        resolvedAt: b.resolvedAt,
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'PORTFOLIO_FAILED' });
  }
});

module.exports = router;