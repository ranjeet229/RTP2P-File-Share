import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import SimplePeer from "simple-peer";

export default function Home() {
  const [socketReady, setSocketReady] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [log, setLog] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState([]);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const fileRef = useRef(null);
  const downloadRef = useRef(null);

  // incoming file state
  const incoming = useRef({
    receiving: false,
    filename: null,
    filesize: 0,
    chunks: [],
    receivedBytes: 0,
  });

  useEffect(() => {
    // Initialize API (ensures socket server is ready)
    fetch("/api/socket").then(() => {
      const socket = io({
        path: "/api/socket_io",
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        addLog(`socket connected ${socket.id}`);
        setSocketReady(true);
      });

      socket.on("peer-joined", ({ peerId, meta }) => {
        addLog(`peer joined ${peerId}`);
        setPeers((p) => (p.includes(peerId) ? p : [...p, peerId]));
      });

      socket.on("signal", ({ from, data }) => {
        addLog(`signal received from ${from}`);
        if (peerRef.current) {
          peerRef.current.signal(data);
        } else {
          createPeer(false, from);
          setTimeout(() => peerRef.current?.signal(data), 50);
        }
      });

      socket.on("transfer-logged", ({ id }) => {
        addLog(`transfer logged id=${id}`);
      });

      return () => socket.disconnect();
    });
  }, []);

  function addLog(msg) {
    setLog((l) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...l].slice(0, 200));
  }

  function createRoom() {
    if (!socketRef.current) return addLog("Socket not ready yet");
    const id = Math.random().toString(36).slice(2, 9).toUpperCase();
    setRoomId(id);
    setIsHost(true);
    socketRef.current.emit("join-room", { roomId: id, meta: { role: "host" } });
    addLog(`created room ${id}`);
  }

  function joinRoom() {
    if (!roomId) return addLog("enter room id");
    if (!socketRef.current) return addLog("Socket not ready yet");
    setIsHost(false);
    socketRef.current.emit("join-room", { roomId, meta: { role: "guest" } });
    addLog(`joined room ${roomId}`);
    createPeer(true);
  }

  function createPeer(initiator, targetPeerId = null) {
    addLog(`createPeer initiator=${initiator}`);
    const peer = new SimplePeer({
      initiator,
      trickle: false,
    });

    peer.on("signal", (data) => {
      addLog("peer signal produced, sending via socket");
      if (socketRef.current) {
        socketRef.current.emit("signal", {
          roomId,
          to: targetPeerId,
          from: socketRef.current.id,
          data,
        });
      }
    });

    peer.on("connect", () => addLog("peer connected (WebRTC)"));
    peer.on("data", (data) => handleIncomingData(data));
    peer.on("error", (err) => addLog("peer error: " + String(err)));
    peer.on("close", () => addLog("peer closed"));

    peerRef.current = peer;
    return peer;
  }

  async function sendFile() {
    if (!socketRef.current) return addLog("Socket not ready yet");
    const file = fileRef.current?.files?.[0];
    if (!file) return addLog("pick a file first");
    if (!peerRef.current) {
      addLog("no WebRTC peer — creating as initiator");
      createPeer(true);
      await new Promise((r) => setTimeout(r, 200));
    }
    addLog(`start sending ${file.name} (${file.size} bytes)`);

    // send metadata
    peerRef.current.send(JSON.stringify({ type: "meta", filename: file.name, filesize: file.size }));

    const CHUNK_SIZE = 16 * 1024;
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      try {
        peerRef.current.send(buffer);
      } catch (err) {
        addLog("send error: " + err);
        break;
      }
      offset += CHUNK_SIZE;
      addLog(`sent ${Math.min(offset, file.size)}/${file.size}`);
    }

    socketRef.current.emit("transfer-complete", {
      roomId,
      fromPeerId: socketRef.current.id,
      toPeerId: peers.length > 0 ? peers[0] : null,
      filename: file.name,
      filesize: file.size,
      completedAt: new Date(),
      status: "completed",
    });

    addLog("file send complete");
  }

  function handleIncomingData(raw) {
    if (typeof raw === "string" || raw instanceof String) {
      try {
        const obj = JSON.parse(raw);
        if (obj.type === "meta") {
          incoming.current.receiving = true;
          incoming.current.filename = obj.filename;
          incoming.current.filesize = obj.filesize;
          incoming.current.chunks = [];
          incoming.current.receivedBytes = 0;
          addLog(`incoming meta: ${obj.filename} (${obj.filesize})`);
        }
      } catch {
        addLog("received text: " + raw);
      }
      return;
    }

    incoming.current.chunks.push(raw);
    incoming.current.receivedBytes += raw.byteLength || raw.length;
    addLog(`received chunk ${incoming.current.receivedBytes}/${incoming.current.filesize}`);

    if (incoming.current.receivedBytes >= incoming.current.filesize) {
      const blob = new Blob(incoming.current.chunks);
      const url = URL.createObjectURL(blob);
      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = incoming.current.filename;
      }
      addLog(`file assembled: ${incoming.current.filename}`);
      incoming.current = { receiving: false, filename: null, filesize: 0, chunks: [], receivedBytes: 0 };
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>P2P File Share — Next.js Frontend</h1>

      <div style={{ marginTop: 12 }}>
        <button onClick={createRoom}>Create Room</button>
        <span style={{ marginLeft: 10 }}>or enter Room ID:</span>
        <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} style={{ marginLeft: 8 }} />
        <button onClick={joinRoom} style={{ marginLeft: 8 }}>Join Room</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <input type="file" ref={fileRef} />
        <button onClick={sendFile} style={{ marginLeft: 8 }}>Send File</button>
        <a ref={downloadRef} style={{ marginLeft: 16 }}>Download (appears after receive)</a>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Peers</h3>
        <div>{peers.length ? peers.join(", ") : "No peers yet"}</div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3>Logs</h3>
        <div style={{ maxHeight: 300, overflow: "auto", background: "#f6f6f6", padding: 10 }}>
          {log.map((l, idx) => (
            <div key={idx} style={{ fontSize: 13 }}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
