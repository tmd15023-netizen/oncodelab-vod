require("dotenv").config();

const dns = require("dns");
const path = require("path");
const { promisify } = require("util");
const { execFileSync } = require("child_process");
const { createHmac, randomBytes, scrypt, timingSafeEqual } = require("crypto");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const catalog = require("./public/js/data.js");

const scryptAsync = promisify(scrypt);

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
const SESSION_SECONDS = 1209600;
const ADMIN_EMAIL = "admin@ncodelab.kr";

function missingDatabaseConfig() {
  return !uri || uri.includes("USER:PASSWORD");
}

/* 배포 환경에서는 SESSION_SECRET가 꼭 있어야 합니다. 인스턴스마다 값이 다르면 로그인이 계속 풀립니다. */
const sessionSecret = process.env.SESSION_SECRET || (process.env.VERCEL ? "" : randomBytes(32).toString("hex"));
if (!process.env.SESSION_SECRET && !process.env.VERCEL) {
  console.warn("SESSION_SECRET가 없어 임시 값을 씁니다. 서버를 다시 켜면 로그인이 풀립니다.");
}

const app = express();
const client = missingDatabaseConfig() ? null : new MongoClient(uri);
let db;

/* Express 4는 async 핸들러의 오류를 잡지 않으므로, 오류를 아래 오류 처리기로 넘깁니다. */
function route(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.use(express.json({ limit: "32kb" }));

app.use(function (req, res, next) {
  if (req.path.indexOf("/api/") !== 0) return next();
  if (!sessionSecret) {
    console.error("SESSION_SECRET 환경 변수가 없습니다.");
    res.status(500).json({ ok: false, message: "서버 설정이 끝나지 않았습니다. SESSION_SECRET를 설정해 주세요." });
    return;
  }
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
  await database.collection("lessons").createIndex({ lessonId: 1 }, { unique: true });
  await database.collection("coursePages").createIndex({ courseId: 1 }, { unique: true });
  await database.collection("courses").createIndex({ courseId: 1 }, { unique: true });
}

const baseLessonCourse = {};
catalog.courses.forEach(function (course) {
  catalog.lessonsOf(course).forEach(function (lesson) {
    baseLessonCourse[lesson.id] = course.id;
  });
});

function isId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

async function courseExists(courseId) {
  if (!isId(courseId)) return false;
  const row = await db.collection("courses").findOne({ courseId: courseId }, { projection: { _id: 1 } });
  return !!row;
}

async function lessonCourse(lessonId) {
  if (!isId(lessonId)) return "";
  const course = await db.collection("courses").findOne(
    { "chapters.lessons.id": lessonId },
    { projection: { courseId: 1 } }
  );
  if (course) return course.courseId;
  const row = await db.collection("lessons").findOne({ lessonId: lessonId });
  if (row && await courseExists(row.courseId)) return row.courseId;
  return "";
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

function publicVideo(row, isAdmin) {
  const video = {
    lessonId: row.lessonId,
    courseId: row.courseId || "",
    seconds: row.seconds || 0
  };
  if (!isAdmin) return video;
  video.name = row.fileName || "";
  video.size = row.size || 0;
  video.type = row.contentType || "";
  video.updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  return video;
}

function clipText(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function clipLines(value, count, max) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const lines = [];
  source.forEach(function (item) {
    const line = clipText(item, max);
    if (line && lines.length < count) lines.push(line);
  });
  return lines;
}

const COVER_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const COVER_BYTES = 5 * 1024 * 1024;

const COURSE_TONES = ["violet", "blue", "coral", "teal", "ink"];

async function ensureCourseCatalog(database) {
  const meta = database.collection("meta");
  const state = await meta.findOne({ _id: "catalog" });
  if (state && state.seeded) return;
  const pages = await database.collection("coursePages").find({}).toArray();
  const pageById = {};
  pages.forEach(function (page) { pageById[page.courseId] = page; });
  const extraLessons = await database.collection("lessons").find({}).sort({ createdAt: 1 }).toArray();
  for (const course of catalog.courses) {
    const page = pageById[course.id] || {};
    const chapters = course.chapters.map(function (chapter) {
      return {
        title: chapter.title,
        lessons: chapter.lessons.map(function (lesson) {
          return {
            id: lesson.id,
            title: lesson.title,
            summary: lesson.summary || "",
            seconds: lesson.seconds || 0
          };
        })
      };
    });
    extraLessons.forEach(function (lesson) {
      if (lesson.courseId !== course.id) return;
      let chapter = null;
      chapters.forEach(function (item) {
        if (item.title === lesson.chapterTitle) chapter = item;
      });
      if (!chapter) {
        chapter = { title: lesson.chapterTitle, lessons: [] };
        chapters.push(chapter);
      }
      if (!chapter.lessons.some(function (item) { return item.id === lesson.lessonId; })) {
        chapter.lessons.push({
          id: lesson.lessonId,
          title: lesson.title,
          summary: lesson.summary || "",
          seconds: 0
        });
      }
    });
    await database.collection("courses").updateOne(
      { courseId: course.id },
      {
        $setOnInsert: {
          courseId: course.id,
          category: page.category || course.category,
          tone: course.tone || "violet",
          featured: course.featured !== false,
          pathLabel: (page.thumbLines && page.thumbLines[0]) || course.pathLabel || course.title,
          title: page.title || course.title,
          summary: page.summary || course.summary,
          audience: page.audience || course.audience,
          goals: page.goals && page.goals.length ? page.goals : course.goals,
          thumbLines: page.thumbLines && page.thumbLines.length ? page.thumbLines : course.thumbLines,
          chapters: chapters,
          coverKey: page.coverKey || "",
          coverType: page.coverType || "",
          coverSize: page.coverSize || 0,
          createdAt: new Date(),
          updatedAt: page.updatedAt || new Date()
        }
      },
      { upsert: true }
    );
  }
  await meta.updateOne({ _id: "catalog" }, { $set: { seeded: true, seededAt: new Date() } }, { upsert: true });
}

async function coverUrlFor(key) {
  if (!key || !r2Ready()) return "";
  return getSignedUrl(r2(), new GetObjectCommand({
    Bucket: r2Bucket,
    Key: key
  }), { expiresIn: 60 * 60 * 4 });
}

function publicChapter(chapter) {
  return {
    title: chapter.title || "",
    lessons: (chapter.lessons || []).map(function (lesson) {
      return {
        id: lesson.id,
        title: lesson.title || "",
        summary: lesson.summary || "",
        seconds: lesson.seconds || 0
      };
    })
  };
}

async function publicCatalog() {
  const rows = await db.collection("courses").find({}).sort({ createdAt: 1, title: 1 }).toArray();
  const list = [];
  for (const row of rows) {
    list.push({
      id: row.courseId,
      category: row.category || "강의",
      tone: row.tone || "violet",
      featured: row.featured !== false,
      pathLabel: row.pathLabel || row.title || "",
      title: row.title || "",
      summary: row.summary || "",
      audience: row.audience || "",
      goals: Array.isArray(row.goals) ? row.goals : [],
      thumbLines: Array.isArray(row.thumbLines) && row.thumbLines.length ? row.thumbLines : [row.title || "강의"],
      coverUrl: await coverUrlFor(row.coverKey),
      chapters: (row.chapters || []).map(publicChapter)
    });
  }
  return list;
}

async function pushLesson(courseId, chapterTitle, lesson) {
  const course = await db.collection("courses").findOne({ courseId: courseId });
  if (!course) return false;
  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  let chapter = null;
  chapters.forEach(function (item) {
    if (item.title === chapterTitle) chapter = item;
  });
  if (!chapter) {
    chapter = { title: chapterTitle, lessons: [] };
    chapters.push(chapter);
  }
  chapter.lessons = chapter.lessons || [];
  if (!chapter.lessons.some(function (item) { return item.id === lesson.id; })) {
    chapter.lessons.push({
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary || "",
      seconds: lesson.seconds || 0
    });
  }
  await db.collection("courses").updateOne(
    { courseId: courseId },
    { $set: { chapters: chapters, updatedAt: new Date() } }
  );
  return true;
}

async function detachLesson(lessonId) {
  const rows = await db.collection("courses").find({ "chapters.lessons.id": lessonId }).toArray();
  for (const course of rows) {
    const chapters = (course.chapters || []).map(function (chapter) {
      return {
        title: chapter.title,
        lessons: (chapter.lessons || []).filter(function (lesson) { return lesson.id !== lessonId; })
      };
    });
    await db.collection("courses").updateOne(
      { _id: course._id },
      { $set: { chapters: chapters, updatedAt: new Date() } }
    );
  }
}

async function deleteCourseBundle(courseId) {
  const course = await db.collection("courses").findOne({ courseId: courseId });
  if (!course) return false;
  const lessonIds = [];
  (course.chapters || []).forEach(function (chapter) {
    (chapter.lessons || []).forEach(function (lesson) {
      if (lesson.id) lessonIds.push(lesson.id);
    });
  });
  for (const lessonId of lessonIds) await deleteVideo(lessonId);
  await db.collection("lessons").deleteMany({ courseId: courseId });
  if (course.coverKey && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: course.coverKey }));
  }
  await db.collection("enrollments").deleteMany({ courseId: courseId });
  await db.collection("progress").deleteMany({ courseId: courseId });
  await db.collection("coursePages").deleteOne({ courseId: courseId });
  await db.collection("courses").deleteOne({ courseId: courseId });
  return true;
}

async function coursePages() {
  const rows = await db.collection("coursePages").find({}).toArray();
  const pages = [];
  for (const row of rows) {
    if (!await courseExists(row.courseId)) continue;
    let coverUrl = "";
    if (row.coverKey && r2Ready()) {
      coverUrl = await getSignedUrl(r2(), new GetObjectCommand({
        Bucket: r2Bucket,
        Key: row.coverKey
      }), { expiresIn: 60 * 60 * 4 });
    }
    pages.push({
      id: row.courseId,
      title: row.title || "",
      summary: row.summary || "",
      audience: row.audience || "",
      category: row.category || "",
      goals: Array.isArray(row.goals) ? row.goals : [],
      thumbLines: Array.isArray(row.thumbLines) ? row.thumbLines : [],
      coverUrl: coverUrl
    });
  }
  return pages;
}

function publicLesson(row) {
  return {
    id: row.lessonId,
    courseId: row.courseId,
    chapterTitle: row.chapterTitle,
    title: row.title,
    summary: row.summary,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0
  };
}

/* ADMIN_PASSWORD가 있으면 관리자 비밀번호를 그 값에 맞추고, 바뀌었으면 기존 로그인을 모두 끊습니다. */
/* 기본 관리자 계정만 다룹니다. 회원 화면에서 관리자로 바꾼 다른 계정의 비밀번호는 건드리지 않습니다. */
async function ensureAdmin(database) {
  const users = database.collection("users");
  const admin = await users.findOne({ email: ADMIN_EMAIL });
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (admin) console.warn("ADMIN_PASSWORD가 없어 관리자 비밀번호를 그대로 둡니다.");
    return;
  }
  const passwordOk = admin && await passwordsMatch(adminPassword, admin.passwordSalt, admin.passwordHash);
  if (admin && passwordOk && admin.role === "admin") return;
  if (admin && passwordOk) {
    await users.updateOne({ _id: admin._id }, { $set: { role: "admin" } });
    return;
  }
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(adminPassword, salt);
  if (admin) {
    await users.updateOne(
      { _id: admin._id },
      { $set: { role: "admin", passwordSalt: salt, passwordHash: passwordHash, sessionsValidAfter: new Date() } }
    );
    console.log("관리자 비밀번호를 ADMIN_PASSWORD 값으로 바꿨습니다.");
    return;
  }
  await users.insertOne({
    name: "관리자",
    email: ADMIN_EMAIL,
    passwordSalt: salt,
    passwordHash: passwordHash,
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
      const database = client.db(dbName);
      await database.command({ ping: 1 });
      await ensureIndexes(database);
      await ensureCourseCatalog(database);
      await ensureAdmin(database);
      db = database;
      return db;
    }).catch(function () {
      starting = null;
      return Promise.reject(new Error("connect-failed"));
    });
  }
  return starting;
}

async function hashPassword(password, salt) {
  return (await scryptAsync(password, salt, 32)).toString("hex");
}

async function passwordsMatch(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(await hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionMac(payload) {
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

/* 세션 값은 "사용자ID.발급시각.서명" 형태입니다. */
function signSession(userId) {
  const payload = String(userId) + "." + Date.now();
  return payload + "." + sessionMac(payload);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  let value = "";
  header.split(/;\s*/).forEach(function (part) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq) !== name) return;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch (error) {
      value = "";
    }
  });
  return value;
}

function readSession(req) {
  const parts = readCookie(req, "vod_session").split(".");
  if (parts.length !== 3) return null;
  const left = Buffer.from(parts[2]);
  const right = Buffer.from(sessionMac(parts[0] + "." + parts[1]));
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const issuedAt = Number(parts[1]);
  if (!issuedAt || Date.now() - issuedAt > SESSION_SECONDS * 1000) return null;
  return { userId: parts[0], issuedAt: issuedAt };
}

function writeSessionCookie(res, value, maxAge) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", "vod_session=" + value + "; HttpOnly; Path=/; Max-Age=" + maxAge + "; SameSite=Lax" + secure);
}

function setSession(res, userId) {
  writeSessionCookie(res, encodeURIComponent(signSession(userId)), SESSION_SECONDS);
}

function clearSession(res) {
  writeSessionCookie(res, "", 0);
}

/* 로그인 실패가 쌓이면 잠시 막습니다. 서버리스에서는 인스턴스마다 따로 셉니다. */
const LOGIN_WINDOW = 10 * 60 * 1000;
const loginFailures = new Map();

function clientIp(req) {
  const forwarded = process.env.VERCEL ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket.remoteAddress || "";
}

function loginBlocked(key, limit) {
  const row = loginFailures.get(key);
  if (!row) return false;
  if (Date.now() - row.first > LOGIN_WINDOW) {
    loginFailures.delete(key);
    return false;
  }
  return row.count >= limit;
}

function recordLoginFailure(key) {
  const now = Date.now();
  if (loginFailures.size > 5000) {
    loginFailures.forEach(function (row, item) {
      if (now - row.first > LOGIN_WINDOW) loginFailures.delete(item);
    });
  }
  const row = loginFailures.get(key);
  if (!row || now - row.first > LOGIN_WINDOW) loginFailures.set(key, { count: 1, first: now });
  else row.count += 1;
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
  const session = readSession(req);
  if (!session || !ObjectId.isValid(session.userId)) return null;
  const user = await db.collection("users").findOne({ _id: new ObjectId(session.userId) });
  if (!user) return null;
  if (user.sessionsValidAfter && session.issuedAt < new Date(user.sessionsValidAfter).getTime()) return null;
  return user;
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
    accessStart: row.accessStart ? new Date(row.accessStart).getTime() : 0,
    accessEnd: row.accessEnd ? new Date(row.accessEnd).getTime() : 0,
    name: person ? person.name : "",
    email: person ? person.email : ""
  };
}

function parseAccessBound(value, endOfDay) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + (endOfDay ? "T23:59:59.999+09:00" : "T00:00:00.000+09:00"));
  if (Number.isNaN(date.getTime())) return false;
  return date;
}

function accessOpen(row) {
  if (!row || row.status !== "approved") return false;
  const now = Date.now();
  if (row.accessStart && now < new Date(row.accessStart).getTime()) return false;
  if (row.accessEnd && now > new Date(row.accessEnd).getTime()) return false;
  return true;
}

function accessUpdate(body) {
  const accessStart = parseAccessBound(body && body.accessStart, false);
  const accessEnd = parseAccessBound(body && body.accessEnd, true);
  if (accessStart === false || accessEnd === false) return { error: "수강 기간 날짜를 확인해 주세요." };
  if (accessStart && accessEnd && accessStart.getTime() > accessEnd.getTime()) {
    return { error: "수강 시작일이 종료일보다 늦습니다." };
  }
  return { accessStart: accessStart, accessEnd: accessEnd };
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

/* 관리자가 추가하는 회차의 입력값을 확인합니다. 오류가 있으면 문자열을 돌려줍니다. */
async function cleanLesson(input) {
  const body = input || {};
  const courseId = String(body.courseId || "");
  const chapterTitle = String(body.chapterTitle || "").trim();
  const title = String(body.title || "").trim().replace(/\s+/g, " ");
  const summary = String(body.summary || "").trim();
  if (!await courseExists(courseId)) return "강의를 선택해 주세요.";
  if (!chapterTitle || chapterTitle.length > 40) return "챕터 이름을 40자 안으로 입력해 주세요.";
  if (title.length < 2 || title.length > 60) return "회차 제목은 2자에서 60자 사이로 입력해 주세요.";
  if (summary.length > 200) return "회차 설명은 200자 안으로 입력해 주세요.";
  return {
    courseId: courseId,
    chapterTitle: chapterTitle,
    title: title,
    summary: summary || "관리자가 추가한 회차입니다."
  };
}

async function deleteVideo(lessonId) {
  const video = await db.collection("videos").findOne({ lessonId: lessonId });
  if (video && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: video.key }));
  }
  await db.collection("videos").deleteOne({ lessonId: lessonId });
}

async function requireAdminUser(req, res, message) {
  const user = await currentUser(req);
  if (user && user.role === "admin") return user;
  res.status(403).json({ ok: false, message: message });
  return null;
}

app.get("/api/health", route(async function (req, res) {
  await db.command({ ping: 1 });
  res.json({ ok: true, db: db.databaseName });
}));

app.get("/api/session", route(async function (req, res) {
  const user = await currentUser(req);
  const isAdmin = !!(user && user.role === "admin");
  const lessons = await db.collection("lessons").find({}).sort({ createdAt: 1 }).toArray();
  const videos = await db.collection("videos").find({}, { projection: { key: 0 } }).toArray();
  const catalogList = await publicCatalog();
  if (!user) {
    res.json({
      ok: true,
      user: null,
      enrollments: [],
      progress: [],
      users: [],
      lessons: lessons.map(publicLesson),
      videos: videos.map(function (row) { return publicVideo(row, false); }),
      courses: catalogList,
      catalog: catalogList
    });
    return;
  }
  const enrollments = await enrollmentList(user);
  const progress = await db.collection("progress").find({ userId: user._id }).toArray();
  const users = isAdmin
    ? (await db.collection("users").find({}, { projection: { passwordHash: 0, passwordSalt: 0 } }).sort({ createdAt: 1 }).toArray()).map(publicUser)
    : [];
  res.json({
    ok: true,
    user: publicUser(user),
    enrollments: enrollments,
    progress: progress.map(publicProgress),
    lessons: lessons.map(publicLesson),
    videos: videos.map(function (row) { return publicVideo(row, isAdmin); }),
    users: users,
    courses: catalogList,
    catalog: catalogList
  });
}));

app.post("/api/register", route(async function (req, res) {
  const name = String((req.body && req.body.name) || "").trim().replace(/\s+/g, " ");
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (name.length < 2) return res.status(400).json({ ok: false, message: "이름은 두 글자 이상 입력해 주세요." });
  if (name.length > 20) return res.status(400).json({ ok: false, message: "이름은 20자 안으로 입력해 주세요." });
  if (!isEmail(email) || email.length > 120) return res.status(400).json({ ok: false, message: "이메일 형식을 확인해 주세요." });
  if (email === ADMIN_EMAIL) return res.status(409).json({ ok: false, message: "이미 가입된 이메일입니다." });
  if (password.length < 8) return res.status(400).json({ ok: false, message: "비밀번호는 8자 이상 입력해 주세요." });
  if (password.length > 200) return res.status(400).json({ ok: false, message: "비밀번호는 200자 안으로 입력해 주세요." });
  const salt = randomBytes(16).toString("hex");
  try {
    const result = await db.collection("users").insertOne({
      name: name,
      email: email,
      passwordSalt: salt,
      passwordHash: await hashPassword(password, salt),
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
    throw error;
  }
}));

app.post("/api/login", route(async function (req, res) {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  const password = String((req.body && req.body.password) || "");
  if (!email || !password) return res.status(400).json({ ok: false, message: "이메일과 비밀번호를 입력해 주세요." });
  const emailKey = "email:" + email;
  const ipKey = "ip:" + clientIp(req);
  if (loginBlocked(emailKey, 5) || loginBlocked(ipKey, 30)) {
    return res.status(429).json({ ok: false, message: "로그인 시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요." });
  }
  const user = await db.collection("users").findOne({ email: email });
  if (!user || password.length > 200 || !await passwordsMatch(password, user.passwordSalt, user.passwordHash)) {
    recordLoginFailure(emailKey);
    recordLoginFailure(ipKey);
    res.status(401).json({ ok: false, message: "이메일 또는 비밀번호가 맞지 않습니다." });
    return;
  }
  loginFailures.delete(emailKey);
  setSession(res, user._id);
  res.json({ ok: true });
}));

app.post("/api/logout", function (req, res) {
  clearSession(res);
  res.json({ ok: true });
});

app.post("/api/enrollments", route(async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인 후 수강 신청할 수 있습니다." });
  if (user.role === "admin") return res.status(400).json({ ok: false, message: "관리자 계정은 승인 없이 영상을 볼 수 있습니다." });
  const courseId = String((req.body && req.body.courseId) || "");
  if (!await courseExists(courseId)) return res.status(400).json({ ok: false, message: "강의를 찾을 수 없습니다." });
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
    throw error;
  }
  res.json({ ok: true, status: "pending", message: "수강 신청이 접수되었습니다. 관리자 승인 후 영상을 볼 수 있습니다." });
}));

app.patch("/api/enrollments/:id", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 수강 신청을 처리할 수 있습니다.")) return;
  const status = req.body && req.body.status;
  if (status !== "approved" && status !== "rejected") return res.status(400).json({ ok: false, message: "처리할 수 없는 상태입니다." });
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ ok: false, message: "신청을 찾을 수 없습니다." });
  const bounds = accessUpdate(req.body);
  if (bounds.error) return res.status(400).json({ ok: false, message: bounds.error });
  const update = { status: status, reviewedAt: new Date() };
  if (status === "rejected") {
    update.accessStart = null;
    update.accessEnd = null;
  } else {
    if (bounds.accessStart !== undefined) update.accessStart = bounds.accessStart;
    if (bounds.accessEnd !== undefined) update.accessEnd = bounds.accessEnd;
  }
  const result = await db.collection("enrollments").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: update }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, message: "신청을 찾을 수 없습니다." });
  res.json({ ok: true });
}));

app.post("/api/admin/enrollments", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 수강을 승인할 수 있습니다.")) return;
  const body = req.body || {};
  const userId = String(body.userId || "");
  const courseId = String(body.courseId || "");
  if (!ObjectId.isValid(userId)) return res.status(400).json({ ok: false, message: "회원을 선택해 주세요." });
  if (!await courseExists(courseId)) return res.status(400).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const student = await db.collection("users").findOne({ _id: new ObjectId(userId) });
  if (!student || student.role !== "student") return res.status(400).json({ ok: false, message: "수강생 계정을 선택해 주세요." });
  const bounds = accessUpdate(body);
  if (bounds.error) return res.status(400).json({ ok: false, message: bounds.error });
  await db.collection("enrollments").updateOne(
    { userId: student._id, courseId: courseId },
    {
      $set: {
        status: "approved",
        reviewedAt: new Date(),
        accessStart: bounds.accessStart || null,
        accessEnd: bounds.accessEnd || null
      },
      $setOnInsert: { userId: student._id, courseId: courseId, createdAt: new Date() }
    },
    { upsert: true }
  );
  res.json({ ok: true });
}));

app.patch("/api/users/:id", route(async function (req, res) {
  const admin = await requireAdminUser(req, res, "관리자만 회원 권한을 바꿀 수 있습니다.");
  if (!admin) return;
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ ok: false, message: "회원을 찾을 수 없습니다." });
  const role = req.body && req.body.role;
  if (role !== "admin" && role !== "student") return res.status(400).json({ ok: false, message: "바꿀 수 없는 권한입니다." });
  if (String(admin._id) === req.params.id) return res.status(400).json({ ok: false, message: "로그인한 계정의 권한은 바꿀 수 없습니다." });
  const target = await db.collection("users").findOne({ _id: new ObjectId(req.params.id) });
  if (!target) return res.status(404).json({ ok: false, message: "회원을 찾을 수 없습니다." });
  if (target.email === ADMIN_EMAIL) return res.status(400).json({ ok: false, message: "기본 관리자 계정의 권한은 바꿀 수 없습니다." });
  await db.collection("users").updateOne({ _id: target._id }, { $set: { role: role } });
  res.json({ ok: true });
}));

app.delete("/api/users/:id", route(async function (req, res) {
  const admin = await requireAdminUser(req, res, "관리자만 회원을 삭제할 수 있습니다.");
  if (!admin) return;
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ ok: false, message: "회원을 찾을 수 없습니다." });
  if (String(admin._id) === req.params.id) return res.status(400).json({ ok: false, message: "로그인한 관리자 계정은 삭제할 수 없습니다." });
  const target = await db.collection("users").findOne({ _id: new ObjectId(req.params.id) });
  if (!target) return res.status(404).json({ ok: false, message: "회원을 찾을 수 없습니다." });
  if (target.role === "admin") return res.status(400).json({ ok: false, message: "관리자 계정은 삭제할 수 없습니다." });
  const userId = target._id;
  await db.collection("enrollments").deleteMany({ userId: userId });
  await db.collection("progress").deleteMany({ userId: userId });
  await db.collection("users").deleteOne({ _id: userId });
  res.json({ ok: true });
}));

app.put("/api/progress/:courseId", route(async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  const courseId = String(req.params.courseId || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const enrollment = user.role === "admin" ? { status: "approved" } : await db.collection("enrollments").findOne({ userId: user._id, courseId: courseId });
  if (!accessOpen(enrollment)) return res.status(403).json({ ok: false, message: "수강 기간 안의 승인된 강의만 진도가 저장됩니다." });
  const body = req.body || {};
  const completed = Array.isArray(body.completed) ? body.completed.filter(isId).slice(0, 200) : [];
  const positions = body.positions && typeof body.positions === "object" ? body.positions : {};
  const safePositions = {};
  Object.keys(positions).filter(isId).slice(0, 200).forEach(function (key) {
    safePositions[key] = Math.max(0, Math.floor(Number(positions[key]) || 0));
  });
  await db.collection("progress").updateOne(
    { userId: user._id, courseId: courseId },
    {
      $set: {
        completed: completed,
        positions: safePositions,
        lastLesson: isId(body.lastLesson) ? body.lastLesson : "",
        updatedAt: new Date()
      },
      $setOnInsert: { userId: user._id, courseId: courseId }
    },
    { upsert: true }
  );
  res.json({ ok: true });
}));

app.delete("/api/progress", route(async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  await db.collection("progress").deleteMany({ userId: user._id });
  res.json({ ok: true });
}));

app.post("/api/lessons", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 회차를 추가할 수 있습니다.")) return;
  const lesson = await cleanLesson(req.body);
  if (typeof lesson === "string") return res.status(400).json({ ok: false, message: lesson });
  lesson.lessonId = "lesson-" + Date.now().toString(36) + randomBytes(4).toString("hex");
  lesson.createdAt = new Date();
  await db.collection("lessons").insertOne(lesson);
  await pushLesson(lesson.courseId, lesson.chapterTitle, {
    id: lesson.lessonId,
    title: lesson.title,
    summary: lesson.summary,
    seconds: 0
  });
  res.json({ ok: true, id: lesson.lessonId });
}));

/* 예전에 관리자 브라우저(localStorage)에만 저장했던 회차를 서버로 옮깁니다. */
app.post("/api/lessons/import", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 회차를 옮길 수 있습니다.")) return;
  const rows = Array.isArray(req.body && req.body.lessons) ? req.body.lessons.slice(0, 200) : [];
  let imported = 0;
  for (const row of rows) {
    const lessonId = String((row && row.id) || "");
    const lesson = await cleanLesson(row);
    if (!/^lesson-[a-z0-9]{1,40}$/.test(lessonId) || typeof lesson === "string") continue;
    const result = await db.collection("lessons").updateOne(
      { lessonId: lessonId },
      { $setOnInsert: Object.assign(lesson, { lessonId: lessonId, createdAt: new Date() }) },
      { upsert: true }
    );
    if (result.upsertedCount) {
      imported += 1;
      await pushLesson(lesson.courseId, lesson.chapterTitle, {
        id: lessonId,
        title: lesson.title,
        summary: lesson.summary,
        seconds: 0
      });
    }
  }
  res.json({ ok: true, imported: imported });
}));

app.delete("/api/lessons/:lessonId", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 회차를 삭제할 수 있습니다.")) return;
  const lessonId = String(req.params.lessonId || "");
  if (!isId(lessonId)) return res.status(404).json({ ok: false, message: "회차를 찾을 수 없습니다." });
  const course = await db.collection("courses").findOne({ "chapters.lessons.id": lessonId }, { projection: { _id: 1 } });
  const custom = await db.collection("lessons").findOne({ lessonId: lessonId }, { projection: { _id: 1 } });
  if (!course && !custom) return res.status(404).json({ ok: false, message: "회차를 찾을 수 없습니다." });
  await deleteVideo(lessonId);
  await detachLesson(lessonId);
  await db.collection("lessons").deleteOne({ lessonId: lessonId });
  res.json({ ok: true });
}));

app.post("/api/videos/:lessonId/upload", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 영상을 올릴 수 있습니다.")) return;
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "영상 저장소 연결 정보가 없습니다. .env의 R2 값을 확인해 주세요." });
  const lessonId = String(req.params.lessonId || "");
  if (!await lessonCourse(lessonId)) return res.status(404).json({ ok: false, message: "회차를 찾을 수 없습니다." });
  const fileName = String((req.body && req.body.fileName) || "video.mp4");
  const requestedType = String((req.body && req.body.contentType) || "");
  const contentType = /^video\/[A-Za-z0-9.+-]{1,40}$/.test(requestedType) ? requestedType : "video/mp4";
  const match = fileName.match(/\.(mp4|webm|mov|m4v|ogg|ogv|mkv)$/i);
  const ext = match ? match[1].toLowerCase() : "mp4";
  const key = "lessons/" + lessonId + "." + ext;
  const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    ContentType: contentType
  }), { expiresIn: 60 * 30 });
  res.json({ ok: true, uploadUrl: uploadUrl, key: key, contentType: contentType });
}));

app.post("/api/videos/:lessonId/complete", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 영상을 올릴 수 있습니다.")) return;
  const lessonId = String(req.params.lessonId || "");
  const courseId = await lessonCourse(lessonId);
  if (!courseId) return res.status(404).json({ ok: false, message: "회차를 찾을 수 없습니다." });
  const body = req.body || {};
  const key = String(body.key || "");
  if (!/^lessons\/[A-Za-z0-9_-]+\.(mp4|webm|mov|m4v|ogg|ogv|mkv)$/.test(key) || key.indexOf("lessons/" + lessonId + ".") !== 0) {
    return res.status(400).json({ ok: false, message: "영상 위치가 올바르지 않습니다." });
  }
  const existing = await db.collection("videos").findOne({ lessonId: lessonId });
  await db.collection("videos").updateOne(
    { lessonId: lessonId },
    {
      $set: {
        lessonId: lessonId,
        courseId: courseId,
        fileName: String(body.fileName || "").slice(0, 200),
        contentType: String(body.contentType || "video/mp4").slice(0, 60),
        size: Math.max(0, Number(body.size) || 0),
        seconds: Math.max(0, Math.round(Number(body.seconds) || 0)),
        key: key,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  /* 확장자가 다른 파일로 바꿔 올리면 예전 파일이 저장소에 남으므로 지웁니다. */
  if (existing && existing.key && existing.key !== key && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: existing.key }));
  }
  res.json({ ok: true });
}));

app.get("/api/videos/:lessonId/url", route(async function (req, res) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "로그인이 필요합니다." });
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "영상 저장소가 연결되지 않았습니다." });
  const lessonId = String(req.params.lessonId || "");
  const video = isId(lessonId) ? await db.collection("videos").findOne({ lessonId: lessonId }) : null;
  if (!video) return res.json({ ok: true, url: "" });
  if (user.role !== "admin") {
    const approved = await db.collection("enrollments").findOne({
      userId: user._id,
      courseId: video.courseId
    });
    if (!accessOpen(approved)) return res.status(403).json({ ok: false, message: "수강 기간 안의 승인된 수강생만 영상을 볼 수 있습니다." });
  }
  const url = await getSignedUrl(r2(), new GetObjectCommand({
    Bucket: r2Bucket,
    Key: video.key
  }), { expiresIn: 60 * 60 * 4 });
  res.json({ ok: true, url: url });
}));

app.delete("/api/videos/:lessonId", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 영상을 지울 수 있습니다.")) return;
  const lessonId = String(req.params.lessonId || "");
  if (!isId(lessonId)) return res.status(404).json({ ok: false, message: "회차를 찾을 수 없습니다." });
  await deleteVideo(lessonId);
  res.json({ ok: true });
}));

app.patch("/api/courses/:id", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 강의 소개를 수정할 수 있습니다.")) return;
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const body = req.body || {};
  const title = clipText(body.title, 80);
  const summary = clipText(body.summary, 300);
  const audience = clipText(body.audience, 200);
  const category = clipText(body.category, 20);
  const goals = clipLines(body.goals, 8, 120);
  const thumbLines = clipLines(body.thumbLines, 3, 24);
  if (title.length < 2) return res.status(400).json({ ok: false, message: "강의 제목은 두 글자 이상 입력해 주세요." });
  if (!summary) return res.status(400).json({ ok: false, message: "강의 소개를 입력해 주세요." });
  if (!audience) return res.status(400).json({ ok: false, message: "수강 대상을 입력해 주세요." });
  if (!category) return res.status(400).json({ ok: false, message: "분류를 입력해 주세요." });
  if (!goals.length) return res.status(400).json({ ok: false, message: "학습 목표를 한 줄 이상 입력해 주세요." });
  if (!thumbLines.length) return res.status(400).json({ ok: false, message: "이미지 없을 때 표시할 문구를 입력해 주세요." });
  await db.collection("courses").updateOne(
    { courseId: courseId },
    {
      $set: {
        title: title,
        summary: summary,
        audience: audience,
        category: category,
        goals: goals,
        thumbLines: thumbLines,
        pathLabel: thumbLines[0] || title,
        updatedAt: new Date()
      }
    }
  );
  res.json({ ok: true });
}));

app.post("/api/courses", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 강의를 추가할 수 있습니다.")) return;
  const body = req.body || {};
  const title = clipText(body.title, 80);
  const summary = clipText(body.summary, 300);
  const audience = clipText(body.audience, 200) || "수강 신청 후 볼 수 있는 강의입니다.";
  const category = clipText(body.category, 20) || "강의";
  const goals = clipLines(body.goals, 8, 120);
  const thumbLines = clipLines(body.thumbLines, 3, 24);
  if (title.length < 2) return res.status(400).json({ ok: false, message: "강의 제목은 두 글자 이상 입력해 주세요." });
  if (!summary) return res.status(400).json({ ok: false, message: "강의 소개를 입력해 주세요." });
  const count = await db.collection("courses").countDocuments();
  const courseId = "course-" + randomBytes(4).toString("hex");
  const lines = thumbLines.length ? thumbLines : [title.slice(0, 24)];
  await db.collection("courses").insertOne({
    courseId: courseId,
    category: category,
    tone: COURSE_TONES[count % COURSE_TONES.length],
    featured: true,
    pathLabel: lines[0],
    title: title,
    summary: summary,
    audience: audience,
    goals: goals.length ? goals : [summary],
    thumbLines: lines,
    chapters: [],
    coverKey: "",
    coverType: "",
    coverSize: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  res.json({ ok: true, id: courseId });
}));

app.delete("/api/courses/:id", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 강의를 삭제할 수 있습니다.")) return;
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  await deleteCourseBundle(courseId);
  res.json({ ok: true });
}));

app.post("/api/courses/:id/cover", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: COVER_BYTES }), route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 이미지를 올릴 수 있습니다.")) return;
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "이미지 저장소 연결 정보가 없습니다. .env의 R2 값을 확인해 주세요." });
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const ext = COVER_EXT[contentType];
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!ext) return res.status(400).json({ ok: false, message: "JPG, PNG, WEBP 이미지만 올릴 수 있습니다." });
  if (!body.length || body.length > COVER_BYTES) return res.status(400).json({ ok: false, message: "이미지는 5MB 이하로 올려 주세요." });
  const key = "covers/" + courseId + "." + ext;
  await r2().send(new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  const existing = await db.collection("courses").findOne({ courseId: courseId });
  await db.collection("courses").updateOne(
    { courseId: courseId },
    { $set: { coverKey: key, coverType: contentType, coverSize: body.length, updatedAt: new Date() } }
  );
  if (existing && existing.coverKey && existing.coverKey !== key) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: existing.coverKey }));
  }
  res.json({ ok: true });
}));

app.post("/api/courses/:id/cover/upload", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 이미지를 올릴 수 있습니다.")) return;
  if (!r2Ready()) return res.status(503).json({ ok: false, message: "이미지 저장소 연결 정보가 없습니다. .env의 R2 값을 확인해 주세요." });
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const contentType = String((req.body && req.body.contentType) || "");
  const ext = COVER_EXT[contentType];
  const size = Number(req.body && req.body.size) || 0;
  if (!ext) return res.status(400).json({ ok: false, message: "JPG, PNG, WEBP 이미지만 올릴 수 있습니다." });
  if (size <= 0 || size > COVER_BYTES) return res.status(400).json({ ok: false, message: "이미지는 5MB 이하로 올려 주세요." });
  const key = "covers/" + courseId + "." + ext;
  const uploadUrl = await getSignedUrl(r2(), new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    ContentType: contentType
  }), { expiresIn: 60 * 10 });
  res.json({ ok: true, uploadUrl: uploadUrl, key: key, contentType: contentType });
}));

app.post("/api/courses/:id/cover/complete", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 이미지를 올릴 수 있습니다.")) return;
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const body = req.body || {};
  const contentType = String(body.contentType || "");
  const ext = COVER_EXT[contentType];
  const key = String(body.key || "");
  const size = Number(body.size) || 0;
  if (!ext || key !== "covers/" + courseId + "." + ext) return res.status(400).json({ ok: false, message: "이미지 위치가 올바르지 않습니다." });
  if (size <= 0 || size > COVER_BYTES) return res.status(400).json({ ok: false, message: "이미지는 5MB 이하로 올려 주세요." });
  const existing = await db.collection("courses").findOne({ courseId: courseId });
  await db.collection("courses").updateOne(
    { courseId: courseId },
    { $set: { coverKey: key, coverType: contentType, coverSize: size, updatedAt: new Date() } }
  );
  if (existing && existing.coverKey && existing.coverKey !== key && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: existing.coverKey }));
  }
  res.json({ ok: true });
}));

app.delete("/api/courses/:id/cover", route(async function (req, res) {
  if (!await requireAdminUser(req, res, "관리자만 이미지를 지울 수 있습니다.")) return;
  const courseId = String(req.params.id || "");
  if (!await courseExists(courseId)) return res.status(404).json({ ok: false, message: "강의를 찾을 수 없습니다." });
  const existing = await db.collection("courses").findOne({ courseId: courseId });
  if (existing && existing.coverKey && r2Ready()) {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: existing.coverKey }));
  }
  if (existing) {
    await db.collection("courses").updateOne(
      { courseId: courseId },
      { $unset: { coverKey: "", coverType: "", coverSize: "" }, $set: { updatedAt: new Date() } }
    );
  }
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, "public")));

app.use(function (error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error(error);
  res.status(status).json({
    ok: false,
    message: error && error.type === "entity.too.large"
      ? "이미지는 5MB 이하로 올려 주세요."
      : status === 500 ? "서버에서 요청을 처리하지 못했습니다." : "요청 형식이 올바르지 않습니다."
  });
});

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
