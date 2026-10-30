(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var course = window.VodCatalog.byId(new URLSearchParams(location.search).get("id"));
  var notice = "";

  if (!course) {
    root.innerHTML = '<div class="empty"><strong>강의를 찾을 수 없습니다</strong><p><a class="link-more" href="courses.html">전체 강의로 돌아가기</a></p></div>';
    return;
  }

  document.title = course.title + " · 온코드랩 VOD";

  function statusCopy(access) {
    if (access === "guest") return "로그인하고 수강 신청을 하면, 승인 후 영상을 볼 수 있습니다.";
    if (access === "none") return "수강 신청 후 관리자가 승인하면 영상을 볼 수 있습니다.";
    if (access === "pending") return "수강 신청이 접수되었습니다. 승인되면 회차를 재생할 수 있습니다.";
    if (access === "rejected") return "이전 신청은 승인되지 않았습니다. 다시 신청할 수 있습니다.";
    if (access === "scheduled") return "수강이 승인되었습니다. 시작일이 되면 영상을 볼 수 있습니다.";
    if (access === "expired") return "수강 가능 기간이 끝났습니다. 연장은 관리자에게 요청해 주세요.";
    if (access === "admin") return "관리자 계정은 승인 없이 영상을 볼 수 있습니다.";
    return "";
  }

  function render() {
    course = window.VodCatalog.byId(course.id) || course;
    var state = window.VodStore.courseState(course);
    var point = window.VodStore.resumePoint(course);
    var access = window.VodStore.accessState(course.id);
    var goals = course.goals.map(function (goal) {
      return "<li>" + window.VodUI.esc(goal) + "</li>";
    }).join("");
    var chapters = course.chapters.map(function (chapter) {
      var rows = chapter.lessons.map(function (lesson) {
        var meta = null;
        state.lessons.forEach(function (item) {
          if (item.id === lesson.id) meta = item;
        });
        var done = state.completed.indexOf(lesson.id) !== -1;
        var current = point.lesson && point.lesson.id === lesson.id && !done && state.done > 0;
        var status = done ? "학습 완료" : access === "approved" || access === "admin" ? "재생" : "잠금";
        return '<a class="lesson-row' + (done ? " is-done" : "") + (current ? " is-current" : "") + '" href="' + window.VodUI.watchHref(course.id, lesson.id) + '">' +
          '<span class="num">' + String(meta.number).padStart(2, "0") + "</span>" +
          "<span><strong>" + window.VodUI.esc(lesson.title) + "</strong><small>" + window.VodUI.esc(lesson.summary) + "</small></span>" +
          '<span class="time">' + window.VodUI.clock(lesson.seconds) + "</span>" +
          '<span class="play-pill">' + status + "</span></a>";
      }).join("");
      return '<h3 class="chapter-label">' + window.VodUI.esc(chapter.title) + "</h3>" + rows;
    }).join("");
    var play = point.lesson
      ? '<a class="btn primary" href="' + window.VodUI.watchHref(course.id, point.lesson.id) + '">' + window.VodUI.esc(point.label) + "</a>"
      : "";
    var action = play;
    if (access === "guest") action = '<button type="button" class="btn primary" data-open-gate>로그인 후 수강 신청</button>';
    else if (access === "none") action = '<button type="button" class="btn primary" data-apply>수강 신청</button>';
    else if (access === "pending") action = '<button type="button" class="btn is-disabled" disabled>승인 대기 중</button>';
    else if (access === "rejected") action = '<button type="button" class="btn primary" data-apply>다시 수강 신청</button>';
    else if (access === "scheduled") action = '<button type="button" class="btn is-disabled" disabled>수강 시작 전</button>';
    else if (access === "expired") action = '<button type="button" class="btn is-disabled" disabled>수강 기간 종료</button>';
    var note = notice || statusCopy(access);

    root.innerHTML =
      '<p class="crumb"><a href="courses.html">전체 강의</a> · ' + window.VodUI.esc(course.category) + "</p>" +
      '<section class="detail-hero">' +
        window.VodUI.thumbBlock(course, "VOD") +
        '<div class="detail-copy">' +
          '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>' + window.VodUI.esc(course.category) + "</p>" +
          "<h1>" + window.VodUI.esc(course.title) + "</h1>" +
          '<p class="lede">' + window.VodUI.esc(course.summary) + "</p>" +
          '<p class="meta-line" style="margin-top:10px">녹화 강의 · ' + state.total + "강 · " + window.VodUI.koTime(window.VodCatalog.durationOf(course)) + " · 승인 후 수강</p>" +
          '<p class="audience"><span>수강 대상</span>' + window.VodUI.esc(course.audience) + "</p>" +
          '<h2 class="subhead">학습 목표</h2><ul class="goal-list">' + goals + "</ul>" +
          '<div class="bar detail-bar" aria-hidden="true"><span style="width:' + state.percent + '%"></span></div>' +
          '<p class="fine">진도 ' + state.percent + "% · " + state.done + " / " + state.total + "강 완료</p>" +
          (note ? '<p class="note">' + window.VodUI.esc(note) + "</p>" : "") +
          '<div class="hero-actions">' + action + "</div>" +
        "</div>" +
      "</section>" +
      '<section class="section">' +
        '<div class="section-head"><div><p class="eyebrow"><span class="dot" aria-hidden="true"></span>CURRICULUM</p><h2>커리큘럼</h2></div></div>' +
        '<div class="curriculum-block">' + chapters + "</div>" +
      "</section>";
  }

  root.addEventListener("click", function (event) {
    if (!event.target.closest("[data-apply]")) return;
    window.VodStore.applyCourse(course.id).then(function (result) {
      notice = result.message || "";
      render();
    });
  });

  window.onVodLogin = function () {
    notice = "";
    render();
  };
  render();
  });
})();
