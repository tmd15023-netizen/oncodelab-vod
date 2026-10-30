(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var params = new URLSearchParams(location.search);
  var course = window.VodCatalog.byId(params.get("course"));
  var lessonId = params.get("lesson");
  var flash = "";
  var keysBound = false;

  if (!course) {
    root.innerHTML = '<div class="empty"><strong>강의를 찾을 수 없습니다</strong><p><a class="link-more" href="courses.html">전체 강의로 돌아가기</a></p></div>';
    return;
  }

  var lessons = window.VodCatalog.lessonsOf(course);
  var lesson = null;
  lessons.forEach(function (item) {
    if (item.id === lessonId) lesson = item;
  });
  if (!lesson) {
    location.replace(window.VodUI.watchHref(course.id, lessons[0].id));
    return;
  }

  document.title = lesson.title + " · 온코드랩 VOD";

  function uploaded(item) {
    return !!(item.video && (item.video.indexOf("remote:") === 0 || item.video.indexOf("idb:") === 0));
  }

  function external(item) {
    return !!(item.video && item.video.indexOf("remote:") !== 0 && item.video.indexOf("idb:") !== 0);
  }

  function lockHTML(access) {
    if (access === "guest") {
      return '<div class="lock"><div><h2>로그인 후 수강할 수 있습니다</h2><p>회원가입한 뒤 수강 신청을 하고, 관리자 승인을 받으면 이 회차가 재생됩니다.</p>' +
        (flash ? "<p>" + window.VodUI.esc(flash) + "</p>" : "") +
        '<button type="button" class="btn primary" data-open-gate>로그인</button></div></div>';
    }
    if (access === "pending") {
      return '<div class="lock"><div><h2>승인 대기 중</h2><p>수강 신청이 접수되었습니다. 관리자가 승인하면 영상을 볼 수 있습니다.</p></div></div>';
    }
    if (access === "rejected") {
      return '<div class="lock"><div><h2>수강 승인이 되지 않았습니다</h2><p>다시 신청하면 관리자가 검토합니다.</p>' +
        '<button type="button" class="btn primary" data-apply>다시 수강 신청</button></div></div>';
    }
    return '<div class="lock"><div><h2>수강 신청 후 볼 수 있습니다</h2><p>이 강의는 승인된 수강생만 재생할 수 있습니다.</p>' +
      '<button type="button" class="btn primary" data-apply>수강 신청</button></div></div>';
  }

  function render() {
    lessons = window.VodCatalog.lessonsOf(course);
    lessons.forEach(function (item) {
      if (item.id === lesson.id) lesson = item;
    });
    var access = window.VodStore.accessState(course.id);
    var allowed = access === "admin" || access === "approved";
    var state = window.VodStore.courseState(course);
    var index = lessons.findIndex(function (item) { return item.id === lesson.id; });
    var prev = lessons[index - 1];
    var next = lessons[index + 1];
    var usingSample = !uploaded(lesson) && !external(lesson);
    var stage = allowed
      ? '<video id="lecture" controls playsinline controlslist="nodownload" preload="metadata" aria-label="' + window.VodUI.esc(lesson.title) + '"></video>'
      : lockHTML(access);
    var extra = allowed
      ? '<span class="spacer"></span><label class="rate-label">속도<select id="rate"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" class="btn" id="complete-btn">이 회차 완료</button>'
      : "";
    var sampleNote = allowed && usingSample
      ? '<p class="fine key-hint">아직 등록된 강의 영상이 없어 샘플이 재생됩니다. 관리자가 영상을 올리면 이 회차가 강의 영상으로 바뀝니다.</p>'
      : "";
    var keys = allowed
      ? '<p class="fine key-hint">방향키로 5초씩 이동하고, 스페이스 바로 재생하거나 멈춥니다.</p>'
      : "";

    root.innerHTML =
      '<div class="player-layout"><section>' +
        '<p class="crumb"><a href="course.html?id=' + encodeURIComponent(course.id) + '">' + window.VodUI.esc(course.title) + "</a> · " + window.VodUI.esc(lesson.chapterTitle) + "</p>" +
        "<h1>" + window.VodUI.esc(lesson.title) + "</h1>" +
        '<p class="fine" id="done-count">' + state.done + " / " + state.total + "강 완료</p>" +
        '<div class="stage">' + stage + "</div>" +
        '<div class="player-toolbar">' + navButton(prev, "이전 회차", false) + navButton(next, "다음 회차", true) + extra + "</div>" +
        '<p class="player-status" id="player-status" role="status"></p>' +
        '<p class="lesson-summary">' + window.VodUI.esc(lesson.summary) + "</p>" +
        sampleNote + keys +
      "</section>" +
      '<aside class="curriculum" aria-label="강의 목차">' + curriculumHTML() + "</aside></div>";

    if (allowed) bindPlayer(usingSample);
    var current = document.querySelector(".side-lesson.is-current");
    if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
  }

  function navButton(target, label, primary) {
    if (!target) return '<span class="btn is-disabled">' + label + "</span>";
    return '<a class="btn' + (primary ? " primary" : "") + '" href="' + window.VodUI.watchHref(course.id, target.id) + '">' + label + "</a>";
  }

  function curriculumHTML() {
    var state = window.VodStore.courseState(course);
    var body = course.chapters.map(function (chapter) {
      var rows = chapter.lessons.map(function (item) {
        var meta = null;
        state.lessons.forEach(function (lessonItem) {
          if (lessonItem.id === item.id) meta = lessonItem;
        });
        var done = state.completed.indexOf(item.id) !== -1;
        var current = item.id === lesson.id;
        var time = window.VodUI.clock(item.seconds);
        var label = done ? time + " · 학습 완료" : current ? time + " · 재생 중" : time;
        return '<a class="side-lesson' + (current ? " is-current" : "") + (done ? " is-done" : "") + '" data-lesson-id="' + window.VodUI.esc(item.id) + '" href="' + window.VodUI.watchHref(course.id, item.id) + '"' + (current ? ' aria-current="true"' : "") + ">" +
          '<span class="num">' + String(meta.number).padStart(2, "0") + "</span>" +
          '<span class="side-copy"><strong>' + window.VodUI.esc(item.title) + "</strong><em>" + label + "</em></span></a>";
      }).join("");
      return '<p class="chapter-label">' + window.VodUI.esc(chapter.title) + "</p>" + rows;
    }).join("");
    return '<div class="side-head"><strong>강의 목차</strong><span id="side-pct">' + state.percent + "%</span></div>" +
      '<div class="bar"><span id="side-bar" style="width:' + state.percent + '%"></span></div>' + body;
  }

  function paintLessonState() {
    var state = window.VodStore.courseState(course);
    var pct = document.getElementById("side-pct");
    var bar = document.getElementById("side-bar");
    var count = document.getElementById("done-count");
    if (pct) pct.textContent = state.percent + "%";
    if (bar) bar.style.width = state.percent + "%";
    if (count) count.textContent = state.done + " / " + state.total + "강 완료";
    document.querySelectorAll("[data-lesson-id]").forEach(function (el) {
      var id = el.getAttribute("data-lesson-id");
      var item = null;
      state.lessons.forEach(function (lessonItem) {
        if (lessonItem.id === id) item = lessonItem;
      });
      var done = state.completed.indexOf(id) !== -1;
      el.classList.toggle("is-done", done);
      var em = el.querySelector("em");
      if (em && item) {
        var time = window.VodUI.clock(item.seconds);
        em.textContent = done ? time + " · 학습 완료" : id === lesson.id ? time + " · 재생 중" : time;
      }
    });
    var button = document.getElementById("complete-btn");
    if (button && state.completed.indexOf(lesson.id) !== -1) button.textContent = "완료됨";
  }

  function bindPlayer(usingSample) {
    var video = document.getElementById("lecture");
    var saved = window.VodStore.getProgress(course.id).positions[lesson.id] || 0;
    var triedRemote = false;
    var samplePlayback = usingSample;
    window.VodStore.savePosition(course.id, lesson.id, saved);

    video.addEventListener("loadedmetadata", function () {
      if (saved > 1 && saved < (video.duration || 0) - 1) video.currentTime = saved;
    });

    var last = 0;
    function persist() {
      if (!video.duration && video.currentTime <= 0) return;
      window.VodStore.savePosition(course.id, lesson.id, video.currentTime || 0);
    }
    video.addEventListener("timeupdate", function () {
      var now = Date.now();
      if (now - last < 2000) return;
      last = now;
      persist();
    });
    video.addEventListener("pause", persist);

    video.addEventListener("error", function () {
      if (samplePlayback && !triedRemote) {
        triedRemote = true;
        video.src = window.VodCatalog.sampleRemote;
        return;
      }
      var status = document.getElementById("player-status");
      if (status) status.textContent = "영상을 불러오지 못했습니다. 관리 화면에서 파일을 다시 올려 주세요.";
    });

    video.addEventListener("ended", function () {
      var status = document.getElementById("player-status");
      if (!samplePlayback) {
        window.VodStore.markComplete(course.id, lesson.id);
        if (status) status.textContent = "이 회차를 모두 시청했습니다.";
        paintLessonState();
      } else if (status) {
        status.textContent = "샘플 영상이 끝났습니다. 관리자가 강의를 올리면 끝까지 본 회차가 완료로 남습니다.";
      }
    });

    document.getElementById("rate").addEventListener("change", function (event) {
      video.playbackRate = Number(event.target.value);
    });
    document.getElementById("complete-btn").addEventListener("click", function () {
      window.VodStore.markComplete(course.id, lesson.id);
      var status = document.getElementById("player-status");
      if (status) status.textContent = "학습 완료로 표시했습니다.";
      paintLessonState();
    });

    if (!keysBound) {
      keysBound = true;
      document.addEventListener("keydown", function (event) {
        var current = document.getElementById("lecture");
        if (!current) return;
        var tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A" || tag === "VIDEO") return;
        if (document.querySelector(".modal.is-open")) return;
        if (event.key === "ArrowRight") current.currentTime = Math.min(current.duration || 0, current.currentTime + 5);
        else if (event.key === "ArrowLeft") current.currentTime = Math.max(0, current.currentTime - 5);
        else if (event.key === " " || event.code === "Space") {
          event.preventDefault();
          if (current.paused) current.play().catch(function () {});
          else current.pause();
        }
      });
      window.addEventListener("pagehide", function () {
        var current = document.getElementById("lecture");
        if (!current) return;
        window.VodStore.savePosition(course.id, lesson.id, current.currentTime || 0);
      });
    }

    window.VodStore.getVideoUrl(lesson.id).then(function (url) {
      if (!document.body.contains(video)) return;
      if (url) {
        samplePlayback = false;
        video.src = url;
        return;
      }
      if (external(lesson)) {
        samplePlayback = false;
        video.src = lesson.video;
        return;
      }
      samplePlayback = true;
      video.src = window.VodCatalog.sampleVideo;
    });

    paintLessonState();
  }

  root.addEventListener("click", function (event) {
    if (!event.target.closest("[data-apply]")) return;
    window.VodStore.applyCourse(course.id).then(function (result) {
      flash = result.message || "";
      render();
    });
  });

  window.onVodLogin = function () {
    flash = "";
    render();
  };
  render();
  });
})();
