// backend/models/Market.js
const mongoose = require('mongoose');

const MarketSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },

    creatorWallet: { type: String, required: true, index: true },

    yesPoolLamports: { type: String, required: true, default: '0' },
    noPoolLamports: { type: String, required: true, default: '0' },

    participantsCount: { type: Number, required: true, default: 0 },

    endsAt: { type: Date, required: true },
    resolved: { type: Boolean, required: true, default: false },
    resultSide: { type: String, enum: ['YES', 'NO'], default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Market', MarketSchema);