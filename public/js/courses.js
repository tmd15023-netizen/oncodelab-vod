(function () {
  var root = document.getElementById("app");
  var params = new URLSearchParams(location.search);
  var category = "전체";
  var query = "";

  function categories() {
    var list = ["전체"];
    window.VodCatalog.courses.forEach(function (course) {
      if (list.indexOf(course.category) === -1) list.push(course.category);
    });
    return list;
  }

  function paint() {
    var known = categories();
    if (known.indexOf(category) === -1) category = "전체";
    root.innerHTML =
      '<header class="page-intro">' +
        '<p class="eyebrow"><span class="dot" aria-hidden="true"></span>ONCODELAB VOD</p>' +
        "<h1>전체 강의</h1>" +
        '<p class="lede">자격증, 홍보물, 웹 제작 녹화를 회차 단위로 듣습니다. 수강 신청이 승인된 강의만 재생할 수 있습니다.</p>' +
      "</header>" +
      '<div class="filters">' +
        '<div class="chips" id="chips"></div>' +
        '<label class="search"><span class="sr-only">강의 검색</span>' +
          '<input id="q" type="search" placeholder="강의명, 주제 검색" value="' + window.VodUI.esc(query) + '" />' +
        "</label>" +
      "</div>" +
      '<div id="list"></div>';
    paintChips();
    paintList();
  }

  function paintChips() {
    var chips = document.getElementById("chips");
    chips.innerHTML = categories().map(function (item) {
      var pressed = item === category ? "true" : "false";
      return '<button type="button" class="chip" data-cat="' + window.VodUI.esc(item) + '" aria-pressed="' + pressed + '">' + window.VodUI.esc(item) + "</button>";
    }).join("");
  }

  function paintList() {
    var list = document.getElementById("list");
    var keyword = query.trim().toLowerCase();
    var items = window.VodCatalog.courses.filter(function (course) {
      var catOk = category === "전체" || course.category === category;
      var hay = (course.title + " " + course.summary + " " + course.category).toLowerCase();
      return catOk && (!keyword || hay.indexOf(keyword) !== -1);
    });
    if (!items.length) {
      list.innerHTML = '<div class="empty"><strong>찾는 강의가 없습니다</strong><p>다른 분류나 검색어를 선택해 보세요.</p></div>';
      return;
    }
    list.innerHTML = '<div class="card-grid catalog-grid">' + items.map(window.VodUI.courseCard).join("") + "</div>";
  }

  root.addEventListener("click", function (event) {
    var button = event.target.closest("[data-cat]");
    if (!button) return;
    category = button.getAttribute("data-cat");
    var url = new URL(location.href);
    if (category === "전체") url.searchParams.delete("cat");
    else url.searchParams.set("cat", category);
    history.replaceState({}, "", url);
    paintChips();
    paintList();
  });

  root.addEventListener("input", function (event) {
    if (event.target.id !== "q") return;
    query = event.target.value;
    paintList();
  });

  var initial = params.get("cat");
  if (categories().indexOf(initial) !== -1) category = initial;
  paint();
  window.VodStore.ready.then(paint);
})();
