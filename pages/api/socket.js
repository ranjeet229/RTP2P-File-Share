// pages/api/socket.js
import { Server } from "socket.io";

export default function handler(req, res) {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server, {
      path: "/api/socket_io",
      addTrailingSlash: false,
    });

    io.on("connection", (socket) => {
      console.log("🔗 Socket connected:", socket.id);

      socket.on("join-room", ({ roomId, meta }) => {
        socket.join(roomId);
        socket.to(roomId).emit("peer-joined", { peerId: socket.id, meta });
      });

      socket.on("signal", ({ roomId, to, from, data }) => {
        if (to) {
          io.to(to).emit("signal", { from, data });
        } else {
          socket.to(roomId).emit("signal", { from, data });
        }
      });

      socket.on("transfer-complete", (payload) => {
        console.log("✅ Transfer complete", payload);
        io.to(payload.roomId).emit("transfer-logged", { id: Date.now() });
      });

      socket.on("disconnect", () => {
        console.log("❌ Socket disconnected:", socket.id);
      });
    });

    res.socket.server.io = io;
  }
  res.end();
}
