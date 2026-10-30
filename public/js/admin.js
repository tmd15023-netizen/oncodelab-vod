(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var tab = "videos";
  var filter = "pending";
  var status = { text: "", error: false };
  var busy = false;

  document.title = "관리 · 온코드랩 VOD";

  function bytes(size) {
    var value = Number(size) || 0;
    if (value < 1024) return value + "B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + "KB";
    return (value / (1024 * 1024)).toFixed(1) + "MB";
  }

  function isVideo(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf("video/") === 0) return true;
    return /\.(mp4|webm|mov|m4v|ogg|ogv|mkv)$/i.test(file.name);
  }

  function setStatus(text, error) {
    status = { text: text || "", error: !!error };
  }

  function render() {
    var user = window.VodStore.getStudent();
    if (!user) {
      root.innerHTML =
        '<div class="empty"><strong>관리자 로그인이 필요합니다</strong>' +
        "<p>이메일과 비밀번호로 관리자 계정에 입장한 뒤 영상과 수강 신청을 관리합니다.</p>" +
        '<p><button type="button" class="btn primary" data-open-gate>로그인</button></p></div>';
      return;
    }
    if (user.role !== "admin") {
      root.innerHTML =
        '<div class="empty"><strong>관리자만 들어올 수 있습니다</strong>' +
        "<p>영상 업로드와 수강 승인은 관리자 계정으로 로그인한 뒤에 할 수 있습니다.</p>" +
        '<p><button type="button" class="btn" data-logout>로그아웃</button></p></div>';
      return;
    }

    var pending = window.VodStore.listEnrollments().filter(function (item) { return item.status === "pending"; }).length;
    root.innerHTML =
      '<header class="page-intro">' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>ADMIN</p>' +
        "<h1>영상·수강 관리</h1>" +
        '<p class="lede">' + window.VodUI.esc(user.name) + " 님, 회차 영상을 올리고 수강 신청을 승인합니다. 회원, 수강 정보, 영상 파일 정보는 서버에 저장됩니다.</p>" +
        '<p class="admin-status' + (status.error ? " is-error" : "") + '" role="status">' + window.VodUI.esc(status.text) + "</p>" +
        '<div class="hero-actions"><button type="button" class="btn" data-logout>로그아웃</button></div>' +
      "</header>" +
      '<div class="admin-tabs" role="tablist">' +
        '<button type="button" class="chip" data-tab="videos" aria-pressed="' + (tab === "videos" ? "true" : "false") + '">영상 관리</button>' +
        '<button type="button" class="chip" data-tab="enroll" aria-pressed="' + (tab === "enroll" ? "true" : "false") + '">수강 승인' + (pending ? " " + pending : "") + "</button>" +
      "</div>" +
      (tab === "enroll" ? enrollPanel() : videoPanel());
  }

  function enrollPanel() {
    var rows = window.VodStore.listEnrollments().filter(function (item) {
      return filter === "all" || item.status === filter;
    });
    var filters = [
      ["pending", "대기"],
      ["approved", "승인"],
      ["rejected", "거절"],
      ["all", "전체"]
    ].map(function (item) {
      return '<button type="button" class="chip" data-filter="' + item[0] + '" aria-pressed="' + (filter === item[0] ? "true" : "false") + '">' + item[1] + "</button>";
    }).join("");
    var body = rows.length
      ? rows.map(function (item) {
          var label = item.status === "approved" ? "승인" : item.status === "rejected" ? "거절" : "대기";
          return '<article class="enroll-row">' +
            "<div><strong>" + window.VodUI.esc(item.name) + "</strong>" +
            "<p>" + window.VodUI.esc(item.email) + " · " + window.VodUI.esc(item.courseTitle) + " · " + window.VodUI.esc(window.VodUI.formatWhen(item.createdAt)) + "</p></div>" +
            '<div class="enroll-actions"><span class="pill ' + window.VodUI.esc(item.status) + '">' + label + "</span>" +
            '<button type="button" class="btn small primary" data-approve="' + window.VodUI.esc(item.id) + '"' + (item.status === "approved" ? " disabled" : "") + ">승인</button>" +
            '<button type="button" class="btn small" data-reject="' + window.VodUI.esc(item.id) + '"' + (item.status === "rejected" ? " disabled" : "") + ">거절</button></div></article>";
        }).join("")
      : '<div class="empty"><strong>표시할 신청이 없습니다</strong><p>수강생이 강의에서 수강 신청을 하면 이곳에 나타납니다.</p></div>';
    var users = window.VodStore.listUsers().map(function (item) {
      return "<li><strong>" + window.VodUI.esc(item.name) + "</strong> · " + window.VodUI.esc(item.email) + (item.role === "admin" ? " · 관리자" : "") + "</li>";
    }).join("");
    return '<section class="section"><div class="chips">' + filters + '</div><div class="stack">' + body + "</div></section>" +
      '<section class="section"><div class="section-head"><div><h2>가입 계정</h2></div></div><ul class="user-list">' + users + "</ul></section>";
  }

  function videoPanel() {
    return window.VodCatalog.courses.map(function (course) {
      var chapters = course.chapters.map(function (chapter) {
        var rows = chapter.lessons.map(function (lesson, index) {
          var meta = window.VodStore.videoMeta(lesson.id);
          var info = meta
            ? window.VodUI.esc(meta.name) + " · " + bytes(meta.size) + (meta.seconds ? " · " + window.VodUI.clock(meta.seconds) : "")
            : "등록된 영상이 없습니다. 승인된 수강생에게는 샘플 영상이 재생됩니다.";
          var removeVideo = meta ? '<button type="button" class="btn small" data-remove-video="' + window.VodUI.esc(lesson.id) + '">영상 삭제</button>' : "";
          var removeLesson = window.VodStore.isCustomLesson(lesson.id)
            ? '<button type="button" class="btn small danger" data-remove-lesson="' + window.VodUI.esc(lesson.id) + '">회차 삭제</button>'
            : "";
          return '<div class="lesson-admin"><div><strong>' + String(index + 1).padStart(2, "0") + ". " + window.VodUI.esc(lesson.title) + "</strong><p>" + info + "</p></div>" +
            '<div class="file-line"><input type="file" data-file-for="' + window.VodUI.esc(lesson.id) + '" accept="video/*" />' +
            '<button type="button" class="btn small primary" data-upload="' + window.VodUI.esc(lesson.id) + '"' + (busy ? " disabled" : "") + ">업로드</button>" +
            removeVideo + removeLesson + "</div></div>";
        }).join("");
        return '<h3 class="chapter-label">' + window.VodUI.esc(chapter.title) + "</h3>" + rows;
      }).join("");
      var options = course.chapters.map(function (chapter) {
        return '<option value="' + window.VodUI.esc(chapter.title) + '"></option>';
      }).join("");
      return '<section class="admin-course"><h2>' + window.VodUI.esc(course.title) + "</h2>" + chapters +
        '<form class="manage-form" data-add-lesson="' + window.VodUI.esc(course.id) + '">' +
          "<h3>회차 추가</h3>" +
          '<label class="field">챕터<input name="chapter" list="chapters-' + window.VodUI.esc(course.id) + '" required maxlength="40" placeholder="기존 챕터 또는 새 챕터 이름" /></label>' +
          '<datalist id="chapters-' + window.VodUI.esc(course.id) + '">' + options + "</datalist>" +
          '<label class="field">회차 제목<input name="title" required maxlength="60" placeholder="회차 제목" /></label>' +
          '<label class="field">설명<input name="summary" maxlength="200" placeholder="이 회차에서 다루는 내용" /></label>' +
          '<label class="field">영상 파일<input name="video" type="file" accept="video/*" /></label>' +
          '<button class="btn primary" type="submit"' + (busy ? " disabled" : "") + ">회차 추가</button>" +
        "</form></section>";
    }).join("");
  }

  root.addEventListener("click", function (event) {
    var tabButton = event.target.closest("[data-tab]");
    if (tabButton) {
      tab = tabButton.getAttribute("data-tab");
      render();
      return;
    }
    var filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      filter = filterButton.getAttribute("data-filter");
      render();
      return;
    }
    var approve = event.target.closest("[data-approve]");
    if (approve) {
      window.VodStore.setEnrollment(approve.getAttribute("data-approve"), "approved").then(function (approved) {
        setStatus(approved.ok ? "수강 신청을 승인했습니다." : approved.message, !approved.ok);
        render();
      });
      return;
    }
    var reject = event.target.closest("[data-reject]");
    if (reject) {
      window.VodStore.setEnrollment(reject.getAttribute("data-reject"), "rejected").then(function (rejected) {
        setStatus(rejected.ok ? "수강 신청을 거절했습니다." : rejected.message, !rejected.ok);
        render();
      });
      return;
    }
    var upload = event.target.closest("[data-upload]");
    if (upload) {
      if (busy) return;
      var lessonId = upload.getAttribute("data-upload");
      var input = root.querySelector('[data-file-for="' + lessonId + '"]');
      var file = input && input.files && input.files[0];
      if (!file) {
        setStatus("올릴 영상 파일을 선택해 주세요.", true);
        render();
        return;
      }
      if (!isVideo(file)) {
        setStatus("동영상 파일만 올릴 수 있습니다.", true);
        render();
        return;
      }
      busy = true;
      setStatus("영상을 저장하는 중입니다.");
      render();
      window.VodStore.saveVideo(lessonId, file).then(function (result) {
        busy = false;
        setStatus(result.ok ? "영상을 저장했습니다." : result.message, !result.ok);
        render();
      });
      return;
    }
    var removeVideo = event.target.closest("[data-remove-video]");
    if (removeVideo) {
      if (busy) return;
      if (!window.confirm("이 회차에 올린 영상을 삭제할까요?")) return;
      busy = true;
      window.VodStore.removeVideo(removeVideo.getAttribute("data-remove-video")).then(function (result) {
        busy = false;
        setStatus(result.ok ? "영상을 삭제했습니다." : result.message, !result.ok);
        render();
      });
      return;
    }
    var removeLesson = event.target.closest("[data-remove-lesson]");
    if (removeLesson) {
      if (busy) return;
      if (!window.confirm("이 회차와 올린 영상을 삭제할까요?")) return;
      busy = true;
      window.VodStore.removeLesson(removeLesson.getAttribute("data-remove-lesson")).then(function (result) {
        busy = false;
        setStatus(result.ok ? "회차를 삭제했습니다." : result.message, !result.ok);
        render();
      });
    }
  });

  root.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-add-lesson]");
    if (!form) return;
    event.preventDefault();
    if (busy) return;
    var file = form.video.files && form.video.files[0];
    if (file && !isVideo(file)) {
      setStatus("동영상 파일만 올릴 수 있습니다.", true);
      render();
      return;
    }
    var created = window.VodStore.addLesson({
      courseId: form.getAttribute("data-add-lesson"),
      chapterTitle: form.chapter.value,
      title: form.title.value,
      summary: form.summary.value
    });
    if (!created.ok) {
      setStatus(created.message, true);
      render();
      return;
    }
    if (!file) {
      setStatus("회차를 추가했습니다.");
      render();
      return;
    }
    busy = true;
    setStatus("회차를 추가하고 영상을 저장하는 중입니다.");
    render();
    window.VodStore.saveVideo(created.id, file).then(function (result) {
      busy = false;
      setStatus(result.ok ? "회차와 영상을 저장했습니다." : "회차는 추가됐지만 영상을 저장하지 못했습니다. " + result.message, !result.ok);
      render();
    });
  });

  window.onVodLogin = function () { render(); };
  render();
  });
})();
