(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var tab = "home";
  var selectedCourseId = "";
  var creatingCourse = false;
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

  function isImage(file) {
    if (!file) return false;
    if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") return true;
    return /\.(jpe?g|png|webp)$/i.test(file.name || "");
  }

  function isVideo(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf("video/") === 0) return true;
    return /\.(mp4|webm|mov|m4v|ogg|ogv|mkv)$/i.test(file.name);
  }

  function setStatus(text, error) {
    status = { text: text || "", error: !!error };
  }

  /* form.title은 입력창이 아니라 폼의 title 속성이라, 이름 있는 입력은 elements로 읽습니다. */
  function fieldValue(form, name) {
    var field = form.elements.namedItem(name);
    return field && typeof field.value === "string" ? field.value : "";
  }

  function focusStatus() {
    var statusNode = document.querySelector(".admin-status");
    if (statusNode && statusNode.scrollIntoView) statusNode.scrollIntoView({ block: "center" });
  }

  function focusLesson(lessonId) {
    var row = document.getElementById("lesson-row-" + lessonId);
    if (!row) return;
    row.classList.add("is-new");
    if (row.scrollIntoView) row.scrollIntoView({ block: "center" });
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
    var panel = dashboardPanel();
    if (tab === "members") panel = membersPanel();
    if (tab === "enroll") panel = enrollPanel();
    if (tab === "courses") panel = coursesPanel();
    root.innerHTML =
      '<header class="page-intro">' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>ADMIN</p>' +
        "<h1>관리자 대시보드</h1>" +
        '<p class="lede">' + window.VodUI.esc(user.name) + " 님, 회원별 수강 영상 승인과 수강 기간을 관리합니다.</p>" +
        '<p class="admin-status' + (status.error ? " is-error" : "") + '" role="status">' + window.VodUI.esc(status.text) + "</p>" +
        '<div class="hero-actions"><button type="button" class="btn" data-logout>로그아웃</button></div>' +
      "</header>" +
      '<div class="admin-tabs" role="tablist">' +
        '<button type="button" class="chip" data-tab="home" aria-pressed="' + (tab === "home" ? "true" : "false") + '">대시보드</button>' +
        '<button type="button" class="chip" data-tab="members" aria-pressed="' + (tab === "members" ? "true" : "false") + '">회원</button>' +
        '<button type="button" class="chip" data-tab="enroll" aria-pressed="' + (tab === "enroll" ? "true" : "false") + '">수강 승인' + (pending ? " " + pending : "") + "</button>" +
        '<button type="button" class="chip" data-tab="courses" aria-pressed="' + (tab === "courses" ? "true" : "false") + '">강의</button>' +
      "</div>" +
      panel;
  }

  function dateInputValue(timestamp) {
    if (!timestamp) return "";
    var date = new Date(timestamp);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function periodText(item) {
    if (item.status !== "approved") return "";
    if (!item.accessStart && !item.accessEnd) return "기간 제한 없음";
    var start = item.accessStart ? dateInputValue(item.accessStart).replace(/-/g, ".") : "승인 즉시";
    var end = item.accessEnd ? dateInputValue(item.accessEnd).replace(/-/g, ".") : "종료일 없음";
    return start + " ~ " + end;
  }

  function accessLabel(item) {
    if (item.status === "rejected") return "거절";
    if (item.status !== "approved") return "대기";
    var now = Date.now();
    if (item.accessStart && now < item.accessStart) return "시작 전";
    if (item.accessEnd && now > item.accessEnd) return "기간 종료";
    return "수강 중";
  }

  function courseOptions() {
    return window.VodCatalog.courses.map(function (course) {
      return '<option value="' + window.VodUI.esc(course.id) + '">' + window.VodUI.esc(course.title) + "</option>";
    }).join("");
  }

  function dashboardPanel() {
    var users = window.VodStore.listUsers().filter(function (item) { return item.role !== "admin"; });
    var rows = window.VodStore.listEnrollments();
    var now = Date.now();
    var pending = rows.filter(function (item) { return item.status === "pending"; });
    var active = rows.filter(function (item) {
      return item.status === "approved" && (!item.accessStart || now >= item.accessStart) && (!item.accessEnd || now <= item.accessEnd);
    });
    var expired = rows.filter(function (item) { return item.status === "approved" && item.accessEnd && now > item.accessEnd; });
    var cards = [
      [String(users.length), "회원"],
      [String(pending.length), "승인 대기"],
      [String(active.length), "수강 중"],
      [String(expired.length), "기간 종료"]
    ].map(function (item) {
      return '<article class="dash-card"><strong>' + item[0] + "</strong><span>" + item[1] + "</span></article>";
    }).join("");
    var waiting = pending.slice(0, 5).map(function (item) {
      return '<article class="enroll-row"><div><strong>' + window.VodUI.esc(item.name) + "</strong><p>" +
        window.VodUI.esc(item.email) + " · " + window.VodUI.esc(item.courseTitle) + "</p></div>" +
        '<button type="button" class="btn small primary" data-tab="enroll">승인하러 가기</button></article>';
    }).join("");
    return '<section class="dash-grid">' + cards + "</section>" +
      '<section class="section"><div class="section-head"><div><h2>승인 대기</h2></div></div>' +
      (waiting || '<div class="empty"><strong>대기 중인 신청이 없습니다</strong><p>회원이 수강 신청을 하면 이곳에 나타납니다.</p></div>') +
      "</section>";
  }

  function membersPanel() {
    var me = window.VodStore.getStudent();
    var users = window.VodStore.listUsers();
    if (!users.length) {
      return '<div class="empty"><strong>등록된 회원이 없습니다</strong><p>회원가입한 수강생이 이곳에 나타납니다.</p></div>';
    }
    return users.map(function (user) {
      var rows = window.VodStore.listEnrollments().filter(function (item) { return item.userId === user.id; });
      var list = rows.length
        ? rows.map(function (item) {
            return "<li><strong>" + window.VodUI.esc(item.courseTitle) + "</strong> · " + accessLabel(item) +
              (periodText(item) ? " · " + window.VodUI.esc(periodText(item)) : "") + "</li>";
          }).join("")
        : "<li>승인된 강의가 없습니다.</li>";
      /* 기본 관리자(admin@ncodelab.kr)는 서버가 ADMIN_PASSWORD로 관리하므로 권한을 바꾸지 않습니다. */
      var self = me && user.id === me.id;
      var locked = self || user.email === "admin@ncodelab.kr";
      var roleButton = "";
      if (!locked && user.role !== "admin") {
        roleButton = '<button type="button" class="btn small primary" data-role="admin" data-user-id="' + window.VodUI.esc(user.id) + '" data-user-name="' + window.VodUI.esc(user.name) + '">관리자로 전환</button>';
      } else if (!locked && user.role === "admin") {
        roleButton = '<button type="button" class="btn small" data-role="student" data-user-id="' + window.VodUI.esc(user.id) + '" data-user-name="' + window.VodUI.esc(user.name) + '">수강생으로 변경</button>';
      }
      var deleteButton = user.role === "admin" ? "" : '<button type="button" class="btn small danger" data-delete-user="' + window.VodUI.esc(user.id) + '" data-user-name="' + window.VodUI.esc(user.name) + '">회원 삭제</button>';
      var roleLabel = user.role === "admin" ? " · 관리자" + (self ? " · 본인" : "") : "";
      var grant = user.role === "admin" ? "" :
        '<form class="manage-form" data-grant-user="' + window.VodUI.esc(user.id) + '">' +
          "<h3>수강 승인</h3>" +
          '<label class="field">강의<select name="course" required>' + courseOptions() + "</select></label>" +
          '<div class="period-fields"><label class="field">시작일<input name="start" type="date" /></label>' +
          '<label class="field">종료일<input name="end" type="date" /></label></div>' +
          '<button class="btn primary" type="submit">이 강의 승인</button>' +
        "</form>";
      return '<section class="member-card"><div class="member-head"><div><strong>' + window.VodUI.esc(user.name) + "</strong><p>" +
        window.VodUI.esc(user.email) + roleLabel + " · 가입 " + window.VodUI.esc(window.VodUI.formatWhen(user.createdAt)) + "</p></div>" +
        '<div class="member-actions">' + roleButton + deleteButton + "</div></div>" +
        '<ul class="user-list">' + list + "</ul>" + grant + "</section>";
    }).join("");
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
          var label = accessLabel(item);
          var pill = item.status === "approved" && label !== "수강 중" ? "pending" : item.status;
          return '<article class="enroll-row enroll-edit">' +
            "<div><strong>" + window.VodUI.esc(item.name) + "</strong>" +
            "<p>" + window.VodUI.esc(item.email) + " · " + window.VodUI.esc(item.courseTitle) +
            (periodText(item) ? " · " + window.VodUI.esc(periodText(item)) : "") + "</p>" +
            '<div class="period-fields"><label class="field">시작일<input type="date" data-start-for="' + window.VodUI.esc(item.id) + '" value="' + dateInputValue(item.accessStart) + '" /></label>' +
            '<label class="field">종료일<input type="date" data-end-for="' + window.VodUI.esc(item.id) + '" value="' + dateInputValue(item.accessEnd) + '" /></label></div></div>' +
            '<div class="enroll-actions"><span class="pill ' + window.VodUI.esc(pill) + '">' + label + "</span>" +
            '<button type="button" class="btn small primary" data-approve="' + window.VodUI.esc(item.id) + '">승인</button>' +
            '<button type="button" class="btn small" data-reject="' + window.VodUI.esc(item.id) + '"' + (item.status === "rejected" ? " disabled" : "") + ">거절</button></div></article>";
        }).join("")
      : '<div class="empty"><strong>표시할 신청이 없습니다</strong><p>수강생이 강의에서 수강 신청을 하면 이곳에 나타납니다.</p></div>';
    return '<section class="section"><div class="chips">' + filters + '</div><div class="stack">' + body + "</div></section>";
  }

  function periodFrom(id) {
    var start = root.querySelector('[data-start-for="' + id + '"]');
    var end = root.querySelector('[data-end-for="' + id + '"]');
    return {
      accessStart: start ? start.value : "",
      accessEnd: end ? end.value : ""
    };
  }

  function courseGrid() {
    var cards = window.VodCatalog.courses.map(function (course) {
      var count = 0;
      (course.chapters || []).forEach(function (chapter) {
        count += (chapter.lessons || []).length;
      });
      return '<button type="button" class="course-card" data-pick-course="' + window.VodUI.esc(course.id) + '">' +
        window.VodUI.thumbBlock(course, "VOD · " + window.VodUI.esc(course.category)) +
        '<h3 class="card-title">' + window.VodUI.esc(course.title) + "</h3>" +
        '<p class="card-desc">' + window.VodUI.esc(course.summary) + "</p>" +
        '<p class="card-meta">' + count + "강</p></button>";
    }).join("");
    return '<p class="fine">카드를 누르면 그 강의의 소개와 영상만 수정합니다.</p>' +
      '<div class="card-grid">' + cards +
      '<button type="button" class="course-card admin-add" data-new-course><span class="admin-add-mark" aria-hidden="true">+</span><strong>강의 추가</strong><span>새 강의 카드를 만듭니다.</span></button></div>';
  }

  function newCourseForm() {
    return '<p><button type="button" class="btn" data-course-back>강의 목록</button></p>' +
      '<form class="manage-form" data-add-course>' +
        "<h3>새 강의</h3>" +
        '<label class="field">분류<input name="category" required maxlength="20" placeholder="자격증" /></label>' +
        '<label class="field">강의 제목<input name="title" required maxlength="80" placeholder="강의 제목" /></label>' +
        '<label class="field">한 줄 소개<input name="summary" required maxlength="300" placeholder="이 강의에서 배우는 내용" /></label>' +
        '<label class="field">수강 대상<input name="audience" maxlength="200" placeholder="어떤 수강생에게 맞는 강의인지" /></label>' +
        '<button class="btn primary" type="submit"' + (busy ? " disabled" : "") + ">강의 추가</button>" +
      "</form>";
  }

  function coursesPanel() {
    if (creatingCourse) return newCourseForm();
    var course = null;
    window.VodCatalog.courses.forEach(function (item) {
      if (item.id === selectedCourseId) course = item;
    });
    if (!course) return courseGrid();
    return '<p><button type="button" class="btn" data-course-back>강의 목록</button></p>' + [course].map(function (course) {
      var preview = course.coverUrl
        ? '<img class="cover-preview" src="' + window.VodUI.esc(course.coverUrl) + '" alt="" />'
        : '<div class="thumb tone-' + window.VodUI.esc(course.tone) + ' cover-fallback"><strong>이미지 없음</strong></div>';
      var removeCover = course.coverUrl
        ? '<button type="button" class="btn small" data-remove-cover="' + window.VodUI.esc(course.id) + '"' + (busy ? " disabled" : "") + ">이미지 삭제</button>"
        : "";
      var lessonBody = (course.chapters || []).map(function (chapter) {
        var rows = (chapter.lessons || []).map(function (lesson, index) {
          var meta = window.VodStore.videoMeta(lesson.id);
          var info = meta
            ? window.VodUI.esc(meta.name) + " · " + bytes(meta.size) + (meta.seconds ? " · " + window.VodUI.clock(meta.seconds) : "")
            : "등록된 영상이 없습니다. 승인된 수강생에게는 샘플 영상이 재생됩니다.";
          var removeVideo = meta ? '<button type="button" class="btn small" data-remove-video="' + window.VodUI.esc(lesson.id) + '">영상 삭제</button>' : "";
          return '<div class="lesson-admin" id="lesson-row-' + window.VodUI.esc(lesson.id) + '"><div><strong>' + String(index + 1).padStart(2, "0") + ". " + window.VodUI.esc(lesson.title) + "</strong><p>" + info + "</p></div>" +
            '<div class="file-line"><input type="file" data-file-for="' + window.VodUI.esc(lesson.id) + '" accept="video/*" />' +
            '<button type="button" class="btn small primary" data-upload="' + window.VodUI.esc(lesson.id) + '"' + (busy ? " disabled" : "") + ">업로드</button>" +
            removeVideo +
            '<button type="button" class="btn small danger" data-remove-lesson="' + window.VodUI.esc(lesson.id) + '">회차 삭제</button></div></div>';
        }).join("");
        return '<h3 class="chapter-label">' + window.VodUI.esc(chapter.title) + "</h3>" + (rows || '<p class="fine">이 챕터에 회차가 없습니다.</p>');
      }).join("");
      var options = (course.chapters || []).map(function (chapter) {
        return '<option value="' + window.VodUI.esc(chapter.title) + '"></option>';
      }).join("");
      return '<section class="admin-course"><div class="member-head"><h2>' + window.VodUI.esc(course.title) + "</h2>" +
        '<button type="button" class="btn small danger" data-delete-course="' + window.VodUI.esc(course.id) + '" data-course-name="' + window.VodUI.esc(course.title) + '"' + (busy ? " disabled" : "") + ">강의 삭제</button></div>" +
        '<form class="manage-form" data-course-page="' + window.VodUI.esc(course.id) + '">' +
          "<h3>소개 글</h3>" +
          '<label class="field">분류<input name="category" required maxlength="20" value="' + window.VodUI.esc(course.category) + '" /></label>' +
          '<label class="field">강의 제목<input name="title" required maxlength="80" value="' + window.VodUI.esc(course.title) + '" /></label>' +
          '<label class="field">한 줄 소개<input name="summary" required maxlength="300" value="' + window.VodUI.esc(course.summary) + '" /></label>' +
          '<label class="field">수강 대상<input name="audience" required maxlength="200" value="' + window.VodUI.esc(course.audience) + '" /></label>' +
          '<label class="field">학습 목표<textarea name="goals" rows="4" required maxlength="1000">' + window.VodUI.esc((course.goals || []).join("\n")) + "</textarea></label>" +
          '<p class="fine">학습 목표는 한 줄에 하나씩 입력합니다.</p>' +
          '<label class="field">이미지 없을 때 카드 문구<textarea name="thumbLines" rows="2" required maxlength="80">' + window.VodUI.esc((course.thumbLines || []).join("\n")) + "</textarea></label>" +
          '<button class="btn primary" type="submit"' + (busy ? " disabled" : "") + ">소개 저장</button>" +
        "</form>" +
        '<div class="cover-box"><h3>자격증 이미지</h3>' + preview +
          '<div class="file-line"><input type="file" data-cover-for="' + window.VodUI.esc(course.id) + '" accept="image/jpeg,image/png,image/webp" />' +
          '<button type="button" class="btn small primary" data-upload-cover="' + window.VodUI.esc(course.id) + '"' + (busy ? " disabled" : "") + ">이미지 올리기</button>" +
          removeCover + "</div>" +
          '<p class="fine">JPG, PNG, WEBP · 5MB 이하. 강의 소개 왼쪽에 표시됩니다.</p>' +
          (/이미지|자격증/.test(status.text) ? '<p class="cover-status' + (status.error ? " is-error" : "") + '">' + window.VodUI.esc(status.text) + "</p>" : "") +
          "</div>" +
        "<h3>회차 영상</h3>" +
        (lessonBody || '<p class="fine">아직 회차가 없습니다. 아래에서 회차와 영상을 추가하세요.</p>') +
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
      if (tab === "courses") {
        selectedCourseId = "";
        creatingCourse = false;
      }
      render();
      return;
    }
    var pickCourse = event.target.closest("[data-pick-course]");
    if (pickCourse) {
      selectedCourseId = pickCourse.getAttribute("data-pick-course");
      creatingCourse = false;
      render();
      return;
    }
    if (event.target.closest("[data-new-course]")) {
      creatingCourse = true;
      selectedCourseId = "";
      render();
      return;
    }
    if (event.target.closest("[data-course-back]")) {
      creatingCourse = false;
      selectedCourseId = "";
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
      window.VodStore.setEnrollment(approve.getAttribute("data-approve"), "approved", periodFrom(approve.getAttribute("data-approve"))).then(function (approved) {
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
    var uploadCover = event.target.closest("[data-upload-cover]");
    if (uploadCover) {
      if (busy) return;
      var courseId = uploadCover.getAttribute("data-upload-cover");
      var coverInput = root.querySelector('[data-cover-for="' + courseId + '"]');
      var coverFile = coverInput && coverInput.files && coverInput.files[0];
      if (!coverFile) {
        setStatus("올릴 이미지를 선택해 주세요.", true);
        render();
        return;
      }
      if (!isImage(coverFile)) {
        setStatus("JPG, PNG, WEBP 이미지만 올릴 수 있습니다.", true);
        render();
        return;
      }
      busy = true;
      setStatus("이미지를 저장하는 중입니다.");
      render();
      window.VodStore.saveCourseCover(courseId, coverFile).then(function (result) {
        busy = false;
        setStatus(result.ok ? "자격증 이미지를 저장했습니다." : result.message, !result.ok);
        render();
        var box = document.querySelector(".cover-box");
        if (box && box.scrollIntoView) box.scrollIntoView({ block: "center" });
      });
      return;
    }
    var removeCover = event.target.closest("[data-remove-cover]");
    if (removeCover) {
      if (busy) return;
      if (!window.confirm("이 강의의 자격증 이미지를 삭제할까요?")) return;
      busy = true;
      window.VodStore.removeCourseCover(removeCover.getAttribute("data-remove-cover")).then(function (result) {
        busy = false;
        setStatus(result.ok ? "자격증 이미지를 삭제했습니다." : result.message, !result.ok);
        render();
      });
      return;
    }
    var removeCourse = event.target.closest("[data-delete-course]");
    if (removeCourse) {
      if (busy) return;
      var courseName = removeCourse.getAttribute("data-course-name") || "이 강의";
      if (!window.confirm(courseName + " 강의와 회차, 영상, 수강 신청을 삭제할까요?")) return;
      busy = true;
      window.VodStore.deleteCourse(removeCourse.getAttribute("data-delete-course")).then(function (result) {
        busy = false;
        if (result.ok) selectedCourseId = "";
        setStatus(result.ok ? "강의를 삭제했습니다." : result.message, !result.ok);
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

  root.addEventListener("click", function (event) {
    var roleButton = event.target.closest("[data-role]");
    if (roleButton) {
      if (busy) return;
      var nextRole = roleButton.getAttribute("data-role");
      var roleName = roleButton.getAttribute("data-user-name") || "이 회원";
      var ask = nextRole === "admin"
        ? roleName + " 님을 관리자로 바꿀까요? 관리자는 승인 없이 모든 영상을 볼 수 있습니다."
        : roleName + " 님을 수강생으로 바꿀까요?";
      if (!window.confirm(ask)) return;
      busy = true;
      window.VodStore.setUserRole(roleButton.getAttribute("data-user-id"), nextRole).then(function (result) {
        busy = false;
        setStatus(result.ok ? (nextRole === "admin" ? "관리자로 바꿨습니다." : "수강생으로 바꿨습니다.") : result.message, !result.ok);
        render();
      });
      return;
    }
    var removeUser = event.target.closest("[data-delete-user]");
    if (!removeUser) return;
    if (busy) return;
    var name = removeUser.getAttribute("data-user-name") || "이 회원";
    if (!window.confirm(name + " 계정과 수강 기록을 삭제할까요?")) return;
    busy = true;
    window.VodStore.deleteUser(removeUser.getAttribute("data-delete-user")).then(function (result) {
      busy = false;
      setStatus(result.ok ? "회원을 삭제했습니다." : result.message, !result.ok);
      render();
    });
  });

  root.addEventListener("submit", function (event) {
    var grant = event.target.closest("[data-grant-user]");
    if (grant) {
      event.preventDefault();
      if (busy) return;
      busy = true;
      window.VodStore.grantEnrollment(grant.getAttribute("data-grant-user"), fieldValue(grant, "course"), {
        accessStart: fieldValue(grant, "start"),
        accessEnd: fieldValue(grant, "end")
      }).then(function (result) {
        busy = false;
        setStatus(result.ok ? "수강을 승인했습니다." : result.message, !result.ok);
        render();
      });
      return;
    }
    var addCourse = event.target.closest("[data-add-course]");
    if (addCourse) {
      event.preventDefault();
      if (busy) return;
      busy = true;
      setStatus("강의를 추가하는 중입니다.");
      window.VodStore.createCourse({
        category: fieldValue(addCourse, "category"),
        title: fieldValue(addCourse, "title"),
        summary: fieldValue(addCourse, "summary"),
        audience: fieldValue(addCourse, "audience")
      }).then(function (result) {
        busy = false;
        creatingCourse = false;
        if (result.ok && result.id) selectedCourseId = result.id;
        setStatus(result.ok ? "강의를 추가했습니다. 소개와 영상을 이어서 올려 주세요." : result.message, !result.ok);
        render();
      });
      return;
    }
    var pageForm = event.target.closest("[data-course-page]");
    if (pageForm) {
      event.preventDefault();
      if (busy) return;
      busy = true;
      setStatus("강의 소개를 저장하는 중입니다.");
      window.VodStore.saveCoursePage(pageForm.getAttribute("data-course-page"), {
        category: fieldValue(pageForm, "category"),
        title: fieldValue(pageForm, "title"),
        summary: fieldValue(pageForm, "summary"),
        audience: fieldValue(pageForm, "audience"),
        goals: fieldValue(pageForm, "goals"),
        thumbLines: fieldValue(pageForm, "thumbLines")
      }).then(function (result) {
        busy = false;
        setStatus(result.ok ? "강의 소개를 저장했습니다." : result.message, !result.ok);
        render();
      });
      return;
    }
    var form = event.target.closest("[data-add-lesson]");
    if (!form) return;
    event.preventDefault();
    if (busy) return;
    var fileInput = form.elements.namedItem("video");
    var file = fileInput && fileInput.files && fileInput.files[0];
    var chapterTitle = fieldValue(form, "chapter").trim();
    var lessonTitle = fieldValue(form, "title").trim();
    if (!chapterTitle) {
      setStatus("챕터 이름을 입력해 주세요. 새 이름이면 새 챕터가 만들어집니다.", true);
      render();
      focusStatus();
      return;
    }
    if (lessonTitle.length < 2) {
      setStatus("회차 제목을 두 글자 이상 입력한 뒤 회차 추가를 눌러 주세요.", true);
      render();
      focusStatus();
      return;
    }
    if (file && !isVideo(file)) {
      setStatus("동영상 파일만 올릴 수 있습니다.", true);
      render();
      focusStatus();
      return;
    }
    busy = true;
    setStatus(file ? "회차를 추가하고 영상을 저장하는 중입니다." : "회차를 추가하는 중입니다.");
    render();
    focusStatus();
    window.VodStore.addLesson({
      courseId: form.getAttribute("data-add-lesson"),
      chapterTitle: chapterTitle,
      title: lessonTitle,
      summary: fieldValue(form, "summary")
    }).then(function (created) {
      if (!created.ok) {
        busy = false;
        setStatus(created.message, true);
        render();
        focusStatus();
        return;
      }
      if (!file) {
        busy = false;
        setStatus(chapterTitle + " 챕터에 '" + lessonTitle + "' 회차를 추가했습니다.");
        render();
        focusLesson(created.id);
        return;
      }
      render();
      focusLesson(created.id);
      window.VodStore.saveVideo(created.id, file).then(function (result) {
        busy = false;
        setStatus(result.ok ? chapterTitle + " 챕터에 회차와 영상을 저장했습니다." : "회차는 추가됐지만 영상을 저장하지 못했습니다. " + result.message, !result.ok);
        render();
        focusLesson(created.id);
      });
    });
  });

  window.onVodLogin = function () { render(); };
  render();
  });
})();
