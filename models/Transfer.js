
import mongoose from "mongoose";

const TransferSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  fromPeerId: String,
  toPeerId: String,
  filename: String,
  filesize: Number,
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  status: { type: String, enum: ["started","completed","failed"], default: "started" }
});

// Avoid model overwrite in dev/hot reload
export default mongoose.models.Transfer || mongoose.model("Transfer", TransferSchema);
