(function () {
  var KEY = "ncodelab-vod-v2";
  var ADMIN_EMAIL = "admin@ncodelab.kr";
  var ADMIN_SALT = "ncodelab-admin-seed";
  var ADMIN_HASH = "707a73d2eb8338bc0354077f740e648c3112c4bf432f382347fbf0898b71609e";
  var baseCourses = null;
  var urlCache = {};
  var mediaDbPromise = null;
  var account = null;
  var enrollmentCache = [];
  var progressCache = {};
  var userCache = [];
  var videoCache = {};

  function empty() {
    return {
      version: 2,
      sessionId: null,
      users: [],
      enrollments: [],
      progress: {},
      videos: {},
      customLessons: []
    };
  }

  function sha256(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = "length";
    var i;
    var j;
    var result = "";
    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k[lengthProperty];
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += "\x80";
    while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00";
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
    words[words[lengthProperty]] = asciiBitLength;
    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];
        var a = hash[0];
        var e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? "0" : "") + b.toString(16);
      }
    }
    return result;
  }

  function utf8(value) {
    var text = String(value);
    if (window.TextEncoder) {
      var bytes = new TextEncoder().encode(text);
      var out = "";
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
    return unescape(encodeURIComponent(text));
  }

  function digest(salt, password) {
    return sha256(utf8(String(salt) + ":" + String(password)));
  }

  function randomSalt() {
    var bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (var n = 0; n < bytes.length; n++) hex += bytes[n].toString(16).padStart(2, "0");
    return hex;
  }

  function makeId(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      var data = JSON.parse(raw);
      return {
        version: 2,
        sessionId: data.sessionId || null,
        users: Array.isArray(data.users) ? data.users : [],
        enrollments: Array.isArray(data.enrollments) ? data.enrollments : [],
        progress: data.progress && typeof data.progress === "object" ? data.progress : {},
        videos: data.videos && typeof data.videos === "object" ? data.videos : {},
        customLessons: Array.isArray(data.customLessons) ? data.customLessons : []
      };
    } catch (error) {
      return empty();
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function findUser(state, id) {
    var found = null;
    state.users.forEach(function (user) {
      if (user.id === id) found = user;
    });
    return found;
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt || 0
    };
  }

  function ensureAdmin() {
    var state = load();
    var exists = state.users.some(function (user) { return user.role === "admin"; });
    if (exists) return;
    state.users.unshift({
      id: "admin",
      name: "관리자",
      email: ADMIN_EMAIL,
      salt: ADMIN_SALT,
      hash: ADMIN_HASH,
      role: "admin",
      createdAt: Date.now()
    });
    save(state);
  }

  function ensureBase() {
    if (baseCourses || !window.VodCatalog) return;
    baseCourses = JSON.parse(JSON.stringify(window.VodCatalog.courses));
  }

  function applyLibrary() {
    ensureBase();
    if (!baseCourses || !window.VodCatalog) return;
    var state = load();
    var courses = JSON.parse(JSON.stringify(baseCourses));
    state.customLessons.forEach(function (item) {
      var course = null;
      courses.forEach(function (entry) {
        if (entry.id === item.courseId) course = entry;
      });
      if (!course) return;
      var chapter = null;
      course.chapters.forEach(function (entry) {
        if (entry.title === item.chapterTitle) chapter = entry;
      });
      if (!chapter) {
        chapter = { title: item.chapterTitle, lessons: [] };
        course.chapters.push(chapter);
      }
      var meta = videoCache[item.id];
      chapter.lessons.push({
        id: item.id,
        title: item.title,
        seconds: meta && meta.seconds ? meta.seconds : item.seconds || 0,
        summary: item.summary,
        custom: true
      });
    });
    courses.forEach(function (course) {
      course.chapters.forEach(function (chapter) {
        chapter.lessons.forEach(function (lesson) {
          var meta = videoCache[lesson.id];
          if (meta && meta.seconds) lesson.seconds = meta.seconds;
          if (meta) lesson.video = "remote:" + lesson.id;
        });
      });
    });
    var live = window.VodCatalog.courses;
    live.splice(0, live.length);
    courses.forEach(function (course) { live.push(course); });
  }

  function api(path, options) {
    var settings = options || {};
    settings.credentials = "same-origin";
    settings.headers = settings.headers || {};
    if (settings.body && typeof settings.body !== "string") {
      settings.headers["Content-Type"] = "application/json";
      settings.body = JSON.stringify(settings.body);
    }
    return fetch(path, settings).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, message: "서버에 연결하지 못했습니다. 서버 주소로 페이지를 열어 주세요." };
      });
    }).catch(function () {
      return { ok: false, message: "서버에 연결하지 못했습니다. 서버 주소로 페이지를 열어 주세요." };
    });
  }

  function applySession(data) {
    account = data && data.user ? data.user : null;
    enrollmentCache = data && data.enrollments ? data.enrollments : [];
    progressCache = {};
    userCache = data && data.users ? data.users : [];
    videoCache = {};
    (data && data.videos ? data.videos : []).forEach(function (row) {
      videoCache[row.lessonId] = row;
    });
    (data && data.progress ? data.progress : []).forEach(function (row) {
      progressCache[row.courseId] = {
        completed: row.completed || [],
        positions: row.positions || {},
        lastLesson: row.lastLesson || "",
        updatedAt: row.updatedAt || 0
      };
    });
  }

  function refresh() {
    return api("/api/session").then(function (data) {
      applySession(data && data.ok ? data : {});
      return data;
    });
  }

  function getStudent() {
    return account;
  }

  function requireAdmin() {
    var user = getStudent();
    return !!(user && user.role === "admin");
  }

  function register(name, email, password) {
    var trimmed = String(name || "").trim().replace(/\s+/g, " ");
    var mail = normalizeEmail(email);
    var pass = String(password || "");
    if (trimmed.length < 2) return Promise.resolve({ ok: false, message: "이름은 두 글자 이상 입력해 주세요." });
    if (trimmed.length > 20) return Promise.resolve({ ok: false, message: "이름은 20자 안으로 입력해 주세요." });
    if (!isEmail(mail)) return Promise.resolve({ ok: false, message: "이메일 형식을 확인해 주세요." });
    if (pass.length < 8) return Promise.resolve({ ok: false, message: "비밀번호는 8자 이상 입력해 주세요." });
    return api("/api/register", { method: "POST", body: { name: trimmed, email: mail, password: pass } }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function login(email, password) {
    var mail = normalizeEmail(email);
    var pass = String(password || "");
    if (!mail || !pass) return Promise.resolve({ ok: false, message: "이메일과 비밀번호를 입력해 주세요." });
    return api("/api/login", { method: "POST", body: { email: mail, password: pass } }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function logout() {
    account = null;
    enrollmentCache = [];
    progressCache = {};
    userCache = [];
    return api("/api/logout", { method: "POST", body: {} });
  }

  function getProgress(courseId) {
    var row = progressCache[courseId];
    if (!row) return { completed: [], positions: {}, lastLesson: "", updatedAt: 0 };
    return {
      completed: row.completed || [],
      positions: row.positions || {},
      lastLesson: row.lastLesson || "",
      updatedAt: row.updatedAt || 0
    };
  }

  function rememberProgress(courseId, row) {
    progressCache[courseId] = row;
    return api("/api/progress/" + encodeURIComponent(courseId), {
      method: "PUT",
      body: {
        completed: row.completed,
        positions: row.positions,
        lastLesson: row.lastLesson
      }
    });
  }

  function courseState(course) {
    var lessons = window.VodCatalog.lessonsOf(course);
    var progress = getProgress(course.id);
    var valid = {};
    lessons.forEach(function (lesson) { valid[lesson.id] = true; });
    var completed = progress.completed.filter(function (id) { return valid[id]; });
    return {
      lessons: lessons,
      completed: completed,
      done: completed.length,
      total: lessons.length,
      percent: lessons.length ? Math.round((completed.length / lessons.length) * 100) : 0,
      lastLesson: valid[progress.lastLesson] ? progress.lastLesson : "",
      updatedAt: progress.updatedAt,
      positions: progress.positions
    };
  }

  function savePosition(courseId, lessonId, seconds) {
    var user = getStudent();
    if (!user || !canWatch(courseId)) return;
    var row = getProgress(courseId);
    row.positions[lessonId] = Math.max(0, Math.floor(seconds || 0));
    row.lastLesson = lessonId;
    row.updatedAt = Date.now();
    rememberProgress(courseId, row);
  }

  function markComplete(courseId, lessonId) {
    var user = getStudent();
    if (!user || !canWatch(courseId)) return;
    var row = getProgress(courseId);
    if (row.completed.indexOf(lessonId) === -1) row.completed.push(lessonId);
    row.lastLesson = lessonId;
    row.updatedAt = Date.now();
    rememberProgress(courseId, row);
  }

  function clearProgress() {
    if (!getStudent()) return Promise.resolve({ ok: false });
    progressCache = {};
    return api("/api/progress", { method: "DELETE" });
  }

  function resumePoint(course) {
    var state = courseState(course);
    var lessons = state.lessons;
    if (!lessons.length) return { lesson: null, label: "강의 보기" };
    var last = null;
    lessons.forEach(function (lesson) {
      if (lesson.id === state.lastLesson) last = lesson;
    });
    if (last && state.completed.indexOf(last.id) === -1) return { lesson: last, label: "이어보기" };
    var nextIncomplete = null;
    lessons.forEach(function (lesson) {
      if (!nextIncomplete && state.completed.indexOf(lesson.id) === -1) nextIncomplete = lesson;
    });
    if (nextIncomplete) return { lesson: nextIncomplete, label: state.done > 0 ? "이어보기" : "첫 회차 보기" };
    return { lesson: lessons[0], label: "처음부터 다시 보기" };
  }

  function resumeCourse() {
    var rows = window.VodCatalog.courses.map(function (course) {
      return { course: course, state: courseState(course) };
    }).filter(function (item) {
      return item.state.lastLesson || item.state.done > 0;
    }).sort(function (a, b) {
      return b.state.updatedAt - a.state.updatedAt;
    });
    if (!rows.length) return null;
    var open = null;
    rows.forEach(function (item) {
      if (!open && item.state.done < item.state.total) open = item;
    });
    var picked = open || rows[0];
    return { course: picked.course, state: picked.state, point: resumePoint(picked.course) };
  }

  function summary() {
    var completedLessons = 0;
    var totalLessons = 0;
    var started = 0;
    var finishedCourses = 0;
    window.VodCatalog.courses.forEach(function (course) {
      var state = courseState(course);
      totalLessons += state.total;
      completedLessons += state.done;
      if (state.total && state.done >= state.total) finishedCourses += 1;
      else if (state.done > 0 || state.lastLesson) started += 1;
    });
    return {
      completedLessons: completedLessons,
      totalLessons: totalLessons,
      started: started,
      finishedCourses: finishedCourses,
      remaining: Math.max(0, totalLessons - completedLessons)
    };
  }

  function enrollmentRow(courseId) {
    var user = getStudent();
    if (!user) return null;
    var found = null;
    enrollmentCache.forEach(function (item) {
      if (item.userId === user.id && item.courseId === courseId) found = item;
    });
    return found;
  }

  function enrollmentStatus(courseId) {
    var row = enrollmentRow(courseId);
    return row ? row.status : "";
  }

  function accessState(courseId) {
    var user = getStudent();
    if (!user) return "guest";
    if (user.role === "admin") return "admin";
    return enrollmentStatus(courseId) || "none";
  }

  function canWatch(courseId) {
    var access = accessState(courseId);
    return access === "admin" || access === "approved";
  }

  function applyCourse(courseId) {
    var user = getStudent();
    if (!user) return Promise.resolve({ ok: false, message: "로그인 후 수강 신청할 수 있습니다." });
    if (user.role === "admin") return Promise.resolve({ ok: false, message: "관리자 계정은 승인 없이 영상을 볼 수 있습니다." });
    if (!window.VodCatalog.byId(courseId)) return Promise.resolve({ ok: false, message: "강의를 찾을 수 없습니다." });
    return api("/api/enrollments", { method: "POST", body: { courseId: courseId } }).then(function (data) {
      return refresh().then(function () { return data; });
    });
  }

  function listEnrollments() {
    if (!requireAdmin()) return [];
    return enrollmentCache.map(function (row) {
      var course = window.VodCatalog.byId(row.courseId);
      return {
        id: row.id,
        userId: row.userId,
        courseId: row.courseId,
        status: row.status,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt || 0,
        name: row.name || "알 수 없음",
        email: row.email || "",
        courseTitle: course ? course.title : "삭제된 강의"
      };
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function setEnrollment(id, status) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 수강 신청을 처리할 수 있습니다." });
    if (status !== "approved" && status !== "rejected") return Promise.resolve({ ok: false, message: "처리할 수 없는 상태입니다." });
    return api("/api/enrollments/" + encodeURIComponent(id), { method: "PATCH", body: { status: status } }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function listUsers() {
    if (!requireAdmin()) return [];
    return userCache;
  }

  function openMedia() {
    if (mediaDbPromise) return mediaDbPromise;
    mediaDbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("indexedDB"));
        return;
      }
      var request = indexedDB.open("ncodelab-vod-media", 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    mediaDbPromise.then(null, function () { mediaDbPromise = null; });
    return mediaDbPromise;
  }

  function withStore(mode, run) {
    return openMedia().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("files", mode);
        var request = run(tx.objectStore("files"));
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function readDuration(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement("video");
      var done = false;
      function finish(seconds) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve(seconds);
      }
      video.preload = "metadata";
      video.onloadedmetadata = function () {
        var seconds = Math.round(video.duration || 0);
        finish(isFinite(seconds) ? seconds : 0);
      };
      video.onerror = function () { finish(0); };
      setTimeout(function () { finish(0); }, 4000);
      video.src = url;
    });
  }

  function videoMeta(lessonId) {
    return videoCache[lessonId] || null;
  }

  function courseIdOfLesson(lessonId) {
    var found = "";
    if (!window.VodCatalog) return found;
    window.VodCatalog.courses.forEach(function (course) {
      window.VodCatalog.lessonsOf(course).forEach(function (lesson) {
        if (lesson.id === lessonId) found = course.id;
      });
    });
    return found;
  }

  function isCustomLesson(lessonId) {
    return load().customLessons.some(function (item) { return item.id === lessonId; });
  }

  function knownLesson(lessonId) {
    var found = false;
    if (!window.VodCatalog) return false;
    window.VodCatalog.courses.forEach(function (course) {
      window.VodCatalog.lessonsOf(course).forEach(function (lesson) {
        if (lesson.id === lessonId) found = true;
      });
    });
    return found;
  }

  function forgetUrl(lessonId) {
    if (!urlCache[lessonId]) return;
    URL.revokeObjectURL(urlCache[lessonId]);
    delete urlCache[lessonId];
  }

  function getVideoUrl(lessonId) {
    if (!videoMeta(lessonId)) return Promise.resolve("");
    return api("/api/videos/" + encodeURIComponent(lessonId) + "/url").then(function (data) {
      return data && data.url ? data.url : "";
    });
  }

  function saveVideo(lessonId, file) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 영상을 올릴 수 있습니다." });
    if (!file) return Promise.resolve({ ok: false, message: "영상 파일을 선택해 주세요." });
    if (!knownLesson(lessonId)) return Promise.resolve({ ok: false, message: "회차를 찾을 수 없습니다." });
    var contentType = file.type && file.type.indexOf("video/") === 0 ? file.type : "video/mp4";
    return readDuration(file).then(function (seconds) {
      return api("/api/videos/" + encodeURIComponent(lessonId) + "/upload", {
        method: "POST",
        body: {
          fileName: file.name,
          contentType: contentType,
          size: file.size || 0,
          seconds: seconds,
          courseId: courseIdOfLesson(lessonId)
        }
      }).then(function (ticket) {
        if (!ticket.ok) return ticket;
        return fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file
        }).then(function (response) {
          if (!response.ok) return { ok: false, message: "영상 저장소에 올리지 못했습니다." };
          return api("/api/videos/" + encodeURIComponent(lessonId) + "/complete", {
            method: "POST",
            body: {
              fileName: file.name,
              contentType: contentType,
              size: file.size || 0,
              seconds: seconds,
              key: ticket.key,
              courseId: courseIdOfLesson(lessonId)
            }
          });
        });
      }).then(function (result) {
        if (!result.ok) return result;
        return refresh().then(function () {
          applyLibrary();
          return { ok: true };
        });
      });
    }).catch(function () {
      return { ok: false, message: "영상을 저장하지 못했습니다." };
    });
  }

  function removeVideo(lessonId) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 영상을 지울 수 있습니다." });
    return api("/api/videos/" + encodeURIComponent(lessonId), { method: "DELETE" }).then(function (result) {
      delete videoCache[lessonId];
      applyLibrary();
      return refresh().then(function () {
        applyLibrary();
        return result.ok ? { ok: true } : result;
      });
    });
  }

  function addLesson(input) {
    if (!requireAdmin()) return { ok: false, message: "관리자만 회차를 추가할 수 있습니다." };
    var courseId = String(input.courseId || "");
    var chapterTitle = String(input.chapterTitle || "").trim();
    var title = String(input.title || "").trim().replace(/\s+/g, " ");
    var summary = String(input.summary || "").trim();
    if (!window.VodCatalog.byId(courseId)) return { ok: false, message: "강의를 선택해 주세요." };
    if (!chapterTitle || chapterTitle.length > 40) return { ok: false, message: "챕터 이름을 40자 안으로 입력해 주세요." };
    if (title.length < 2 || title.length > 60) return { ok: false, message: "회차 제목은 2자에서 60자 사이로 입력해 주세요." };
    if (summary.length > 200) return { ok: false, message: "회차 설명은 200자 안으로 입력해 주세요." };
    var state = load();
    var lesson = {
      id: makeId("lesson"),
      courseId: courseId,
      chapterTitle: chapterTitle,
      title: title,
      summary: summary || "관리자가 추가한 회차입니다.",
      seconds: 0
    };
    state.customLessons.push(lesson);
    save(state);
    applyLibrary();
    return { ok: true, id: lesson.id };
  }

  function removeLesson(lessonId) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 회차를 삭제할 수 있습니다." });
    var state = load();
    var index = -1;
    state.customLessons.forEach(function (item, itemIndex) {
      if (item.id === lessonId) index = itemIndex;
    });
    if (index === -1) return Promise.resolve({ ok: false, message: "기본 회차는 삭제할 수 없습니다. 영상만 지울 수 있습니다." });
    state.customLessons.splice(index, 1);
    save(state);
    var removeRemote = videoCache[lessonId]
      ? api("/api/videos/" + encodeURIComponent(lessonId), { method: "DELETE" })
      : Promise.resolve({ ok: true });
    return removeRemote.then(function () {
      delete videoCache[lessonId];
      return refresh();
    }).then(function () {
      applyLibrary();
      return { ok: true };
    });
  }

  applyLibrary();
  var ready = refresh().then(function (data) {
    applyLibrary();
    return data;
  });

  window.VodStore = {
    ready: ready,
    getStudent: getStudent,
    register: register,
    login: login,
    logout: logout,
    clearProgress: clearProgress,
    getProgress: getProgress,
    courseState: courseState,
    savePosition: savePosition,
    markComplete: markComplete,
    resumePoint: resumePoint,
    resumeCourse: resumeCourse,
    summary: summary,
    enrollmentStatus: enrollmentStatus,
    accessState: accessState,
    canWatch: canWatch,
    applyCourse: applyCourse,
    listEnrollments: listEnrollments,
    setEnrollment: setEnrollment,
    listUsers: listUsers,
    videoMeta: videoMeta,
    isCustomLesson: isCustomLesson,
    getVideoUrl: getVideoUrl,
    saveVideo: saveVideo,
    removeVideo: removeVideo,
    addLesson: addLesson,
    removeLesson: removeLesson
  };
})();
