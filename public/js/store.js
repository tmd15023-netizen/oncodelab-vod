(function () {
  /* 예전 버전이 관리자 브라우저에 회차를 저장하던 자리입니다. 서버로 옮긴 뒤 지웁니다. */
  var LEGACY_KEY = "ncodelab-vod-v2";
  var baseCourses = null;
  var account = null;
  var enrollmentCache = [];
  var progressCache = {};
  var userCache = [];
  var videoCache = {};
  var lessonCache = [];

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function legacyLessons() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      var data = raw ? JSON.parse(raw) : null;
      return data && Array.isArray(data.customLessons) ? data.customLessons : [];
    } catch (error) {
      return [];
    }
  }

  function forgetLegacy() {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (error) {
      return;
    }
  }

  function ensureBase() {
    if (baseCourses || !window.VodCatalog) return;
    baseCourses = JSON.parse(JSON.stringify(window.VodCatalog.courses));
  }

  function applyLibrary() {
    ensureBase();
    if (!baseCourses || !window.VodCatalog) return;
    var courses = JSON.parse(JSON.stringify(baseCourses));
    lessonCache.forEach(function (item) {
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
        seconds: meta && meta.seconds ? meta.seconds : 0,
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
    lessonCache = data && data.lessons ? data.lessons : [];
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
      var legacy = requireAdmin() ? legacyLessons() : [];
      if (!legacy.length) return data;
      return api("/api/lessons/import", { method: "POST", body: { lessons: legacy } }).then(function (result) {
        if (!result.ok) return data;
        forgetLegacy();
        return refresh();
      });
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

  function rememberProgress(courseId, row, keepalive) {
    progressCache[courseId] = row;
    return api("/api/progress/" + encodeURIComponent(courseId), {
      method: "PUT",
      keepalive: !!keepalive,
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

  /* keepalive는 페이지를 떠날 때도 요청이 끝까지 가도록 합니다. */
  function savePosition(courseId, lessonId, seconds, keepalive) {
    var user = getStudent();
    if (!user || !canWatch(courseId)) return;
    var row = getProgress(courseId);
    row.positions[lessonId] = Math.max(0, Math.floor(seconds || 0));
    row.lastLesson = lessonId;
    row.updatedAt = Date.now();
    rememberProgress(courseId, row, keepalive);
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
    var row = enrollmentRow(courseId);
    if (!row) return "none";
    if (row.status !== "approved") return row.status;
    var now = Date.now();
    if (row.accessStart && now < row.accessStart) return "scheduled";
    if (row.accessEnd && now > row.accessEnd) return "expired";
    return "approved";
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
        accessStart: row.accessStart || 0,
        accessEnd: row.accessEnd || 0,
        name: row.name || "알 수 없음",
        email: row.email || "",
        courseTitle: course ? course.title : "삭제된 강의"
      };
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function setEnrollment(id, status, period) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 수강 신청을 처리할 수 있습니다." });
    if (status !== "approved" && status !== "rejected") return Promise.resolve({ ok: false, message: "처리할 수 없는 상태입니다." });
    var body = { status: status };
    if (period) {
      body.accessStart = period.accessStart || "";
      body.accessEnd = period.accessEnd || "";
    }
    return api("/api/enrollments/" + encodeURIComponent(id), { method: "PATCH", body: body }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function grantEnrollment(userId, courseId, period) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 수강을 승인할 수 있습니다." });
    return api("/api/admin/enrollments", {
      method: "POST",
      body: {
        userId: userId,
        courseId: courseId,
        accessStart: period && period.accessStart ? period.accessStart : "",
        accessEnd: period && period.accessEnd ? period.accessEnd : ""
      }
    }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function deleteUser(userId) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 회원을 삭제할 수 있습니다." });
    return api("/api/users/" + encodeURIComponent(userId), { method: "DELETE" }).then(function (data) {
      if (!data.ok) return data;
      return refresh().then(function () { return { ok: true }; });
    });
  }

  function listUsers() {
    if (!requireAdmin()) return [];
    return userCache;
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

  function isCustomLesson(lessonId) {
    return lessonCache.some(function (item) { return item.id === lessonId; });
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
          seconds: seconds
        }
      }).then(function (ticket) {
        if (!ticket.ok) return ticket;
        contentType = ticket.contentType || contentType;
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
              key: ticket.key
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
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 회차를 추가할 수 있습니다." });
    return api("/api/lessons", {
      method: "POST",
      body: {
        courseId: input.courseId,
        chapterTitle: input.chapterTitle,
        title: input.title,
        summary: input.summary
      }
    }).then(function (created) {
      if (!created.ok) return created;
      return refresh().then(function () {
        applyLibrary();
        return { ok: true, id: created.id };
      });
    });
  }

  function removeLesson(lessonId) {
    if (!requireAdmin()) return Promise.resolve({ ok: false, message: "관리자만 회차를 삭제할 수 있습니다." });
    return api("/api/lessons/" + encodeURIComponent(lessonId), { method: "DELETE" }).then(function (result) {
      if (!result.ok) return result;
      delete videoCache[lessonId];
      return refresh().then(function () {
        applyLibrary();
        return { ok: true };
      });
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
    grantEnrollment: grantEnrollment,
    deleteUser: deleteUser,
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
