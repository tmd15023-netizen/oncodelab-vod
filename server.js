require("dotenv").config();

const dns = require("dns");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHmac, randomBytes, scryptSync, timingSafeEqual } = require("crypto");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function useSystemDns() {
  const current = dns.getServers();
  const usable = current.filter(function (server) {
    return server !== "127.0.0.1" && server !== "::1";
  });
  if (usable.length || process.platform !== "win32") return;
  try {
    const output = execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-DnsClientServerAddress -AddressFamily IPv4).ServerAddresses -join ','"
    ], { encoding: "utf8" });
    const servers = output.split(/[\s,]+/).map(function (item) {
      return item.trim();
    }).filter(function (item) {
      return /^\d+\.\d+\.\d+\.\d+$/.test(item) && item !== "127.0.0.1";
    });
    const unique = servers.filter(function (item, index) {
      return servers.indexOf(item) === index;
    });
    if (unique.length) dns.setServers(unique);
  } catch (error) {
    return;
  }
}

useSystemDns();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "VOD";
const port = Number(process.env.PORT) || 3000;

function missingDatabaseConfig() {
  return !uri || uri.includes("USER:PASSWORD");
}

const app = express();
const client = missingDatabaseConfig() ? null : new MongoClient(uri);
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
let db;

app.use(express.json({ limit: "32kb" }));

app.use(function (req, res, next) {
  if (req.path.indexOf("/api/") !== 0) return next();
  startDatabase().then(function () {
    next();
  }).catch(function () {
    console.error("MongoDB에 접속하지 못했습니다.");
    res.status(500).json({ ok: false, message: "데이터베이스에 연결하지 못했습니다." });
  });
});

async function ensureIndexes(database) {
  await database.collection("users").createIndex({ email: 1 }, { unique: true });
  await database.collection("enrollments").createIndex(
    { userId: 1, courseId: 1 },
    { unique: true }
  );
  await database.collection("progress").createIndex(
    { userId: 1, courseId: 1 },
    { unique: true }
  );
  await database.collection("videos").createIndex({ lessonId: 1 }, { unique: true });
}

const r2Bucket = process.env.R2_BUCKET || "oncodelab-vod";
let r2Client = null;

function r2Ready() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && r2Bucket);
}

function r2() {
  if (!r2Client && r2Ready()) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: "https://" + process.env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return r2Client;
}

function publicVideo(row) {
  return {
    lessonId: row.lessonId,
    courseId: row.courseId || "",
    name: row.fileName || "",
    size: row.size || 0,
    type: row.contentType || "",
    seconds: row.seconds || 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0
  };
}

async function ensureR2Cors() {
  if (!r2Ready()) return;
  try {
    await r2().send(new PutBucketCorsCommand({
      Bucket: r2Bucket,
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: r2Origins(),
          AllowedMethods: ["GET", "PUT", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3600
        }]
      }
    }));
  } catch (error) {
    console.error("R2 CORS 설정을 건너뛰었습니다. 버킷 설정에서 사이트 주소를 허용해 주세요.");
  }
}

function r2Origins() {
  const origins = ["http://localhost:3000", "https://oncodelab-vod.vercel.app"];
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.push("https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  if (process.env.VERCEL_URL) {
    origins.push("https://" + process.env.VERCEL_URL);
  }
  return origins.filter(function (item, index) {
    return origins.indexOf(item) === index;
  });
}

async function ensureAdmin(database) {
  const admin = await database.collection("users").findOne({ role: "admin" });
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (admin || !adminPassword) return;
  const salt = randomBytes(16).toString("hex");
  await database.collection("users").insertOne({
    name: "관리자",
    email: "admin@ncodelab.kr",
    passwordSalt: salt,
    passwordHash: hashPassword(adminPassword, salt),
    role: "admin",
    createdAt: new Date()
  });
}

let starting = null;

function startDatabase() {
  if (db) return Promise.resolve(db);
  if (!client || missingDatabaseConfig()) return Promise.reject(new Error("missing-uri"));
  if (!starting) {
    starting = client.connect().then(async function () {
      db = client.db(dbName);
      await db.command({ ping: 1 });
      await ensureIndexes(db);
      await ensureR2Cors();
      await ensureAdmin(db);
      return db;
    }).catch(function () {
      starting = null;
      return Promise.reject(new Error("connect-failed"));
    });
  }
  return starting;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 32).toString("hex");
}

function passwordsMatch(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signSession(userId) {
  const mac = createHmac("sha256", sessionSecret).update(String(userId)).digest("hex");
  return String(userId) + "." + mac;
}

function readSession(req) {
  const header = req.headers.cookie || "";
  const parts = header.split(/;\s*/);
  var token = "";
  parts.forEach(function (part) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq) === "vod_session") token = decodeURIComponent(part.slice(eq + 1));
  });
  const dot = token.lastIndexOf(".");
  if (dot === -1) return "";
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret).update(userId).digest("hex");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return "";
  return userId;
}

function writeSessionCookie(res, value, maxAge) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", "vod_session=" + value + "; HttpOnly; Path=/; Max-Age=" + maxAge + "; SameSite=Lax" + secure);
}

function setSession(res, userId) {
  writeSessionCookie(res, encodeURIComponent(signSession(userId)), 1209600);
}

function clearSession(res) {
  writeSessionCookie(res, "", 0);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt ? new Date(user.createdAt).getTime() : 0
  };
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function currentUser(req) {
  const userId = readSession(req);
  if (!userId || !ObjectId.isValid(userId)) return null;
  return db.collection("users").findOne({ _id: new ObjectId(userId) });
}

function publicEnrollment(row) {
  const person = row.user && row.user[0];
  return {
    id: String(row._id),
    userId: String(row.userId),
    courseId: row.courseId,
    status: row.status,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).getTime() : 0,
    name: person ? person.name : "",
    email: person ? person.email : ""
  };
}

function publicProgress(row) {
  return {
    courseId: row.courseId,
    completed: row.completed || [],
    positions: row.positions || {},
    lastLesson: row.lastLesson || "",
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0
  };
}

async function enrollmentList(user) {
  const match = user.role === "admin" ? {} : { userId: user._id };
  const rows = await db.collection("enrollments").aggregate([
    { $match: match },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $sort: { createdAt: -1 } }
  ]).toArray();
  return rows.map(publicEnrollment);
}

app.get("/api/health", async function (req, res) {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, db: db.databaseName });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

app.get("/api/session", async function (req, res) {
  const user = await currentUser(req);
  if (!user) {
    res.json({ ok: true, user: null, enrollments: [], progress: [], users: [] });
    return;
  }
  const enrollments = await enrollmentList(user);
  const progress = await db.collection("progress").find({ userId: user._id }).toArray();
  const videos = await db.collection("videos").find({}, { projection: { key: 0 } }).toArray();
  const users = user.role === "admin"
    ? (await db.collection("users").find({}, { projection: { passwordHash: 0, passwordSalt: 0 } }).sort({ createdAt: 1 }).toArray()).map(publicUser)
    : [];
  res.json({
    ok: true,
    user: publicUser(user),
    enrollments: enrollments,
    progress: progress.map(publicProgress),
    videos: videos.map(publicVideo),
    users: users
  });
});

app.post("/api/register", async function (req, res) {
  const name = String((req.body && req.body.name) || "").trim().replace(/\s+/g, " ");
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (name.length < 2) return res.status(400).json({ ok: false, message: "이름은 두 글자 이상 입력해 주세요." });
  if (name.length > 20) return res.status(400).json({ ok: false, message: "이름은 20자 안으로 입력해 주세요." });
  if (!isEmail(email)) return res.status(400).json({ ok: false, message: "이메일 형식을 확인해 주세요." });
  if (password.length < 8) return res.status(400).json({ ok: false, message: "비밀번호는 8자 이상 입력해 주세요." });
  const salt = randomBytes(16).toString("hex");
  try {
    const result = await db.collection("users").insertOne({
      name: name,
      email: email,
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      role: "student",
      createdAt: new Date()
    });
    setSession(res, result.insertedId);
    res.json({ ok: true });
  } catch (error) {
    if (error && error.code === 11000) {
      res.status(409).json({ ok: false, message: "이미 가입된 이메일입니다." });
      return;
    }
    res.status(500).json({ ok: false, message: "회원가입에 실패했습니다." });
  }
});

app.post("/api/login", async function (req, res) {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (!email || !password) return res.status(400).json({ ok: false, message: "이메일과 비밀번호를 입력해 주세요." });
  const user = await db.collection("users").findOne({ email: email });
  if (!user || !passwordsMatch(password, user.passwordSalt, user.passwordHash)) {
    res.status(401).json({ ok: false, message: "이메일 또는 비밀번호가 맞지 않습니다." });
    return;
  }
  setSession(res, user._id);
  res.json({ ok: true });
});

app.post("/api/logout", function (req, res) {
  clearSession(res);
  res.json({ ok: true });
});

app.post("/api/enrollments", async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인 후 수강 신청할 수 있습니다." });
  if (user.role === "admin") return res.status(400).json({ ok: false, message: "관리자 계정은 승인 없이 영상을 볼 수 있습니다." });
  const courseId = String((req.body && req.body.courseId) || "");
  if (!courseId) return res.status(400).json({ ok: false, message: "강의를 선택해 주세요." });
  const existing = await db.collection("enrollments").findOne({ userId: user._id, courseId: courseId });
  if (existing && existing.status === "approved") return res.json({ ok: true, status: "approved", message: "이미 승인된 강의입니다." });
  if (existing && existing.status === "pending") return res.json({ ok: true, status: "pending", message: "이미 수강 신청이 접수되었습니다." });
  if (existing && existing.status === "rejected") {
    await db.collection("enrollments").updateOne({ _id: existing._id }, { $set: { status: "pending", createdAt: new Date(), reviewedAt: null } });
    return res.json({ ok: true, status: "pending", message: "수강 신청을 다시 접수했습니다. 승인 후 영상을 볼 수 있습니다." });
  }
  try {
    await db.collection("enrollments").insertOne({
      userId: user._id,
      courseId: courseId,
      status: "pending",
      createdAt: new Date(),
      reviewedAt: null
    });
  } catch (error) {
    if (error && error.code === 11000) return res.json({ ok: true, status: "pending", message: "이미 수강 신청이 접수되었습니다." });
    return res.status(500).json({ ok: false, message: "수강 신청에 실패했습니다." });
  }
  res.json({ ok: true, status: "pending", message: "수강 신청이 접수되었습니다. 관리자 승인 후 영상을 볼 수 있습니다." });
});

app.patch("/api/enrollments/:id", async function (req, res) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "관리자만 수강 신청을 처리할 수 있습니다." });
  const status = req.body && req.body.status;
  if (status !== "approved" && status !== "rejected") return res.status(400).json({ ok: false, message: "처리할 수 없는 상태입니다." });
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ ok: false, message: "신청을 찾을 수 없습니다." });
  const result = await db.collection("enrollments").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: status, reviewedAt: new Date() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, message: "신청을 찾을 수 없습니다." });
  res.json({ ok: true });
});

app.put("/api/progress/:courseId", async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  const courseId = String(req.params.courseId || "");
  const approved = user.role === "admin" || await db.collection("enrollments").findOne({ userId: user._id, courseId: courseId, status: "approved" });
  if (!approved) return res.status(403).json({ ok: false, message: "승인된 강의만 진도가 저장됩니다." });
  const body = req.body || {};
  const completed = Array.isArray(body.completed) ? body.completed.map(String).slice(0, 200) : [];
  const positions = body.positions && typeof body.positions === "object" ? body.positions : {};
  const safePositions = {};
  Object.keys(positions).slice(0, 200).forEach(function (key) {
    safePositions[key] = Math.max(0, Math.floor(Number(positions[key]) || 0));
  });
  await db.collection("progress").updateOne(
    { userId: user._id, courseId: courseId },
    {
      $set: {
        completed: completed,
        positions: safePositions,
        lastLesson: String(body.lastLesson || ""),
        updatedAt: new Date()
      },
      $setOnInsert: { userId: user._id, courseId: courseId }
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

app.delete("/api/progress", async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  await db.collection("progress").deleteMany({ userId: user._id });
  res.json({ ok: true });
});

app.post("/api/videos/:lessonId/upload", async function (req, res) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "관리자만 영상을 올릴 수 있습니다." });
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "영상 저장소 연결 정보가 없습니다. .env의 R2 값을 확인해 주세요." });
  const lessonId = String(req.params.lessonId || "");
  const fileName = String((req.body && req.body.fileName) || "video.mp4");
  const contentType = String((req.body && req.body.contentType) || "video/mp4");
  const match = fileName.match(/\.(mp4|webm|mov|m4v|ogg|ogv|mkv)$/i);
  const ext = match ? match[1].toLowerCase() : "mp4";
  const key = "lessons/" + lessonId + "." + ext;
  const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    ContentType: contentType
  }), { expiresIn: 60 * 30 });
  res.json({ ok: true, uploadUrl: uploadUrl, key: key });
});

app.post("/api/videos/:lessonId/complete", async function (req, res) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "관리자만 영상을 올릴 수 있습니다." });
  const lessonId = String(req.params.lessonId || "");
  const body = req.body || {};
  const key = String(body.key || "");
  if (!key || key.indexOf("lessons/" + lessonId + ".") !== 0) {
    return res.status(400).json({ ok: false, message: "영상 위치가 올바르지 않습니다." });
  }
  await db.collection("videos").updateOne(
    { lessonId: lessonId },
    {
      $set: {
        lessonId: lessonId,
        courseId: String(body.courseId || ""),
        fileName: String(body.fileName || ""),
        contentType: String(body.contentType || "video/mp4"),
        size: Math.max(0, Number(body.size) || 0),
        seconds: Math.max(0, Math.round(Number(body.seconds) || 0)),
        key: key,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

app.get("/api/videos/:lessonId/url", async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "영상 저장소가 연결되지 않았습니다." });
  const lessonId = String(req.params.lessonId || "");
  const video = await db.collection("videos").findOne({ lessonId: lessonId });
  if (!video) return res.json({ ok: true, url: "" });
  if (user.role !== "admin") {
    const approved = await db.collection("enrollments").findOne({
      userId: user._id,
      courseId: video.courseId,
      status: "approved"
    });
    if (!approved) return res.status(403).json({ ok: false, message: "승인된 수강생만 영상을 볼 수 있습니다." });
  }
  const url = await getSignedUrl(r2(), new GetObjectCommand({
    Bucket: r2Bucket,
    Key: video.key
  }), { expiresIn: 60 * 60 * 4 });
  res.json({ ok: true, url: url });
});

app.delete("/api/videos/:lessonId", async function (req, res) {
  const user = await currentUser(req);
  if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "관리자만 영상을 지울 수 있습니다." });
  const lessonId = String(req.params.lessonId || "");
  const video = await db.collection("videos").findOne({ lessonId: lessonId });
  if (video && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: video.key }));
  }
  await db.collection("videos").deleteOne({ lessonId: lessonId });
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

module.exports = app;

if (!process.env.VERCEL) {
  startDatabase().then(function () {
    app.listen(port, function () {
      console.log("VOD 서버가 http://localhost:" + port + " 에서 실행 중입니다.");
      console.log("MongoDB 데이터베이스: " + db.databaseName);
    });
  }).catch(function () {
    console.error("MongoDB에 접속하지 못했습니다. .env의 MONGODB_URI를 확인해 주세요.");
    process.exit(1);
  });
}
