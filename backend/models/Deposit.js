// backend/models/Deposit.js
const mongoose = require('mongoose');

const DepositSchema = new mongoose.Schema(
  {
    signature: { type: String, required: true, unique: true, index: true },
    senderWallet: { type: String, required: true, index: true },
    platformWallet: { type: String, required: true },
    amountLamports: { type: String, required: true },
    blockTime: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Deposit', DepositSchema);