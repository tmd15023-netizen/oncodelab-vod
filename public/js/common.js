(function () {
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clock(seconds) {
    var safe = Math.max(0, Math.round(Number(seconds) || 0));
    var hours = Math.floor(safe / 3600);
    var minutes = Math.floor((safe % 3600) / 60);
    var remain = safe % 60;
    if (hours > 0) {
      return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remain).padStart(2, "0");
    }
    return minutes + ":" + String(remain).padStart(2, "0");
  }

  function koTime(seconds) {
    var safe = Math.max(0, Math.round(Number(seconds) || 0));
    var hours = Math.floor(safe / 3600);
    var minutes = Math.round((safe % 3600) / 60);
    if (minutes === 60) {
      hours += 1;
      minutes = 0;
    }
    if (hours <= 0) return minutes + "분";
    if (minutes === 0) return hours + "시간";
    return hours + "시간 " + minutes + "분";
  }

  function percent(done, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  function formatWhen(timestamp) {
    if (!timestamp) return "";
    var diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return "방금 전";
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + "분 전";
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + "시간 전";
    var date = new Date(timestamp);
    return (date.getMonth() + 1) + "월 " + date.getDate() + "일";
  }

  function watchHref(courseId, lessonId) {
    return "watch.html?course=" + encodeURIComponent(courseId) + "&lesson=" + encodeURIComponent(lessonId);
  }

  function courseCard(course) {
    var state = window.VodStore.courseState(course);
    var title = course.thumbLines.map(function (line) {
      return "<span>" + esc(line) + "</span>";
    }).join("");
    var bar = state.percent > 0
      ? '<div class="bar" aria-hidden="true"><span style="width:' + state.percent + '%"></span></div><p class="pct">진도 ' + state.percent + "%</p>"
      : "";
    return '<a class="course-card" href="course.html?id=' + encodeURIComponent(course.id) + '">' +
      '<div class="thumb tone-' + esc(course.tone) + '">' +
        '<span class="thumb-chip">VOD · ' + esc(course.category) + "</span>" +
        "<strong>" + title + "</strong>" +
      "</div>" +
      '<h3 class="card-title">' + esc(course.title) + "</h3>" +
      '<p class="card-desc">' + esc(course.summary) + "</p>" +
      '<p class="card-meta">' + state.total + "강 · " + esc(koTime(window.VodCatalog.durationOf(course))) + "</p>" +
      bar +
    "</a>";
  }

  function mountAccount() {
    var slot = document.getElementById("account-slot");
    if (!slot) return;
    var student = window.VodStore.getStudent();
    var nav = document.querySelector(".nav-row");
    var adminLink = nav && nav.querySelector("[data-admin-nav]");
    var tool = document.getElementById("admin-tool");
    if (student && student.role === "admin") {
      if (nav && !adminLink) {
        nav.insertAdjacentHTML("beforeend", '<a data-admin-nav href="admin.html">관리</a>');
        adminLink = nav.querySelector("[data-admin-nav]");
      }
      if (adminLink && /admin\.html$/.test(location.pathname)) adminLink.setAttribute("aria-current", "page");
      if (!tool) slot.insertAdjacentHTML("beforebegin", '<a class="tool-link" id="admin-tool" href="admin.html">대시보드</a>');
      slot.innerHTML =
        '<a class="account-btn" href="admin.html">' + esc(student.name) + " 님</a>" +
        '<button type="button" class="account-btn" data-logout>로그아웃</button>';
      return;
    }
    if (adminLink) adminLink.remove();
    if (tool) tool.remove();
    if (student) {
      slot.innerHTML =
        '<a class="account-btn" href="my.html">' + esc(student.name) + " 님</a>" +
        '<button type="button" class="account-btn" data-logout>로그아웃</button>';
      return;
    }
    slot.innerHTML =
      '<button type="button" class="account-btn" data-open-signup>회원가입</button>' +
      '<button type="button" class="account-btn" data-open-gate>로그인</button>';
  }

  function showAuthError(id, message) {
    var error = document.getElementById(id);
    if (!error) return;
    error.hidden = !message;
    error.textContent = message || "";
  }

  function showAuthMode(mode) {
    var login = document.getElementById("auth-login");
    var signup = document.getElementById("auth-signup");
    if (!login || !signup) return;
    login.hidden = mode !== "login";
    signup.hidden = mode !== "signup";
    var field = document.querySelector(mode === "signup" ? '#signup-form input[name="name"]' : '#login-form input[name="email"]');
    if (field) field.focus();
  }

  function finishAuth() {
    closeGate();
    mountAccount();
    if (typeof window.onVodLogin === "function") window.onVodLogin();
    else location.reload();
  }

  function ensureModal() {
    if (document.getElementById("auth-modal")) return;
    document.body.insertAdjacentHTML("beforeend",
      '<div class="modal" id="auth-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">' +
        '<div class="dialog">' +
          '<button type="button" class="icon-x" data-close-gate aria-label="닫기">×</button>' +
          '<div id="auth-login">' +
            '<h2 id="login-title">로그인</h2>' +
            '<p class="lede">이메일과 비밀번호로 입장합니다.</p>' +
            '<form id="login-form">' +
              '<label class="field">이메일<input name="email" type="email" required autocomplete="username" placeholder="email@example.com" /></label>' +
              '<label class="field">비밀번호<input name="password" type="password" required autocomplete="current-password" placeholder="비밀번호" /></label>' +
              '<p class="form-error" id="login-error" hidden></p>' +
              '<button class="btn primary" type="submit">입장하기</button>' +
            "</form>" +
            '<p class="hint">계정이 없나요? <button type="button" data-auth-mode="signup">회원가입</button></p>' +
          "</div>" +
          '<div id="auth-signup" hidden>' +
            '<h2 id="signup-title">회원가입</h2>' +
            '<p class="lede">이름, 이메일, 비밀번호로 가입합니다. 강의별 수강 신청이 승인되면 영상을 볼 수 있습니다.</p>' +
            '<form id="signup-form">' +
              '<label class="field">이름<input name="name" maxlength="20" required autocomplete="name" placeholder="이름을 입력하세요" /></label>' +
              '<label class="field">이메일<input name="email" type="email" required autocomplete="email" placeholder="email@example.com" /></label>' +
              '<label class="field">비밀번호<input name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="8자 이상" /></label>' +
              '<p class="form-error" id="signup-error" hidden></p>' +
              '<button class="btn primary" type="submit">회원가입</button>' +
            "</form>" +
            '<p class="hint">이미 계정이 있나요? <button type="button" data-auth-mode="login">로그인</button></p>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
    document.getElementById("login-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      window.VodStore.login(form.email.value, form.password.value).then(function (result) {
        if (!result.ok) {
          showAuthError("login-error", result.message);
          return;
        }
        finishAuth();
      });
    });
    document.getElementById("signup-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      window.VodStore.register(form.name.value, form.email.value, form.password.value).then(function (result) {
        if (!result.ok) {
          showAuthError("signup-error", result.message);
          return;
        }
        finishAuth();
      });
    });
  }

  function openGate(mode) {
    ensureModal();
    document.getElementById("login-form").reset();
    document.getElementById("signup-form").reset();
    showAuthError("login-error", "");
    showAuthError("signup-error", "");
    document.getElementById("auth-modal").classList.add("is-open");
    document.body.classList.add("modal-open");
    showAuthMode(mode === "signup" ? "signup" : "login");
  }

  function closeGate() {
    var modal = document.getElementById("auth-modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    document.body.classList.remove("modal-open");
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-open-signup]")) {
      event.preventDefault();
      openGate("signup");
    } else if (event.target.closest("[data-open-gate]")) {
      event.preventDefault();
      openGate("login");
    }
    var mode = event.target.closest("[data-auth-mode]");
    if (mode) {
      event.preventDefault();
      showAuthError("login-error", "");
      showAuthError("signup-error", "");
      showAuthMode(mode.getAttribute("data-auth-mode"));
    }
    if (event.target.closest("[data-close-gate]")) {
      event.preventDefault();
      closeGate();
    }
    if (event.target.id === "auth-modal") closeGate();
    if (event.target.closest("[data-logout]")) {
      event.preventDefault();
      window.VodStore.logout().then(function () {
        location.href = "index.html";
      });
    }
    if (event.target.closest("[data-reset-progress]")) {
      event.preventDefault();
      if (window.confirm("이 계정의 학습 기록을 지울까요?")) {
        window.VodStore.clearProgress().then(function () {
          location.reload();
        });
      }
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeGate();
  });

  window.VodUI = {
    esc: esc,
    clock: clock,
    koTime: koTime,
    percent: percent,
    formatWhen: formatWhen,
    watchHref: watchHref,
    courseCard: courseCard,
    mountAccount: mountAccount,
    openGate: openGate
  };

  window.VodStore.ready.then(mountAccount);
})();
