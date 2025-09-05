const mongoose = require("mongoose");
const AssetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    symbol: { type: String, required: true, uppercase: true },
    type: { 
      type: String, 
      enum: ["stock", "mutual_fund", "crypto", "commodity"], // 👈 added commodity
      required: true 
    },
    quantity: { type: Number, required: true, min: 0 },
    buyPrice: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Asset", AssetSchema);
