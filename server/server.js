import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import dns from "dns/promises";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";

dotenv.config();

const PUBLIC_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

app.use(cors());
app.use(express.json());

const MONGODB_USER = process.env.MONGODB_USER || "dekshinamoorthypackirisamy_db_user";
const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || "<db_password>";
const MONGODB_CLUSTER = process.env.MONGODB_CLUSTER || "cluster1.axsixxn.mongodb.net";
const DEFAULT_DB_NAME = process.env.MONGODB_DBNAME || "roomDB";
const MONGODB_PASSWORD_PLACEHOLDER = "<db_password>";

const buildMongoUri = () => {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  return `mongodb+srv://${encodeURIComponent(MONGODB_USER)}:${encodeURIComponent(MONGODB_PASSWORD)}@${MONGODB_CLUSTER}/${DEFAULT_DB_NAME}?retryWrites=true&w=majority`;
};

const rawMongoUri = buildMongoUri();

const normalizeMongoUri = (uri) => {
  if (!uri) return uri;
  const hasExplicitDb = /mongodb(?:\+srv)?:\/\/[^/]+\/[^^?]+/.test(uri);
  if (hasExplicitDb) return uri;
  const [base, query] = uri.split("?");
  return `${base}/${DEFAULT_DB_NAME}${query ? `?${query}` : ""}`;
};

let mongoUri = normalizeMongoUri(rawMongoUri);
if (rawMongoUri.includes(MONGODB_PASSWORD_PLACEHOLDER)) {
  console.error(
    "MongoDB Atlas credentials are placeholder values. Update MONGODB_PASSWORD or MONGODB_URI in server/.env.",
  );
}

const memoryUsers = new Map();
const memoryHuddles = new Map();
const pendingJoinRequests = new Map();
const pendingJoinRequestSockets = new Map(); // guestSocketId -> roomId
let dbReady = false;
let dbError = null;
let User;
let Huddle;
let RoomParticipant;
let ActivityLog;

async function testAtlasSrvResolution() {
  if (!rawMongoUri.includes(MONGODB_PASSWORD_PLACEHOLDER)) {
    try {
      const clusterHost = rawMongoUri.match(/mongodb(?:\+srv)?:\/\/[^/]+@(.*?)(?:\/?|\?|$)/)?.[1];
      if (clusterHost) {
        const srvName = `_mongodb._tcp.${clusterHost}`;
        console.log(`Testing Atlas SRV resolution for ${srvName}`);
        const resolver = new dns.Resolver();
        resolver.setServers(PUBLIC_DNS_SERVERS);
        const records = await resolver.resolveSrv(srvName);
        console.log("Atlas SRV records:", records);
      }
    } catch (error) {
      console.error("Atlas SRV lookup failed:", error.code || error.name, error.message);
    }
  }
}

async function connectToDatabase() {
  try {
    if (mongoUri.startsWith("mongodb+srv://")) {
      dns.setServers(PUBLIC_DNS_SERVERS);
      console.log(
        "Configured Node DNS lookup to public resolvers for Atlas SRV:",
        PUBLIC_DNS_SERVERS.join(", "),
      );
    }
    console.log("Attempting MongoDB connection to cluster:", MONGODB_CLUSTER, "db:", DEFAULT_DB_NAME);
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    dbReady = true;
    dbError = null;
    User = mongoose.model(
      "User",
      new mongoose.Schema({
        googleId: { type: String, index: true, unique: true, sparse: true },
        email: { type: String, index: true, required: true, lowercase: true },
        displayName: String,
        roomId: String,
        createdAt: { type: Date, default: Date.now },
      }),
    );
    Huddle = mongoose.model(
      "Huddle",
      new mongoose.Schema({
        link: { type: String, unique: true, required: true },
        title: { type: String, required: true },
        purpose: { type: String, required: true },
        hostEmail: { type: String, required: true },
        scheduledAt: { type: Date, required: true },
        duration: { type: Number, required: true },
        ownerId: String,
        isPrivate: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
      }),
    );
    RoomParticipant = mongoose.model(
      "RoomParticipant",
      new mongoose.Schema({
        roomId: { type: String, required: true, index: true },
        socketId: { type: String, index: true },
        userId: { type: String, index: true },
        displayName: String,
        email: String,
        avatar: String,
        role: { type: String, enum: ["host", "member"], default: "member" },
        joinedAt: { type: Date, default: Date.now },
      }),
    );
    ActivityLog = mongoose.model(
      "ActivityLog",
      new mongoose.Schema({
        roomId: { type: String, required: true, index: true },
        userId: { type: String, index: true },
        actionType: { type: String, required: true, index: true },
        changesData: mongoose.Schema.Types.Mixed,
        createdAt: { type: Date, default: Date.now },
      }),
    );
    console.log("MongoDB connected");
  } catch (error) {
    dbError = error.message || String(error);
    console.warn(
      "MongoDB unavailable. Falling back to in-memory user store.",
      dbError,
    );
    if (rawMongoUri.includes(MONGODB_PASSWORD_PLACEHOLDER)) {
      console.error("Atlas credentials are still placeholder values.");
    }
  }
}

await testAtlasSrvResolution();
await connectToDatabase();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.log("[API] No authorization token provided");
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || "dev-secret";
    const decoded = jwt.verify(token, jwtSecret);
    console.log("[API] Token verified successfully for user:", decoded.sub || decoded.email);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("[API] Token verification failed:", {
      errorName: error.name,
      errorMessage: error.message,
      tokenPrefix: token?.substring(0, 20) + "...",
    });
    
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired - Please log in again" });
    }
    res.status(403).json({ error: "Invalid token - Please log in again" });
  }
}

async function upsertUser({ googleId, email, displayName, picture, roomId }) {
  if (dbReady && User) {
    return User.findOneAndUpdate(
      { googleId },
      { email, displayName, picture, roomId },
      { upsert: true, new: true },
    );
  }

  const key = googleId;
  const existing = memoryUsers.get(key);
  const user = {
    id: existing?.id || `${Date.now()}-${Math.random()}`,
    googleId,
    email,
    displayName,
    picture,
    roomId,
  };
  memoryUsers.set(key, user);
  return user;
}

app.post("/api/auth/google", async (req, res) => {
  const { credential, roomId, displayName } = req.body;
  if (!credential) return res.status(400).json({ error: "Missing credential" });

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    // normalize Google picture URL to a higher-resolution variant to avoid blank/small avatars
    const rawPicture = payload.picture || null;
    const picture = rawPicture ? rawPicture.replace(/=s\d+(-c)?/i, "=s400-c") : null;
    const user = await upsertUser({
      googleId: payload.sub,
      email: payload.email,
      displayName: payload.name || displayName,
      picture,
      roomId,
    });

    const token = jwt.sign(
      { sub: user.googleId || user.id, email: user.email },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "7d" },
    );
    console.log("[API] New JWT token issued for:", { email: user.email, sub: user.googleId || user.id });
    res.json({
      token,
      user: {
        id: user._id || user.id,
        email: user.email,
        displayName: user.displayName,
        picture: user.picture || null,
        roomId: user.roomId,
      },
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid Google token" });
  }
});

app.get("/api/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

function normalizeHuddle(huddle) {
  if (!huddle) return null;
  return {
    id: huddle._id || huddle.id,
    link: huddle.link,
    title: huddle.title,
    purpose: huddle.purpose,
    hostEmail: huddle.hostEmail,
    scheduledAt: huddle.scheduledAt,
    duration: huddle.duration,
    isPrivate: Boolean(huddle.isPrivate),
    ownerId: huddle.ownerId,
    createdAt: huddle.createdAt,
    updatedAt: huddle.updatedAt,
  };
}

function getHuddleLink(value) {
  return String(value || "")
    .trim()
    .replace(/^.*\/huddle\//, "")
    .replace(/^#/, "");
}

app.post("/api/huddles", async (req, res) => {
  const { title, purpose, hostEmail, scheduledAt, duration, ownerId } =
    req.body;
  if (!title || !purpose || !hostEmail || !scheduledAt || !duration) {
    return res
      .status(400)
      .json({
        error: "Title, purpose, host email, date, and duration are required",
      });
  }

  const scheduledDate = new Date(scheduledAt);
  const durationMinutes = Number(duration);
  if (
    Number.isNaN(scheduledDate.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0
  ) {
    return res.status(400).json({ error: "Enter a valid date and duration" });
  }

  const link = `huddle-${crypto.randomUUID().slice(0, 8)}`;
  const huddleData = {
    link,
    title: String(title).trim(),
    purpose: String(purpose).trim(),
    hostEmail: String(hostEmail).trim(),
    scheduledAt: scheduledDate,
    duration: durationMinutes,
    ownerId,
    isPrivate: Boolean(req.body.isPrivate),
    updatedAt: new Date(),
  };

  try {
    let huddle;
    if (dbReady && Huddle) {
      huddle = await Huddle.create(huddleData);
      if (RoomParticipant) {
        await RoomParticipant.create({
          roomId: link,
          userId: ownerId || null,
          displayName: "Host",
          email: hostEmail,
          role: "host",
          socketId: null,
          joinedAt: new Date(),
        }).catch(() => {});
      }
      if (ActivityLog) {
        await ActivityLog.create({
          roomId: link,
          userId: ownerId || null,
          actionType: "CREATE_ROOM",
          changesData: {
            title,
            purpose,
            hostEmail,
            ownerId,
          },
        }).catch(() => {});
      }
    } else {
      huddle = { ...huddleData, id: link, createdAt: new Date() };
      memoryHuddles.set(link, huddle);
    }
    res.status(201).json({ huddle: normalizeHuddle(huddle) });
  } catch (error) {
    console.error("Unable to create huddle", error);
    res.status(500).json({ error: "Unable to create huddle" });
  }
});

app.get("/api/huddles/:link", async (req, res) => {
  const link = getHuddleLink(req.params.link);
  const huddle =
    dbReady && Huddle
      ? await Huddle.findOne({ link })
      : memoryHuddles.get(link);
  if (!huddle) return res.status(404).json({ error: "Huddle link not found" });
  const now = new Date();
  const scheduledAt = new Date(huddle.scheduledAt);
  if (scheduledAt > now) {
    return res.status(425).json({
      error: "This huddle is not scheduled for now",
    });
  }

  if (huddle.endedAt && new Date(huddle.endedAt) <= now) {
    return res.status(410).json({
      error: "This huddle has ended",
    });
  }

  res.json({ huddle: normalizeHuddle(huddle) });
});

app.patch("/api/huddles/:link", async (req, res) => {
  const link = getHuddleLink(req.params.link);
  const updates = {};
  ["title", "purpose", "hostEmail", "scheduledAt", "duration", "isPrivate"].forEach(
    (field) => {
      if (req.body[field] !== undefined)
        updates[field] =
          field === "duration" ? Number(req.body[field]) : req.body[field];
    },
  );
  updates.updatedAt = new Date();

  if (dbReady && Huddle) {
    const huddle = await Huddle.findOneAndUpdate({ link }, updates, {
      new: true,
      runValidators: true,
    });
    if (!huddle)
      return res.status(404).json({ error: "Huddle link not found" });
    return res.json({ huddle: normalizeHuddle(huddle) });
  }

  const huddle = memoryHuddles.get(link);
  if (!huddle) return res.status(404).json({ error: "Huddle link not found" });
  Object.assign(huddle, updates);
  res.json({ huddle: normalizeHuddle(huddle) });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", database: dbReady ? "connected" : "fallback" });
});

app.get("/api/db-status", (_req, res) => {
  const status = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const uriStatus = rawMongoUri.includes(MONGODB_PASSWORD_PLACEHOLDER)
    ? "atlas-not-configured"
    : rawMongoUri.includes("mongodb+srv")
    ? "atlas-configured"
    : "local";
  res.json({
    status,
    uriStatus,
    mongoUri: uriStatus === "atlas-configured" ? "configured" : uriStatus,
    dbName: DEFAULT_DB_NAME,
    error: dbError,
  });
});

// Get user activity stats (hosted, joined, total attendees)
app.get("/api/user/:userId/stats", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log("[API] GET /api/user/:userId/stats", { userId, dbReady });

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (dbReady && Huddle && RoomParticipant) {
      try {
        // Get huddles hosted by this user
        const hostedHuddles = await Huddle.find({ ownerId: userId });
        console.log("[API] hostedHuddles:", { count: hostedHuddles.length, userId });

        const huddlesHosted = hostedHuddles.length;

        // Get rooms where user participated
        const participatedRooms = await RoomParticipant.find({ userId });
        console.log("[API] participatedRooms:", { count: participatedRooms.length, userId });

        const huddlesJoined = participatedRooms.filter((p) => p.role === "member").length;

        // Calculate total unique attendees across all hosted huddles
        const hostedRoomIds = hostedHuddles.map((h) => h.link);
        const totalAttendees = await RoomParticipant.countDocuments({
          roomId: { $in: hostedRoomIds },
          role: "member",
        });

        console.log("[API] stats computed:", { huddlesHosted, huddlesJoined, totalAttendees });

        return res.json({
          huddlesHosted,
          huddlesJoined,
          totalAttendees,
          userId,
        });
      } catch (dbError) {
        console.error("[API] Database error:", dbError);
        throw dbError;
      }
    }

    // Fallback to in-memory data
    const userHuddles = Array.from(memoryHuddles.values()).filter(
      (h) => h.ownerId === userId || h.hostEmail === req.user?.email,
    );
    const huddlesHosted = userHuddles.length;

    console.log("[API] Using fallback in-memory data:", { huddlesHosted, userId });

    res.json({
      huddlesHosted,
      huddlesJoined: 0,
      totalAttendees: 0,
      userId,
    });
  } catch (error) {
    console.error("[API] Error fetching user stats:", error.message);
    res.status(500).json({ error: `Failed to fetch user stats: ${error.message}` });
  }
});

// Get past meetings for a user
app.get("/api/user/:userId/pastMeetings", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    console.log("[API] GET /api/user/:userId/pastMeetings", { userId, limit, dbReady });

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (dbReady && Huddle && RoomParticipant) {
      try {
        // Get huddles hosted by this user (past meetings)
        const hostedHuddles = await Huddle.find({
          ownerId: userId,
          scheduledAt: { $lt: new Date() }, // Only past meetings
        })
          .sort({ scheduledAt: -1 })
          .limit(limit);

        console.log("[API] hostedHuddles for past meetings:", { count: hostedHuddles.length, userId });

        // Enrich with participant counts
        const pastMeetings = await Promise.all(
          hostedHuddles.map(async (huddle) => {
            const participantCount = await RoomParticipant.countDocuments({
              roomId: huddle.link,
            });

            return {
              id: huddle._id.toString(),
              title: huddle.title,
              purpose: huddle.purpose,
              scheduledAt: huddle.scheduledAt,
              duration: huddle.duration,
              participantCount,
              roomId: huddle.link,
            };
          }),
        );

        console.log("[API] pastMeetings computed:", { count: pastMeetings.length });

        return res.json({ pastMeetings });
      } catch (dbError) {
        console.error("[API] Database error:", dbError);
        throw dbError;
      }
    }

    // Fallback to in-memory data
    const userHuddles = Array.from(memoryHuddles.values())
      .filter((h) => h.ownerId === userId || h.hostEmail === req.user?.email)
      .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
      .slice(0, limit);

    console.log("[API] Using fallback in-memory data for meetings:", { count: userHuddles.length, userId });

    const pastMeetings = userHuddles.map((huddle) => ({
      id: huddle.id || `${Date.now()}-${Math.random()}`,
      title: huddle.title,
      purpose: huddle.purpose,
      scheduledAt: huddle.scheduledAt,
      duration: huddle.duration,
      participantCount: 0,
      roomId: huddle.link,
    }));

    res.json({ pastMeetings });
  } catch (error) {
    console.error("[API] Error fetching past meetings:", error.message);
    res.status(500).json({ error: `Failed to fetch past meetings: ${error.message}` });
  }
});

io.on("connection", (socket) => {
  // maintain a simple in-memory participant map per room
  socket.on("join-room", async ({ roomId, displayName, avatar, email, isHost, userId, userName }) => {
    if (!roomId) return;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.isHost = Boolean(isHost);
    socket.data.userId = userId || socket.data.userId || null;
    socket.data.userName = userName || socket.data.userName || displayName || null;
    socket.data.avatar = avatar || null;
    socket.data.displayName = displayName || "Guest";
    socket.data.email = email || "";
    socket.data.videoEnabled = false;
    socket.data.micEnabled = false;
    socket.data.speakingLevel = 0;

    if (dbReady && RoomParticipant) {
      try {
        await RoomParticipant.create({
          roomId,
          userId: socket.data?.userId || null,
          socketId: socket.id,
          displayName: displayName || "Guest",
          email: email || "",
          role: "member",
        });
      } catch (err) {
        if (err.code !== 11000) console.warn("RoomParticipant upsert failed", err.message);
      }
    }

    if (dbReady && ActivityLog) {
      ActivityLog.create({
        roomId,
        userId: socket.data?.userId || null,
        actionType: "JOIN_ROOM",
        changesData: { displayName, avatar, email, socketId: socket.id },
      }).catch((err) => {
        console.warn("ActivityLog join-room entry failed", err.message);
      });
    }

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const existing = clients
      .filter((id) => id !== socket.id)
      .map((id) => ({ socketId: id, ...io.sockets.sockets.get(id)?.data }));
    socket.emit("existing-participants", existing);
    socket.to(roomId).emit("user-connected", { socketId: socket.id });

    if (socket.data?.isHost) {
      const pendingRequests = pendingJoinRequests.get(roomId) || [];
      pendingRequests.forEach((request) => {
        socket.emit("incoming-join-request", request);
      });
    }
  });

  socket.on("participant-media-state", ({ roomId, videoEnabled, micEnabled, speakingLevel = 0 }) => {
    if (!roomId) return;
    socket.data.videoEnabled = Boolean(videoEnabled);
    socket.data.micEnabled = Boolean(micEnabled);
    socket.data.speakingLevel = Math.max(0, Math.min(1, Number(speakingLevel) || 0));
    socket.to(roomId).emit("participant-media-state", { socketId: socket.id, videoEnabled: socket.data.videoEnabled, micEnabled: socket.data.micEnabled, speakingLevel: socket.data.speakingLevel });
  });

  socket.on("announce", ({ roomId, displayName, avatar, email }) => {
    if (!roomId) return;
    socket.to(roomId).emit("participant-joined", {
      socketId: socket.id,
      displayName,
      avatar,
      email,
    });
  });

  const queueJoinRequest = (roomId, payload) => {
    if (!roomId || !payload?.guestSocketId) return null;
    const roomRequests = pendingJoinRequests.get(roomId) || [];
    const filtered = roomRequests.filter((existing) => {
      const sameGuest = existing.guestSocketId && payload.guestSocketId && existing.guestSocketId === payload.guestSocketId;
      const sameEmail = existing.guestEmail && payload.guestEmail && existing.guestEmail === payload.guestEmail;
      return !(sameGuest || sameEmail);
    });
    filtered.push(payload);
    pendingJoinRequests.set(roomId, filtered.slice(-10));
    pendingJoinRequestSockets.set(payload.guestSocketId, payload.guestSocketId);
    return filtered[filtered.length - 1];
  };

  const removePendingJoinRequest = (roomId, guestSocketId) => {
    if (!roomId || !guestSocketId) return;
    const roomRequests = pendingJoinRequests.get(roomId) || [];
    const next = roomRequests.filter((request) => request.guestSocketId !== guestSocketId);
    if (next.length > 0) {
      pendingJoinRequests.set(roomId, next);
    } else {
      pendingJoinRequests.delete(roomId);
    }
    pendingJoinRequestSockets.delete(guestSocketId);
  };

  const broadcastJoinRequestToHost = (roomId, payload) => {
    if (!roomId) return;

    const requestPayload = {
      roomId,
      userId: payload.userId || payload.guestSocketId || null,
      userName: payload.userName || payload.guestName || "Guest",
      userEmail: payload.userEmail || payload.guestEmail || null,
      guestSocketId: payload.guestSocketId || payload.socketId || null,
      guestName: payload.guestName || payload.userName || "Guest",
      guestEmail: payload.guestEmail || payload.userEmail || null,
      createdAt: Date.now(),
    };

    queueJoinRequest(roomId, requestPayload);

    const roomMembers = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const hostSocketIds = roomMembers.filter((memberSocketId) => {
      const memberSocket = io.sockets.sockets.get(memberSocketId);
      return Boolean(memberSocket?.data?.isHost);
    });

    if (hostSocketIds.length > 0) {
      hostSocketIds.forEach((hostSocketId) => {
        io.to(hostSocketId).emit("join-request", requestPayload);
        io.to(hostSocketId).emit("incoming-join-request", requestPayload);
      });
      return;
    }

    io.to(roomId).emit("join-request", requestPayload);
    io.to(roomId).emit("incoming-join-request", requestPayload);
  };

  const emitGuestJoinResponse = ({ roomId, guestSocketId, approved, reason, payload = {} }) => {
    if (!roomId || !guestSocketId) return;
    const socketId = pendingJoinRequestSockets.get(guestSocketId) || guestSocketId;
    const responsePayload = { roomId, reason, ...payload };
    io.to(socketId).emit(approved ? "accept" : "decline", responsePayload);
    io.to(socketId).emit(approved ? "join-request-accepted" : "join-request-declined", responsePayload);
    io.to(socketId).emit(approved ? "approved" : "rejected", responsePayload);
    io.to(socketId).emit(approved ? "approve-request" : "decline-request", responsePayload);
    io.to(socketId).emit(approved ? "accept-join-request" : "decline-join-request", responsePayload);
    io.to(socketId).emit(approved ? "join-request-approved" : "join-request-declined", responsePayload);
  };

  socket.on("send-join-request", ({ roomId, guestName, guestEmail, guestSocketId, userId, userName, userEmail }) => {
    const payload = {
      roomId,
      guestName,
      guestEmail,
      guestSocketId: guestSocketId || socket.id,
      userId,
      userName,
      userEmail,
    };
    broadcastJoinRequestToHost(roomId, payload);
  });

  socket.on("join-request", ({ roomId, guestName, guestEmail, guestSocketId, userId, userName, userEmail }) => {
    const payload = {
      roomId,
      guestName,
      guestEmail,
      guestSocketId: guestSocketId || socket.id,
      userId,
      userName,
      userEmail,
    };
    broadcastJoinRequestToHost(roomId, payload);
  });

  socket.on("approval-request-room", ({ roomId, guestName, guestEmail, guestSocketId, userId, userName, userEmail }) => {
    const payload = {
      roomId,
      guestName,
      guestEmail,
      guestSocketId: guestSocketId || socket.id,
      userId,
      userName,
      userEmail,
    };
    broadcastJoinRequestToHost(roomId, payload);
  });

  socket.on("approve-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: true, reason, payload });
  });

  socket.on("reject-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: false, reason, payload });
  });

  socket.on("accept-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: true, reason, payload });
  });

  socket.on("decline-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: false, reason, payload });
  });

  socket.on("accept-join-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: true, reason, payload });
    removePendingJoinRequest(roomId, guestSocketId);
  });

  socket.on("decline-join-request", ({ roomId, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved: false, reason, payload });
    removePendingJoinRequest(roomId, guestSocketId);
  });

  socket.on("join-request-response", ({ roomId, approved, guestSocketId, reason, ...payload }) => {
    emitGuestJoinResponse({ roomId, guestSocketId, approved, reason, payload });
    removePendingJoinRequest(roomId, guestSocketId);
  });

  socket.on("set-private", ({ roomId, isPrivate }) => {
    if (!roomId) return;
    io.to(roomId).emit("set-private", { isPrivate });
    // persist in memory if using memory store
    if (!dbReady) {
      const h = memoryHuddles.get(roomId);
      if (h) {
        h.isPrivate = Boolean(isPrivate);
        memoryHuddles.set(roomId, h);
      }
    } else if (dbReady && Huddle) {
      Huddle.findOneAndUpdate({ link: roomId }, { isPrivate: Boolean(isPrivate) }).catch(() => {});
    }
  });

  socket.on("mute-all", ({ roomId }) => {
    if (!roomId) return;
    io.to(roomId).emit("mute-all", { by: socket.id });
  });

  socket.on("kick-out", ({ roomId, targetSocketId }) => {
    if (!roomId || !targetSocketId) return;
    io.to(roomId).emit("kick-out", { targetSocketId, by: socket.id });
    // notify the kicked user directly if they're connected
    io.to(targetSocketId).emit("you-are-kicked", { roomId, by: socket.id });
  });

  socket.on("chat-message", ({ roomId, ...payload }) => {
    if (!roomId) return;
    io.to(roomId).emit("chat-message", payload);
  });

  socket.on("send_room_changes", async ({ roomId, changesData }) => {
    if (!roomId) return;
    io.to(roomId).emit("room_changes", { roomId, changesData, sender: socket.id });

    if (dbReady && ActivityLog) {
      ActivityLog.create({
        roomId,
        userId: socket.data?.userId || null,
        actionType: "LIVE_UPDATE",
        changesData,
      }).catch((err) => {
        console.warn("ActivityLog LIVE_UPDATE failed", err.message);
      });
    }
  });

  socket.on("hand-raise", ({ roomId, ...payload }) => {
    if (!roomId) return;
    io.to(roomId).emit("hand-raise", payload);
  });

  socket.on("emoji-reaction", (payload) => {
    // relay emoji reactions to everyone in the same room(s) except sender
    const rooms = Array.from(socket.rooms || []);
    for (const roomId of rooms) {
      if (roomId === socket.id) continue;
      socket.to(roomId).emit("emoji-reaction", payload);
    }
  });

  socket.on("offer", (payload) => socket.to(payload.to).emit("offer", payload));
  socket.on("answer", (payload) =>
    socket.to(payload.to).emit("answer", payload),
  );
  socket.on("ice-candidate", (payload) =>
    socket.to(payload.to).emit("ice-candidate", payload),
  );

  socket.on("disconnecting", () => {
    // remove any pending join requests tied to this socket prior to leaving
    for (const [roomId, requests] of pendingJoinRequests.entries()) {
      const next = requests.filter((request) => request.guestSocketId !== socket.id);
      if (next.length !== requests.length) {
        if (next.length > 0) {
          pendingJoinRequests.set(roomId, next);
        } else {
          pendingJoinRequests.delete(roomId);
        }
      }
    }
    pendingJoinRequestSockets.delete(socket.id);

    // notify all rooms this socket was part of that it left
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      socket.to(roomId).emit("participant-left", { socketId: socket.id });
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
