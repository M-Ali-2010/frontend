require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { PublicKey, Connection } = require('@solana/web3.js');

const authRoutes = require('./routes/auth');
const marketsRoutes = require('./routes/markets');
const userRoutes = require('./routes/user');
const activityRoutes = require('./routes/activity');
const { setupSocket } = require('./socket');

const User = require('./models/User');
const Deposit = require('./models/Deposit');

const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});
setupSocket(io);
app.set('io', io);

// --- DB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[mongo] connected'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

// --- ROUTES ---
app.use('/auth', authRoutes);
app.use('/markets', marketsRoutes);
app.use('/user', userRoutes);
app.use('/activity', activityRoutes);

app.get('/health', (_, res) => res.json({ ok: true }));

// --- SOLANA ---
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const platformPk = new PublicKey(process.env.PLATFORM_WALLET_ADDRESS);

// --- WATCHER (НОРМ) ---
async function startDepositWatcher() {
  console.log('[deposit] watcher started');

  setInterval(async () => {
    try {
      const sigs = await connection.getSignaturesForAddress(platformPk, { limit: 20 });

      for (const s of sigs) {
        const exists = await Deposit.findOne({ signature: s.signature });
        if (exists) continue;

        const tx = await connection.getTransaction(s.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (!tx?.meta) continue;

        const keys = tx.transaction.message.accountKeys.map(k => k.toString());
        const idx = keys.indexOf(platformPk.toString());
        if (idx === -1) continue;

        const delta =
          BigInt(tx.meta.postBalances[idx]) -
          BigInt(tx.meta.preBalances[idx]);

        if (delta <= 0n) continue;

        // 🔥 безопаснее: sender = fee payer
        const sender = keys[0];

        // --- SAVE ---
        await Deposit.create({
          signature: s.signature,
          senderWallet: sender,
          amountLamports: delta.toString(),
        });

        await User.updateOne(
          { wallet: sender },
          { $inc: { balanceLamports: delta.toString() } },
          { upsert: true }
        );

        io.emit('deposit_received', {
          wallet: sender,
          amount: Number(delta) / 1e9,
        });

        console.log('[deposit]', sender, delta.toString());
      }

    } catch (e) {
      console.error('[deposit error]', e.message);
    }
  }, 5000);
}

// --- START ---
const PORT = process.env.PORT || 8080;

mongoose.connection.once('open', () => {
  server.listen(PORT, () => {
    console.log('[server] running', PORT);
  });

  startDepositWatcher();
});