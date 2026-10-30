(function () {
  window.VodStore.ready.then(function () {
  var root = document.getElementById("app");
  var resume = window.VodStore.resumeCourse();
  var stats = window.VodStore.summary();
  var student = window.VodStore.getStudent();

  function art() {
    return '<div class="hero-art" aria-hidden="true">' +
      '<div class="art-card tone-violet"><span>VOD</span><strong>AI-POT 2급</strong></div>' +
      '<div class="art-card tone-blue"><span>VOD</span><strong>AI-POT 1급</strong></div>' +
      '<div class="art-card tone-teal"><span>VOD</span><strong>홈페이지 제작</strong></div>' +
    "</div>";
  }

  function statStack() {
    return '<div class="stat-stack">' +
      "<article><strong>" + stats.started + "</strong><span>수강 중인 강의</span></article>" +
      "<article><strong>" + stats.completedLessons + "</strong><span>완료한 회차</span></article>" +
      "<article><strong>" + stats.remaining + "</strong><span>남은 회차</span></article>" +
    "</div>";
  }

  function hero() {
    if (resume && resume.point.lesson && window.VodStore.canWatch(resume.course.id)) {
      var lesson = resume.point.lesson;
      var hello = student ? '<p class="hello">' + window.VodUI.esc(student.name) + " 님</p>" : "";
      return '<section class="hero">' +
        "<div>" + hello +
          '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>이어서 학습</p>' +
          "<h1>" + window.VodUI.esc(lesson.title) + "</h1>" +
          '<p class="lede">' + window.VodUI.esc(resume.course.title) + " · " + window.VodUI.clock(lesson.seconds) + "</p>" +
          '<div class="bar hero-bar" aria-hidden="true"><span style="width:' + resume.state.percent + '%"></span></div>' +
          '<p class="fine">강의 진도 ' + resume.state.percent + "% · " + resume.state.done + " / " + resume.state.total + "강</p>" +
          '<div class="hero-actions">' +
            '<a class="btn primary" href="' + window.VodUI.watchHref(resume.course.id, lesson.id) + '">' + window.VodUI.esc(resume.point.label) + "</a>" +
            '<a class="btn" href="course.html?id=' + encodeURIComponent(resume.course.id) + '">목차 보기</a>' +
          "</div>" +
        "</div>" +
        '<div class="hero-side">' + statStack() + "</div>" +
      "</section>";
    }

    return '<section class="hero">' +
      "<div>" +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>ONCODELAB VOD</p>' +
        "<h1>녹화 강의를<br />이어서 보는 학습 홈</h1>" +
        '<p class="lede">AI-POT, 디지털 홍보물, 홈페이지 제작, 바이브코딩 수업을 회차별로 시청합니다.<br>보던 위치는 로그인한 계정에 남습니다.</p>' +
        '<div class="hero-actions">' +
          '<a class="btn primary" href="courses.html">전체 강의 보기</a>' +
          '<a class="btn" href="#path">추천 학습 순서</a>' +
        "</div>" +
      "</div>" +
      '<div class="hero-side">' + art() + "</div>" +
    "</section>";
  }

  var path = window.VodCatalog.courses.map(function (course, index) {
    return "<li><a href=\"course.html?id=" + encodeURIComponent(course.id) + '\">' +
      '<span class="step">' + String(index + 1).padStart(2, "0") + "</span>" +
      "<strong>" + window.VodUI.esc(course.pathLabel) + "</strong></a></li>";
  }).join("");

  var featured = window.VodCatalog.courses.filter(function (course) { return course.featured; });

  root.innerHTML =
    hero() +
    '<section class="section" id="path">' +
      '<div class="section-head"><div>' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>LEARNING PATH</p>' +
        "<h2>추천 학습 순서</h2>" +
      "</div></div>" +
      '<ol class="path">' + path + "</ol>" +
    "</section>" +
    '<section class="section">' +
      '<div class="section-head"><div>' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>ONCODELAB VOD</p>' +
        "<h2>바로 들을 강의</h2>" +
      "</div>" +
      '<a class="link-more" href="courses.html">전체 보기 →</a></div>' +
      '<div class="card-grid">' + featured.map(window.VodUI.courseCard).join("") + "</div>" +
    "</section>" +
    '<section class="section" id="guide">' +
      '<div class="section-head"><div>' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>HOW TO</p>' +
        "<h2>이렇게 학습합니다</h2>" +
      "</div></div>" +
      '<div class="guide-grid">' +
        '<article class="guide-card"><span class="step">01</span><h3>강의 고르기</h3><p>전체 강의에서 과정 소개와 목차를 확인합니다. 실시간 일정 없이 필요한 회차부터 보면 됩니다.</p></article>' +
        '<article class="guide-card"><span class="step">02</span><h3>수강 신청</h3><p>회원가입 후 강의를 신청합니다. 관리자가 승인하면 그 강의의 회차를 재생할 수 있습니다.</p></article>' +
        '<article class="guide-card"><span class="step">03</span><h3>이어서 보기</h3><p>같은 계정으로 다시 로그인하면 학습 홈에 보던 회차가 남습니다. 완료한 회차는 목차에 표시됩니다.</p></article>' +
      "</div>" +
      '<p class="expect">회원, 수강 승인, 시청 진도와 영상 파일은 서버 저장소에 보관됩니다.</p>' +
    "</section>";
  });
})();
