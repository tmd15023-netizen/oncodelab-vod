/* 강의 목록입니다.
   회차에 실제 영상을 넣으려면 lesson 안에 video 주소를 추가하세요.
   video: "https://cdn.example.com/lesson1.mp4"
   주소가 없으면 assets/sample.mp4 미리보기가 재생됩니다. */
(function () {
  function lesson(id, title, seconds, summary) {
    return { id: id, title: title, seconds: seconds, summary: summary };
  }

  function chapter(title, lessons) {
    return { title: title, lessons: lessons };
  }

  var courses = [
    {
      id: "aipot-2",
      category: "자격증",
      tone: "violet",
      featured: true,
      pathLabel: "AI-POT 2급",
      title: "AI-POT 2급 생성형 AI 기초",
      thumbLines: ["AI-POT 2급", "생성형 AI 기초"],
      summary: "생성형 AI의 기본 사용과 2급 수준 과제를 순서대로 연습합니다.",
      audience: "AI를 업무에 처음 쓰거나 AI-POT 2급을 준비하는 분",
      goals: [
        "생성형 AI가 맡기 좋은 일과 사람이 확인해야 할 일을 구분한다",
        "역할, 대상, 분량, 말투를 넣어 질문을 다시 쓴다",
        "문서 초안과 요약을 만들고 틀린 문장을 골라낸다"
      ],
      chapters: [
        chapter("1. 생성형 AI를 다루는 기준", [
          lesson("aipot-2-1", "생성형 AI가 실제로 하는 일", 520, "문장을 만들고 요약하는 범위와, 사실 확인은 사람이 남겨야 하는 이유를 나눕니다."),
          lesson("aipot-2-2", "질문을 구체적으로 다시 쓰기", 680, "역할, 대상, 분량, 말투를 넣어 같은 요청을 다시 작성합니다."),
          lesson("aipot-2-3", "틀린 답을 골라 고치는 습관", 550, "그럴듯하지만 근거가 없는 문장을 표시하고 다시 묻는 순서를 익힙니다.")
        ]),
        chapter("2. 2급 과제를 끝까지", [
          lesson("aipot-2-4", "공지와 안내문 초안 만들기", 870, "목적과 일정을 넣어 바로 보낼 수 있는 초안 구조를 만듭니다."),
          lesson("aipot-2-5", "긴 글을 표로 정리하기", 725, "회의록과 안내문에서 항목, 담당, 기한만 남기는 정리 방식입니다."),
          lesson("aipot-2-6", "모의 과제를 시간 안에 끝내기", 1000, "문제 읽기, 초안, 검토 순서로 2급 유형을 혼자 끝냅니다.")
        ])
      ]
    },
    {
      id: "aipot-1",
      category: "자격증",
      tone: "blue",
      featured: true,
      pathLabel: "AI-POT 1급",
      title: "AI-POT 1급 실무 활용",
      thumbLines: ["AI-POT 1급", "실무 활용"],
      summary: "업무에 쓸 프롬프트와 검토 기준을 잡고 1급 실기 유형을 풉니다.",
      audience: "2급 내용을 마쳤거나 AI-POT 1급 실기를 준비하는 분",
      goals: [
        "반복 업무 중에서 AI에 먼저 맡길 일을 고른다",
        "역할, 제약, 예시를 한 번에 적어 재작업을 줄인다",
        "홍보 문안과 표 요약을 검토 목록에 맞춰 다듬는다"
      ],
      chapters: [
        chapter("1. 일을 맡기는 기준", [
          lesson("aipot-1-1", "반복되는 업무부터 찾기", 640, "하루 업무에서 매번 같은 형식으로 반복되는 일만 추립니다."),
          lesson("aipot-1-2", "역할과 제약, 예시를 한 번에 적기", 810, "누가 읽는지, 하면 안 되는 것, 잘된 예를 한 요청에 넣습니다."),
          lesson("aipot-1-3", "결과물 검토 체크리스트", 590, "사실, 말투, 빠진 조건, 개인정보 네 가지로 결과를 검사합니다.")
        ]),
        chapter("2. 실기형 과제", [
          lesson("aipot-1-4", "홍보 문안을 톤에 맞게 다듬기", 940, "같은 내용을 안내, 권유, 짧은 배너 문장으로 나눠 씁니다."),
          lesson("aipot-1-5", "설문과 표를 요약하기", 760, "숫자와 의견을 섞지 않고 결론이 먼저 나오게 요약합니다."),
          lesson("aipot-1-6", "1급 모의 실기 풀이", 1100, "제한 시간 안에 요구사항을 체크하며 실기 한 세트를 풉니다.")
        ])
      ]
    },
    {
      id: "promo",
      category: "홍보물",
      tone: "coral",
      featured: true,
      pathLabel: "디지털 홍보물",
      title: "디지털 홍보물 제작",
      thumbLines: ["디지털 홍보물", "카드뉴스 · 배너"],
      summary: "카드뉴스, 배너, 상세페이지를 한 세트로 구성하는 녹화 강의입니다.",
      audience: "카드뉴스와 배너, 상세페이지를 직접 만들어야 하는 분",
      goals: [
        "한 장의 홍보물에서 먼저 말할 문장을 정한다",
        "카드뉴스, 배너, 상세페이지의 순서를 각각 설계한다",
        "색, 말투, 이미지 지시문을 채널에 맞게 고정한다"
      ],
      chapters: [
        chapter("1. 한 장으로 설명하기", [
          lesson("promo-1", "카드뉴스 네 장의 흐름", 700, "문제, 해결, 장면, 행동 유도 순서로 네 장을 나눕니다."),
          lesson("promo-2", "배너에 들어갈 한 문장", 480, "잘리는 화면에서도 의미가 남도록 문장을 짧게 고칩니다."),
          lesson("promo-3", "상세페이지가 설득하는 순서", 860, "첫 화면, 특징, 사용 장면, 문의로 이어지는 스크롤 구조입니다.")
        ]),
        chapter("2. 브랜드에 맞추기", [
          lesson("promo-4", "색과 말투를 고정하기", 640, "강의 안에 쓸 색 수와 말투 규칙을 한 장으로 정리합니다."),
          lesson("promo-5", "이미지 지시문을 구체적으로 쓰기", 790, "구도, 대상, 여백, 제외할 요소를 지시문에 넣습니다."),
          lesson("promo-6", "채널별 크기로 내보내기", 920, "카드뉴스, 배너, 상세페이지 저장 크기와 파일 이름을 맞춥니다.")
        ])
      ]
    },
    {
      id: "web",
      category: "웹 제작",
      tone: "teal",
      featured: true,
      pathLabel: "홈페이지 제작",
      title: "생성형 AI 홈페이지 제작",
      thumbLines: ["생성형 AI", "홈페이지 제작"],
      summary: "첫 화면 기획부터 공개 전 점검까지 홈페이지 제작 과정을 따라 합니다.",
      audience: "소개용 홈페이지가 필요하지만 화면을 처음부터 짜 본 적이 없는 분",
      goals: [
        "첫 화면에서 방문자에게 말할 내용을 한 문장으로 정한다",
        "섹션 순서와 버튼 문구를 먼저 글로 작성한다",
        "휴대폰 화면과 공개 전 목록으로 결과물을 점검한다"
      ],
      chapters: [
        chapter("1. 첫 화면 기획", [
          lesson("web-1", "방문자가 3초 안에 알 내용", 610, "누구를 위한 페이지인지, 무엇을 해 주는지, 다음에 누를 버튼을 정합니다."),
          lesson("web-2", "섹션을 위에서 아래로 배치하기", 840, "소개, 과정, 결과, 신청 순서가 끊기지 않게 섹션을 나눕니다."),
          lesson("web-3", "버튼 문구와 신뢰 요소", 560, "추상적인 버튼 이름 대신 클릭 후의 행동이 보이게 고칩니다.")
        ]),
        chapter("2. 만들어 공개하기", [
          lesson("web-4", "프롬프트로 레이아웃 지시하기", 980, "섹션 이름, 카드 수, 강조할 문장만 남겨 화면 지시를 작성합니다."),
          lesson("web-5", "휴대폰 화면에서 어색한 곳 고치기", 770, "글자 크기, 버튼 간격, 잘린 문장을 좁은 화면 기준으로 봅니다."),
          lesson("web-6", "공개 전 점검 목록", 890, "링크, 제목, 이미지 여백, 문의 경로를 체크한 뒤 공개합니다.")
        ])
      ]
    },
    {
      id: "vibe",
      category: "웹 제작",
      tone: "ink",
      featured: false,
      pathLabel: "바이브코딩",
      title: "바이브코딩 웹 실무",
      thumbLines: ["바이브코딩", "웹 실무"],
      summary: "HTML과 CSS, 간단한 동작까지 웹 페이지를 직접 조립합니다.",
      audience: "생성된 화면을 읽고 카드, 버튼, 입력을 직접 수정하고 싶은 분",
      goals: [
        "페이지를 헤더, 본문, 푸터 구조로 읽는다",
        "카드 목록과 간격을 CSS로 맞춘다",
        "버튼과 입력값이 화면에 반영되는 흐름을 연결한다"
      ],
      chapters: [
        chapter("1. 페이지의 뼈대", [
          lesson("vibe-1", "헤더, 본문, 푸터로 나누기", 730, "보이는 디자인을 세 영역으로 나누고 각 영역의 역할을 적습니다."),
          lesson("vibe-2", "카드 목록을 CSS로 정렬하기", 860, "카드 너비, 간격, 둥근 모서리를 목록 전체에 같이 적용합니다."),
          lesson("vibe-3", "화면 너비에 따라 간격 줄이기", 690, "넓은 화면의 네 열을 좁은 화면에서 한 열로 바꿉니다.")
        ]),
        chapter("2. 버튼과 입력", [
          lesson("vibe-4", "클릭하면 목록이 바뀌게 하기", 940, "버튼 하나에 분류 하나를 연결해 보이는 카드만 남깁니다."),
          lesson("vibe-5", "입력값을 화면에 반영하기", 810, "입력한 이름을 제목과 인사말에 바로 표시합니다."),
          lesson("vibe-6", "정적 페이지를 올릴 때 확인할 것", 760, "파일 이름, 이미지 경로, 첫 화면 주소를 공개 전에 확인합니다.")
        ])
      ]
    }
  ];

  function byId(id) {
    return courses.find(function (course) { return course.id === id; }) || null;
  }

  function lessonsOf(course) {
    var list = [];
    course.chapters.forEach(function (chapterItem) {
      chapterItem.lessons.forEach(function (item) {
        list.push({
          id: item.id,
          title: item.title,
          seconds: item.seconds,
          summary: item.summary,
          video: item.video || "",
          chapterTitle: chapterItem.title,
          number: list.length + 1
        });
      });
    });
    return list;
  }

  function durationOf(course) {
    return lessonsOf(course).reduce(function (sum, item) { return sum + item.seconds; }, 0);
  }

  var catalog = {
    sampleVideo: "assets/sample.mp4",
    sampleRemote: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    courses: courses,
    byId: byId,
    lessonsOf: lessonsOf,
    durationOf: durationOf
  };

  /* 서버(server.js)도 같은 강의 목록으로 강의와 회차 번호를 확인합니다. */
  if (typeof module === "object" && module.exports) module.exports = catalog;
  else window.VodCatalog = catalog;
})();
