// Join a room of browsers. The Rooms val handles the introductions
// (WebRTC "signaling"), then messages go directly between browsers over
// WebRTC data channels. Pairs that can't connect directly fall back to
// sending through Rooms.
//
//   import { join } from "https://backspaces-peers.val.run/peers.js";
//   const room = await join("lobby");
//   room.onMessage((data, from) => ...);
//   room.send(data);                  // everyone
//   room.send(data, { to: peerId });  // one peer
//   room.peers                        // Map of id -> { id, state }
//
// A peer's state is "connecting", "direct" or "relay". Options:
// `server` (another Rooms deployment), `id` (instead of a random one),
// `rtc` (RTCPeerConnection config, e.g. to add TURN servers).

const defaultServer = "https://backspaces-rooms.val.run";
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const pollMs = 1000;
const connectTimeoutMs = 15000; // no direct link by then: use the relay
const gatherTimeoutMs = 3000; // max wait for our network addresses

export async function join(
  roomName,
  { server = defaultServer, id, rtc = rtcConfig } = {},
) {
  const me = id ?? "peer-" + Math.random().toString(36).slice(2, 8);
  const url = `${server}/room/${roomName}`;
  const peers = new Map();
  const messageFns = [];
  const peerFns = [];
  let since = 0;
  let stopped = false;

  const post = (data, to) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: me, to, data }),
    }).then((res) => res.json());

  const changed = () => peerFns.forEach((fn) => fn(peers));
  const deliver = (data, from) => messageFns.forEach((fn) => fn(data, from));

  function setState(peer, state) {
    if (peer.state === state) return;
    peer.state = state;
    changed();
  }

  function addPeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);
    const peer = { id: peerId, state: "connecting" };
    peers.set(peerId, peer);
    peer.timer = setTimeout(() => {
      if (peer.state === "connecting") setState(peer, "relay");
    }, connectTimeoutMs);
    changed();
    return peer;
  }

  function removePeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return;
    clearTimeout(peer.timer);
    peer.pc?.close();
    peers.delete(peerId);
    changed();
  }

  function newConnection(peer) {
    const pc = new RTCPeerConnection(rtc);
    peer.pc = pc;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed") return;
      // Failing after it worked means they left; failing before means
      // our networks can't connect directly.
      if (peer.state === "direct") removePeer(peer.id);
      else setState(peer, "relay");
    };
    return pc;
  }

  function useChannel(peer, channel) {
    peer.channel = channel;
    channel.onopen = () => {
      clearTimeout(peer.timer);
      setState(peer, "direct");
    };
    channel.onclose = () => {
      if (peer.state === "direct" && peers.get(peer.id) === peer) {
        removePeer(peer.id);
      }
    };
    channel.onmessage = (e) => deliver(JSON.parse(e.data), peer.id);
  }

  // Our description plus the network addresses found so far. Sending
  // them all at once (rather than "trickling" each address as its own
  // message) suits Rooms' 1-second polling.
  async function localDescription(pc) {
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") resolve();
      });
      setTimeout(resolve, gatherTimeoutMs);
    });
    return pc.localDescription;
  }

  async function call(peer) {
    const pc = newConnection(peer);
    useChannel(peer, pc.createDataChannel("data"));
    await pc.setLocalDescription(await pc.createOffer());
    await post({ type: "offer", sdp: await localDescription(pc) }, peer.id);
  }

  async function answer(peer, sdp) {
    const pc = newConnection(peer);
    pc.ondatachannel = (e) => useChannel(peer, e.channel);
    await pc.setRemoteDescription(sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    await post({ type: "answer", sdp: await localDescription(pc) }, peer.id);
  }

  // A newcomer broadcasts "hello"; everyone already there replies
  // "welcome" to it alone. Either way, the lower id makes the call, so
  // exactly one side of each pair sends an offer.
  async function handle({ from, data: msg }) {
    if (from === me) return;
    switch (msg.type) {
      case "hello":
      case "welcome": {
        if (peers.has(from)) return;
        const peer = addPeer(from);
        if (msg.type === "hello") await post({ type: "welcome" }, from);
        if (me < from) await call(peer);
        return;
      }
      case "offer":
        return answer(addPeer(from), msg.sdp);
      case "answer":
        return peers.get(from)?.pc?.setRemoteDescription(msg.sdp);
      case "bye":
        return removePeer(from);
      case "data": // app data sent through the relay
        return deliver(msg.data, from);
    }
  }

  async function poll() {
    if (stopped) return;
    try {
      const res = await fetch(`${url}?since=${since}&me=${me}`);
      const { messages, last, more } = await res.json();
      since = last;
      for (const m of messages) {
        handle(m).catch((e) => console.warn("peers:", m.data.type, e));
      }
      if (more) return poll();
    } catch (e) {
      console.warn("peers: poll failed", e);
    }
    setTimeout(poll, pollMs);
  }

  function send(data, { to, directOnly = false } = {}) {
    const targets = to ? [peers.get(to)].filter(Boolean) : [...peers.values()];
    for (const peer of targets) {
      if (peer.channel?.readyState === "open") {
        peer.channel.send(JSON.stringify(data));
      } else if (!directOnly) {
        post({ type: "data", data }, peer.id);
      }
    }
  }

  function leave() {
    if (stopped) return;
    stopped = true;
    // sendBeacon still gets through while the page is closing.
    navigator.sendBeacon(url, JSON.stringify({ from: me, data: { type: "bye" } }));
    for (const peerId of [...peers.keys()]) removePeer(peerId);
  }
  addEventListener("pagehide", leave);

  // Start reading after our own hello: older messages (yesterday's
  // hellos and offers) aren't for us.
  const hello = await post({ type: "hello" });
  since = hello.id;
  poll();

  return {
    id: me,
    peers,
    send,
    leave,
    onMessage: (fn) => messageFns.push(fn),
    onPeers: (fn) => peerFns.push(fn),
  };
}
