// backend/models/Bet.js
const mongoose = require('mongoose');

const BetSchema = new mongoose.Schema(
  {
    marketId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'Market' },
    userWallet: { type: String, required: true, index: true },

    side: { type: String, enum: ['YES', 'NO'], required: true },
    amountLamports: { type: String, required: true },

    // idempotency key to prevent double bet (double-click / retry)
    clientBetId: { type: String, required: true },

    status: { type: String, enum: ['OPEN', 'PAYOUT_PAID', 'LOST'], default: 'OPEN' },
    payoutLamports: { type: String, default: '0' },
    placedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Unique constraint for double submit prevention
BetSchema.index({ marketId: 1, userWallet: 1, clientBetId: 1 }, { unique: true });

module.exports = mongoose.model('Bet', BetSchema);