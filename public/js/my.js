(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var student = window.VodStore.getStudent();
  var stats = window.VodStore.summary();
  var greeting = student ? window.VodUI.esc(student.name) + " 님의 학습" : "내 학습";
  var accountLine = student
    ? '<p class="fine">' + window.VodUI.esc(student.email) + (student.role === "admin" ? " · 관리자" : " · 수강생") + "</p>"
    : "";
  var action = student
    ? (student.role === "admin" ? '<a class="btn primary" href="admin.html">관리자 대시보드</a>' : "") +
      '<button type="button" class="btn" data-logout>로그아웃</button>'
    : '<button type="button" class="btn" data-open-signup>회원가입</button><button type="button" class="btn primary" data-open-gate>로그인</button>';

  function statusText(course) {
    var access = window.VodStore.accessState(course.id);
    if (access === "admin") return "관리자 시청";
    if (access === "approved") return "수강 가능";
    if (access === "pending") return "승인 대기";
    if (access === "rejected") return "승인 거절";
    if (access === "scheduled") return "수강 시작 전";
    if (access === "expired") return "수강 기간 종료";
    if (access === "none") return "수강 신청 전";
    return "로그인 필요";
  }

  function rowHref(course, point) {
    if (window.VodStore.canWatch(course.id) && point.lesson) return window.VodUI.watchHref(course.id, point.lesson.id);
    return "course.html?id=" + encodeURIComponent(course.id);
  }

  function rowLabel(course, point) {
    var access = window.VodStore.accessState(course.id);
    if (access === "approved" || access === "admin") return point.label;
    if (access === "pending") return "승인 대기";
    if (access === "rejected") return "다시 신청";
    if (access === "scheduled") return "시작 전";
    if (access === "expired") return "기간 종료";
    if (access === "none") return "수강 신청";
    return "강의 보기";
  }

  var recent = window.VodCatalog.courses.map(function (course) {
    return { course: course, state: window.VodStore.courseState(course) };
  }).filter(function (item) {
    return item.state.lastLesson;
  }).sort(function (a, b) {
    return b.state.updatedAt - a.state.updatedAt;
  });

  var recentHTML = recent.length
    ? '<div class="recent-list">' + recent.map(function (item) {
        var lesson = null;
        item.state.lessons.forEach(function (entry) {
          if (entry.id === item.state.lastLesson) lesson = entry;
        });
        if (!lesson) return "";
        var href = window.VodStore.canWatch(item.course.id)
          ? window.VodUI.watchHref(item.course.id, lesson.id)
          : "course.html?id=" + encodeURIComponent(item.course.id);
        return '<a href="' + href + '"><span><strong>' + window.VodUI.esc(lesson.title) + "</strong><br />" + window.VodUI.esc(item.course.title) + "</span><small>" + window.VodUI.formatWhen(item.state.updatedAt) + "</small></a>";
      }).join("") + "</div>"
    : '<div class="empty"><strong>아직 재생한 회차가 없습니다</strong><p>승인된 강의의 첫 회차를 보면 이곳에 남습니다.</p></div>';

  var rows = window.VodCatalog.courses.map(function (course) {
    var state = window.VodStore.courseState(course);
    var point = window.VodStore.resumePoint(course);
    return { course: course, state: state, point: point };
  }).sort(function (a, b) {
    return b.state.updatedAt - a.state.updatedAt;
  }).map(function (item) {
    var href = rowHref(item.course, item.point);
    var watchable = window.VodStore.canWatch(item.course.id);
    return '<article class="progress-row">' +
      '<a class="mini-thumb tone-' + window.VodUI.esc(item.course.tone) + '" href="course.html?id=' + encodeURIComponent(item.course.id) + '" aria-label="' + window.VodUI.esc(item.course.title) + '"></a>' +
      '<a class="progress-copy" href="course.html?id=' + encodeURIComponent(item.course.id) + '">' +
        "<strong>" + window.VodUI.esc(item.course.title) + "</strong>" +
        "<p>" + item.state.done + " / " + item.state.total + "강 완료 · " + statusText(item.course) + "</p>" +
        '<div class="bar" aria-hidden="true"><span style="width:' + item.state.percent + '%"></span></div>' +
      "</a>" +
      '<a class="btn' + (watchable && item.state.updatedAt ? " primary" : "") + '" href="' + href + '">' + window.VodUI.esc(rowLabel(item.course, item.point)) + "</a>" +
    "</article>";
  }).join("");

  root.innerHTML =
    '<section class="profile">' +
      "<div>" +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>MY LEARNING</p>' +
        "<h1>" + greeting + "</h1>" +
        accountLine +
        '<p class="lede">회원가입 후 강의마다 수강 신청을 합니다. 승인된 강의만 재생되고, 진도는 계정에 저장됩니다.</p>' +
        '<div class="hero-actions">' + action + "</div>" +
      "</div>" +
      '<div class="stat-row">' +
        "<article><strong>" + stats.started + "</strong><span>수강 중</span></article>" +
        "<article><strong>" + stats.completedLessons + "</strong><span>완료한 회차</span></article>" +
        "<article><strong>" + stats.finishedCourses + "</strong><span>완료한 강의</span></article>" +
      "</div>" +
    "</section>" +
    '<section class="section"><div class="section-head"><div><p class="eyebrow"><span class="dot" aria-hidden="true"></span>RECENT</p><h2>최근 본 회차</h2></div></div>' + recentHTML + "</section>" +
    '<section class="section"><div class="section-head"><div><p class="eyebrow"><span class="dot" aria-hidden="true"></span>PROGRESS</p><h2>강의별 진도</h2></div></div><div class="progress-list">' + rows + "</div>" +
      '<button type="button" class="text-btn" data-reset-progress>이 계정의 학습 기록 지우기</button>' +
    "</section>";

  window.onVodLogin = function () { location.reload(); };
  });
})();
