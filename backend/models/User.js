// backend/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    wallet: { type: String, required: true, unique: true, index: true },
    balanceLamports: { type: String, required: true, default: '0' },
    roles: { type: [String], default: ['user'] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);