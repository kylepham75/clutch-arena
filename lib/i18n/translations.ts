export type Language = "en" | "vi";

export interface TranslationDict {
  brand: {
    tagline: string;
    space: string;
    subspace: string;
  };
  nav: {
    workspace: string;
    clutchRun: string;
    uploadNotes: string;
    aiCoach: string;
    library: string;
    myProgress: string;
    howToPlay: string;
    multiplayer: string;
    studyArena: string;
    live: string;
    clutchNotes?: string;
  };
  sidebar: {
    smallSessions: string;
    bigComebacks: string;
    focusQuote: string;
    youGotThis: string;
    localPractice: string;
  };
  topbar: {
    workspace: string;
    play: string;
    ingest: string;
    coach: string;
    arena: string;
    docViewer: string;
    soundOn: string;
    muteSound: string;
    howToPlay: string;
    langSwitch: string;
  };
  headings: {
    clutchRunReady: string;
    clutchRunFinished: string;
    clutchRunInRun: string;
    uploadTitle: string;
    coachTitle: string;
    arenaTitle: string;
    notesTitle?: string;
    eyebrow: string;
    arenaDesc: string;
    ingestDesc: string;
    coachDesc: string;
    notesDesc?: string;
    playDesc: string;
  };
  run: {
    readyTitle: string;
    readySubtitle: string;
    changeDeck: string;
    startRun: string;
    switchDeck: string;
    quickSwitch: string;
    activeRecallTag: string;
    timerTag: string;
    conceptTwinTag: string;
    pause: string;
    resume: string;
    quit: string;
    questionNum: string;
    of: string;
    streak: string;
    score: string;
    multiplier: string;
    timeRemaining: string;
    hurry: string;
    chooseHint: string;
    correct: string;
    wrong: string;
    timeout: string;
    explanation: string;
    citation: string;
    rule: string;
    askCoach: string;
    viewInDoc: string;
    nextQuestion: string;
    finishRun: string;
    runComplete: string;
    totalScore: string;
    accuracy: string;
    maxStreak: string;
    masteryDelta: string;
    playAgain: string;
    weakSpotSprint: string;
    flashcards: string;
    backToStart: string;
    noDeckInLibrary: string;
    deckConcepts: string;
    keyConcepts: string;
    livesCount: string;
    timerCount: string;
    streakBonus: string;
    howToPlay: string;
    soloPractice: string;
    soloPracticeSubtitle: string;
    readyToPlay: string;
    moreInLibrary: string;
    howPractice: string;
    classicRecall: string;
    classicRecallDesc: string;
    conceptRemix: string;
    conceptRemixDesc: string;
    about2Minutes: string;
    smartRetry: string;
    keyboardReady: string;
    noAccount: string;
    launchComeback: string;
    comebackSprint: string;
    backToFullDeck: string;
    footerLeft: string;
    footerRight: string;
    statusArena: string;
    statusIngest: string;
    statusCoach: string;
    statusSolo: string;
    statusNotes?: string;
    masteryUntested: string;
    masteryMastered: string;
    masteryNeedsReview: string;
    masteryLearning: string;
    summaryEyebrowWon: string;
    summaryEyebrowLost: string;
    summaryTitleWon: string;
    summaryTitleLost: string;
    summarySubtitleWon: string;
    summarySubtitleLost: string;
    takeaways: string;
    xpEarned: string;
    exportDeck: string;
    debriefCoach: string;
    perfectRun: string;
  };
  upload: {
    title: string;
    desc: string;
    dropActive: string;
    dropIdle: string;
    dropSubtitle: string;
    fileTypes: string;
    selectedFiles: string;
    clearAll: string;
    optionsTitle: string;
    questionCount: string;
    mode: string;
    modeVariants: string;
    modeExact: string;
    docLanguage: string;
    langEn: string;
    langVi: string;
    focus: string;
    focusPlaceholder: string;
    generateBtn: string;
    generatePackDesc: string;
    previewBtn: string;
    previewOnlyDesc: string;
    generateMasterBtn: string;
    previewMasterBtn: string;
    processing: string;
    generating: string;
    successGenerated: string;
    playNow: string;
    docSelectedSingle: string;
    docSelectedPlural: string;
    addMoreFiles: string;
    maxFilesAttached: string;
    attachedFiles: string;
    unifiedMasterDeck: string;
    unifiedDesc: string;
    qCount5: string;
    qCount10: string;
    qCount15: string;
    qCount20: string;
    qCount30: string;
    cancel: string;
    studyPackReady: string;
    playSoloRun: string;
    hostInArena: string;
    apiTip: string;
  };
  coach: {
    title: string;
    subtitle: string;
    placeholder: string;
    send: string;
    stop: string;
    clearChat: string;
    noDocument: string;
    noDocDesc: string;
    uploadPrompt: string;
    welcomeMsg: string;
    sourceGrounding: string;
    groundedIn: string;
    citationProof: string;
    suggest1: string;
    suggest2: string;
    suggest3: string;
    askCoachNow: string;
    askAnythingAbout: string;
    everyAnswer: string;
    suggestedQuestions: string;
  };
  library: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyDesc: string;
    playBtn: string;
    shareBtn: string;
    deleteBtn: string;
    questionsCount: string;
    close: string;
  };
  help: {
    title: string;
    subtitle: string;
    rule1Title: string;
    rule1Desc: string;
    rule2Title: string;
    rule2Desc: string;
    rule3Title: string;
    rule3Desc: string;
    gotIt: string;
  };
  arena: {
    badge: string;
    heroTitle: string;
    heroDesc: string;
    avatarLabel: string;
    nicknameLabel: string;
    nicknamePlaceholder: string;
    createTab: string;
    joinTab: string;
    selectPack: string;
    currentPack: string;
    samplePack: string;
    userLibrary: string;
    practiceMode: string;
    classicRecall: string;
    classicRecallDesc: string;
    conceptRemix: string;
    conceptRemixDesc: string;
    launchBtn: string;
    creatingBtn: string;
    roomCodeLabel: string;
    joinBtn: string;
    openLobbies: string;
    noOpenLobbies: string;
    serverVerified: string;
    botsSupported: string;
    liveSync: string;
  };
}

export const translations: Record<Language, TranslationDict> = {
  en: {
    brand: {
      tagline: "MAKE EVERY MINUTE COUNT",
      space: "Your study space",
      subspace: "One more rep. One step closer.",
    },
    nav: {
      workspace: "WORKSPACE",
      clutchRun: "Clutch Run",
      uploadNotes: "Upload notes",
      aiCoach: "AI study coach",
      library: "Study library",
      myProgress: "My progress",
      howToPlay: "How to play",
      multiplayer: "MULTIPLAYER",
      studyArena: "Study Arena",
      live: "Live",
      clutchNotes: "Clutch Notes AI",
    },
    sidebar: {
      smallSessions: "Small sessions.",
      bigComebacks: "Big comebacks.",
      focusQuote: "You don’t need more time. Just a little more focus.",
      youGotThis: "You’ve got this.",
      localPractice: "Local practice session",
    },
    topbar: {
      workspace: "Workspace",
      play: "Play",
      ingest: "Ingest",
      coach: "Coach",
      arena: "Arena",
      docViewer: "Document Viewer",
      soundOn: "Turn sound on",
      muteSound: "Mute sound",
      howToPlay: "How to play",
      langSwitch: "Language",
    },
    headings: {
      clutchRunReady: "Less panic. More practice.",
      clutchRunFinished: "Make the learning stick.",
      clutchRunInRun: "Stay sharp. Stay in it.",
      uploadTitle: "Upload & Process Notes",
      coachTitle: "Your Grounded AI Coach",
      arenaTitle: "Study Arena — Multiplayer",
      notesTitle: "Slide-to-Summary Note Generator",
      eyebrow: "YOUR NEXT COMEBACK STARTS HERE",
      arenaDesc: "Compete in live, synchronized quiz battles with classmates or practice bots.",
      ingestDesc: "Drop your syllabus, slides, or textbook excerpts to generate high-yield active-recall packs in seconds.",
      coachDesc: "Ask any question about your uploaded materials. Verified against exact citations with zero hallucinations.",
      notesDesc: "Transform raw lecture slides into high-retention bilingual notes with LaTeX math and watermarked PDF export.",
      playDesc: "Simulate high-pressure exam conditions with timed questions and concept variants.",
    },
    run: {
      readyTitle: "Ready to clutch it?",
      readySubtitle: "Speed, precision, and concept mastery.",
      changeDeck: "Change Deck",
      startRun: "Start Clutch Run",
      switchDeck: "Switch deck",
      quickSwitch: "Quick switch:",
      activeRecallTag: "Active Recall",
      timerTag: "10s Timer",
      conceptTwinTag: "Concept Twins",
      pause: "Pause",
      resume: "Resume",
      quit: "Quit Run",
      questionNum: "Question",
      of: "of",
      streak: "STREAK",
      score: "SCORE",
      multiplier: "MULTIPLIER",
      timeRemaining: "Time remaining",
      hurry: "Hurry!",
      chooseHint: "Press 1–4 on your keyboard or click an option",
      correct: "Correct!",
      wrong: "Missed",
      timeout: "Time's up!",
      explanation: "EXPLANATION",
      citation: "SOURCE CITATION",
      rule: "KEY FORMULA / RULE",
      askCoach: "Ask AI Coach",
      viewInDoc: "View in document",
      nextQuestion: "Next question",
      finishRun: "View results",
      runComplete: "Run Complete!",
      totalScore: "Total Score",
      accuracy: "Accuracy",
      maxStreak: "Max Streak",
      masteryDelta: "Mastery Gain",
      playAgain: "Play Again",
      weakSpotSprint: "Sprint Weak Spots",
      flashcards: "Review Flashcards",
      backToStart: "Back to Start",
      noDeckInLibrary: "Upload notes to add more decks to your library.",
      deckConcepts: "DECK CONCEPTS",
      keyConcepts: "Key Concepts",
      livesCount: "3 Lives",
      timerCount: "15s Timer",
      streakBonus: "Streak Bonus",
      howToPlay: "How to play",
      soloPractice: "Solo Practice",
      soloPracticeSubtitle: "Five big ideas. One focused run.",
      readyToPlay: "Ready to play",
      moreInLibrary: "+ More in Library...",
      howPractice: "HOW DO YOU WANT TO PRACTICE?",
      classicRecall: "Classic recall",
      classicRecallDesc: "Build a solid foundation",
      conceptRemix: "Concept remix",
      conceptRemixDesc: "New scenarios. Same ideas.",
      about2Minutes: "About 2 minutes",
      smartRetry: "Smart retry loop",
      keyboardReady: "Keyboard ready",
      noAccount: "No account. No setup. Just you and the next question.",
      launchComeback: "Launch Comeback Sprint",
      comebackSprint: "Comeback Sprint",
      backToFullDeck: "← Back to full deck",
      footerLeft: "clutcharena · A little pressure. A lot of possibility.",
      footerRight: "Made for your next comeback",
      statusArena: "ARENA LIVE",
      statusIngest: "INGESTION",
      statusCoach: "COACH ACTIVE",
      statusNotes: "NOTES SYNTHESIS",
      statusSolo: "SOLO PRACTICE",
      masteryUntested: "New",
      masteryMastered: "Mastered",
      masteryNeedsReview: "Needs Review",
      masteryLearning: "In Progress",
      summaryEyebrowWon: "CLUTCH RUN COMPLETE",
      summaryEyebrowLost: "EVERY REP COUNTS",
      summaryTitleWon: "You came. You clutched.",
      summaryTitleLost: "Your comeback starts here.",
      summarySubtitleWon: "A little less panic. A lot more prepared.",
      summarySubtitleLost: "Three lives down, new knowledge gained. Review your takeaways and go again.",
      takeaways: "Your takeaways",
      xpEarned: "XP earned",
      exportDeck: "Export Deck & Study Sheet",
      debriefCoach: "Debrief with AI Coach",
      perfectRun: "Every concept answered correctly. Try concept variants next.",
    },
    upload: {
      title: "Document Ingestion & Generation",
      desc: "Turn slides, syllabi, notes, or test banks into active-recall study packs.",
      dropActive: "Drop your study files right here...",
      dropIdle: "Drag & drop your study files here",
      dropSubtitle: "Upload up to 10 files (PDF, DOCX, TXT · up to 25 MB total)",
      fileTypes: "PDF, DOCX, or TXT (up to 25 MB total, up to 10 files)",
      selectedFiles: "Selected Files",
      clearAll: "Clear all",
      optionsTitle: "INGESTION MODE",
      questionCount: "Number of Questions",
      mode: "Question Style",
      modeVariants: "Concept remix (variants)",
      modeExact: "Classic recall (exact verbatim)",
      docLanguage: "Explanation Language",
      langEn: "English",
      langVi: "Tiếng Việt",
      focus: "Study Focus (Optional)",
      focusPlaceholder: "e.g. Chapter 4 price elasticity, market structures, formulas...",
      generateBtn: "Generate Study Pack",
      generatePackDesc: "Creates quiz questions with Gemini AI",
      previewBtn: "Preview Only",
      previewOnlyDesc: "Fast document structure, no API key needed",
      generateMasterBtn: "Generate Unified Master Deck",
      previewMasterBtn: "Preview Document Structures",
      processing: "Reading and parsing documents...",
      generating: "Generating verified questions with AI...",
      successGenerated: "Successfully generated study pack!",
      playNow: "Play This Pack Now",
      docSelectedSingle: "document selected",
      docSelectedPlural: "documents selected",
      addMoreFiles: "Click or drag to add more files",
      maxFilesAttached: "Maximum 10 files attached",
      attachedFiles: "Attached Files",
      unifiedMasterDeck: "Unified Master Deck",
      unifiedDesc: "Content across all documents will be synthesized into 1 study pack with citation tags to each file.",
      qCount5: "5 questions (Quick sprint)",
      qCount10: "10 questions (Recommended)",
      qCount15: "15 questions",
      qCount20: "20 questions (Deep test)",
      qCount30: "30 questions (Comprehensive)",
      cancel: "Cancel",
      studyPackReady: "Study Pack Ready",
      playSoloRun: "Play Solo Run",
      hostInArena: "Host in Arena",
      apiTip: "Tip: Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local and restart the dev server, or switch to Preview Only mode above.",
    },
    coach: {
      title: "AI Study Coach",
      subtitle: "Grounded strictly in your uploaded materials with verbatim citations.",
      placeholder: "Ask a question about the document...",
      send: "Send",
      stop: "Stop",
      clearChat: "Clear chat",
      noDocument: "No Document Uploaded",
      noDocDesc: "Upload your syllabus, PDF slides, or lecture notes first so the coach can reference them.",
      uploadPrompt: "Go to Upload Notes",
      welcomeMsg: "Hello! I am your AI Study Coach. Ask me any question about your uploaded materials, and I will explain the concept and cite the exact source.",
      sourceGrounding: "Source Grounding",
      groundedIn: "Grounded exclusively in",
      citationProof: "Exact quote from document",
      suggest1: "What are the most essential rules and definitions in this document?",
      suggest2: "What concepts in this material are most likely to appear as exam traps?",
      suggest3: "Give me a concise 3-bullet summary of the core concepts.",
      askCoachNow: "Ask Coach Now",
      askAnythingAbout: "Ask anything about",
      everyAnswer: "Every answer strictly cites verified page and line references. Click any citation pill to inspect the source text.",
      suggestedQuestions: "SUGGESTED QUESTIONS",
    },
    library: {
      title: "Study Library",
      subtitle: "All your generated and imported quiz decks saved locally.",
      emptyTitle: "No study decks yet",
      emptyDesc: "Upload your lecture notes or paste a shared pack token to get started.",
      playBtn: "Play Deck",
      shareBtn: "Share",
      deleteBtn: "Delete",
      questionsCount: "questions",
      close: "Close",
    },
    help: {
      title: "How to Play Clutch Arena",
      subtitle: "Master your exams in high-pressure active recall sessions.",
      rule1Title: "10-Second Clock",
      rule1Desc: "Each question has a 10-second timer. Answering quickly preserves your multiplier and maximises your clutch score.",
      rule2Title: "Concept Twins",
      rule2Desc: "Questions test identical underlying principles with different numbers and scenarios so you truly understand the concepts.",
      rule3Title: "Zero Hallucination Grounding",
      rule3Desc: "Every question and explanation is linked directly to verbatim citations in your lecture notes.",
      gotIt: "Got it, let's study!",
    },
    arena: {
      badge: "REAL-TIME STUDY ARENA",
      heroTitle: "Compete live. Master together.",
      heroDesc: "Challenge friends, classmates, or practice bots in synchronized active-recall rounds with live rankings and instant explanations.",
      avatarLabel: "YOUR ARENA AVATAR",
      nicknameLabel: "NICKNAME",
      nicknamePlaceholder: "Your student handle",
      createTab: "Create Arena",
      joinTab: "Join with Code",
      selectPack: "SELECT STUDY PACK",
      currentPack: "Your current pack",
      samplePack: "Sample pack",
      userLibrary: "User Library",
      practiceMode: "PRACTICE MODE",
      classicRecall: "Classic recall",
      classicRecallDesc: "Preserve original question wording",
      conceptRemix: "Concept remix",
      conceptRemixDesc: "New scenarios & alternate perspectives",
      launchBtn: "Launch Arena Room",
      creatingBtn: "Creating Arena…",
      roomCodeLabel: "ROOM CODE",
      joinBtn: "Join",
      openLobbies: "OPEN LOBBIES",
      noOpenLobbies: "No public rooms waiting right now. Create a room above to invite friends!",
      serverVerified: "Server-verified scoring",
      botsSupported: "Practice bots supported",
      liveSync: "Real-time live sync",
    },
  },
  vi: {
    brand: {
      tagline: "TẬN DỤNG TỪNG PHÚT GIÂY",
      space: "Không gian học tập",
      subspace: "Thêm một câu. Tiến một bước.",
    },
    nav: {
      workspace: "KHÔNG GIAN LÀM VIỆC",
      clutchRun: "Luyện thi tốc độ",
      uploadNotes: "Tải tài liệu lên",
      aiCoach: "Gia sư AI",
      library: "Thư viện đề ôn",
      myProgress: "Tiến độ học tập",
      howToPlay: "Cách chơi",
      multiplayer: "ĐỐI KHÁNG TRỰC TIẾP",
      studyArena: "Đấu trường Arena",
      live: "Trực tiếp",
      clutchNotes: "Clutch Notes AI",
    },
    sidebar: {
      smallSessions: "Học tập ngắn gọn.",
      bigComebacks: "Bứt phá ngoạn mục.",
      focusQuote: "Bạn không cần thêm thời gian. Bạn chỉ cần thêm một chút tập trung.",
      youGotThis: "Bạn làm được mà!",
      localPractice: "Phiên ôn tập cá nhân",
    },
    topbar: {
      workspace: "Không gian làm việc",
      play: "Luyện thi",
      ingest: "Tài liệu",
      coach: "Gia sư AI",
      arena: "Đấu trường",
      docViewer: "Xem tài liệu",
      soundOn: "Bật âm thanh",
      muteSound: "Tắt âm thanh",
      howToPlay: "Hướng dẫn",
      langSwitch: "Ngôn ngữ",
    },
    headings: {
      clutchRunReady: "Bớt lo lắng. Tăng thực hành.",
      clutchRunFinished: "Củng cố kiến thức vững chắc.",
      clutchRunInRun: "Tập trung cao độ. Giữ vững phong độ.",
      uploadTitle: "Tải lên & Xử lý tài liệu",
      coachTitle: "Gia sư AI bám sát tài liệu",
      arenaTitle: "Đấu trường học tập — Nhiều người chơi",
      notesTitle: "Tóm tắt Slide Bài giảng AI",
      eyebrow: "CƠ HỘI BỨT PHÁ BẮT ĐẦU TẠI ĐÂY",
      arenaDesc: "Thi đấu trắc nghiệm trực tiếp, đồng bộ thời gian thực cùng bạn học hoặc bot luyện tập.",
      ingestDesc: "Kéo thả giáo trình, bài giảng slide hoặc sách để tạo ngay bộ câu hỏi chủ động chất lượng cao.",
      coachDesc: "Hỏi đáp mọi thắc mắc về tài liệu đã tải lên. Trích dẫn chính xác, chống bịa đặt 100%.",
      notesDesc: "Chuyển đổi slide bài giảng thành tài liệu ôn thi song ngữ cô đọng với công thức LaTeX và xuất PDF có dấu nước.",
      playDesc: "Mô phỏng áp lực phòng thi với câu hỏi giới hạn thời gian và biến thể kiểm tra bản chất.",
    },
    run: {
      readyTitle: "Sẵn sàng bứt phá điểm số?",
      readySubtitle: "Tốc độ, chuẩn xác và thấu hiểu bản chất kiến thức.",
      changeDeck: "Đổi bộ đề",
      startRun: "Bắt đầu làm bài",
      switchDeck: "Chuyển đề",
      quickSwitch: "Đề khác trong thư viện:",
      activeRecallTag: "Ghi nhớ chủ động",
      timerTag: "Đếm ngược 10s",
      conceptTwinTag: "Biến thể sinh đôi",
      pause: "Tạm dừng",
      resume: "Tiếp tục",
      quit: "Dừng bài thi",
      questionNum: "Câu hỏi",
      of: "trên",
      streak: "CHUỖI ĐÚNG",
      score: "ĐIỂM SỐ",
      multiplier: "HỆ SỐ THƯỞNG",
      timeRemaining: "Thời gian còn lại",
      hurry: "Nhanh lên!",
      chooseHint: "Nhấn phím 1–4 trên bàn phím hoặc nhấp chuột để chọn",
      correct: "Chính xác!",
      wrong: "Chưa đúng",
      timeout: "Hết giờ!",
      explanation: "GIẢI THÍCH CHI TIẾT",
      citation: "TRÍCH DẪN NGUỒN",
      rule: "CÔNG THỨC / NGUYÊN LÝ",
      askCoach: "Hỏi gia sư AI",
      viewInDoc: "Xem trong tài liệu",
      nextQuestion: "Câu tiếp theo",
      finishRun: "Xem kết quả",
      runComplete: "Hoàn thành bài thi!",
      totalScore: "Tổng điểm",
      accuracy: "Độ chính xác",
      maxStreak: "Chuỗi đúng dài nhất",
      masteryDelta: "Tiến bộ đạt được",
      playAgain: "Làm lại bài này",
      weakSpotSprint: "Luyện các câu chưa vững",
      flashcards: "Ôn dạng Flashcard",
      backToStart: "Về màn hình chính",
      noDeckInLibrary: "Tải tài liệu lên để bổ sung thêm các bộ đề vào thư viện.",
      deckConcepts: "KHÁI NIỆM TRONG BỘ ĐỀ",
      keyConcepts: "Khái niệm cốt lõi",
      livesCount: "3 Mạng",
      timerCount: "Đếm ngược 15s",
      streakBonus: "Thưởng chuỗi đúng",
      howToPlay: "Cách chơi",
      soloPractice: "Luyện tập cá nhân",
      soloPracticeSubtitle: "5 khái niệm trọng tâm. Một lượt luyện tập tập trung.",
      readyToPlay: "Sẵn sàng làm bài",
      moreInLibrary: "+ Thêm trong Thư viện...",
      howPractice: "BẠN MUỐN LUYỆN TẬP NHƯ THẾ NÀO?",
      classicRecall: "Ôn tập kinh điển",
      classicRecallDesc: "Xây dựng nền tảng vững chắc",
      conceptRemix: "Biến thể câu hỏi (Remix)",
      conceptRemixDesc: "Kịch bản mới. Cùng bản chất.",
      about2Minutes: "Khoảng 2 phút",
      smartRetry: "Vòng lặp ôn tập thông minh",
      keyboardReady: "Hỗ trợ phím tắt",
      noAccount: "Không cần tài khoản. Không cần cài đặt. Chỉ bạn và câu hỏi tiếp theo.",
      launchComeback: "Luyện tập bứt phá",
      comebackSprint: "Lượt bứt phá",
      backToFullDeck: "← Quay lại bộ đề đầy đủ",
      footerLeft: "clutcharena · Một chút áp lực. Vô vàn bứt phá.",
      footerRight: "Thiết kế cho cú bứt phá tiếp theo của bạn",
      statusArena: "ĐẤU TRƯỜNG TRỰC TIẾP",
      statusIngest: "NẠP TÀI LIỆU",
      statusCoach: "GIA SƯ ĐANG HOẠT ĐỘNG",
      statusNotes: "TỔNG HỢP SLIDE PRO",
      statusSolo: "LUYỆN TẬP CÁ NHÂN",
      masteryUntested: "Mới",
      masteryMastered: "Thành thạo",
      masteryNeedsReview: "Cần ôn lại",
      masteryLearning: "Đang học",
      summaryEyebrowWon: "HOÀN THÀNH BÀI THI",
      summaryEyebrowLost: "TỪNG CÂU ĐỀU ĐÁNG GIÁ",
      summaryTitleWon: "Bạn đã bứt phá thành công!",
      summaryTitleLost: "Cú bứt phá bắt đầu từ đây.",
      summarySubtitleWon: "Bớt đi âu lo. Vững vàng kiến thức.",
      summarySubtitleLost: "Hết 3 mạng, nhưng đã thu nạp kiến thức mới. Hãy xem lại và thử lại nhé.",
      takeaways: "Kiến thức cần ghi nhớ",
      xpEarned: "XP đạt được",
      exportDeck: "Xuất bộ đề & Bảng ôn tập",
      debriefCoach: "Tổng kết cùng Gia sư AI",
      perfectRun: "Chính xác tuyệt đối mọi câu! Tiếp theo hãy thử các biến thể câu hỏi nhé.",
    },
    upload: {
      title: "Nạp tài liệu & Tạo câu hỏi",
      desc: "Biến slide bài giảng, giáo trình, ghi chú hoặc ngân hàng đề thành bộ thẻ ôn tập chủ động.",
      dropActive: "Thả tài liệu của bạn vào đây ngay...",
      dropIdle: "Kéo & thả tài liệu học tập của bạn vào đây",
      dropSubtitle: "Tải lên tối đa 10 tệp (PDF, DOCX, TXT · tối đa 25 MB)",
      fileTypes: "Hỗ trợ PDF, DOCX hoặc TXT (tối đa 25 MB tổng cộng, tối đa 10 tệp)",
      selectedFiles: "Tệp đã chọn",
      clearAll: "Xóa tất cả",
      optionsTitle: "CHẾ ĐỘ TẠO ĐỀ",
      questionCount: "Số lượng câu hỏi",
      mode: "Phong cách câu hỏi",
      modeVariants: "Biến thể câu hỏi (Remix)",
      modeExact: "Ôn tập kinh điển (Nguyên văn)",
      docLanguage: "Ngôn ngữ giải thích",
      langEn: "Tiếng Anh (English)",
      langVi: "Tiếng Việt",
      focus: "Trọng tâm ôn tập (Tùy chọn)",
      focusPlaceholder: "Ví dụ: Chương 4 độ co giãn của giá, cấu trúc thị trường, công thức...",
      generateBtn: "Tạo bộ đề học tập",
      generatePackDesc: "Tạo câu hỏi trắc nghiệm bằng Gemini AI",
      previewBtn: "Chỉ xem trước cấu trúc",
      previewOnlyDesc: "Xem nhanh cấu trúc tài liệu, không cần API key",
      generateMasterBtn: "Tạo bộ đề tổng hợp",
      previewMasterBtn: "Xem cấu trúc các tài liệu",
      processing: "Đang đọc và phân tích văn bản tài liệu...",
      generating: "AI đang tạo câu hỏi và đối chiếu trích dẫn...",
      successGenerated: "Đã tạo bộ câu hỏi thành công!",
      playNow: "Làm bài thi ngay",
      docSelectedSingle: "tài liệu đã chọn",
      docSelectedPlural: "tài liệu đã chọn",
      addMoreFiles: "Nhấp hoặc kéo thả để thêm tệp",
      maxFilesAttached: "Đã đính kèm tối đa 10 tệp",
      attachedFiles: "Tệp đính kèm",
      unifiedMasterDeck: "Bộ đề tổng hợp chung",
      unifiedDesc: "Nội dung từ tất cả các tệp sẽ được tổng hợp thành 1 bộ đề với trích dẫn cho từng tệp.",
      qCount5: "5 câu hỏi (Luyện nhanh)",
      qCount10: "10 câu hỏi (Khuyên dùng)",
      qCount15: "15 câu hỏi",
      qCount20: "20 câu hỏi (Kiểm tra sâu)",
      qCount30: "30 câu hỏi (Toàn diện)",
      cancel: "Hủy",
      studyPackReady: "Bộ đề đã sẵn sàng",
      playSoloRun: "Luyện tập cá nhân",
      hostInArena: "Tổ chức đấu trường",
      apiTip: "Mẹo: Thêm GOOGLE_GENERATIVE_AI_API_KEY vào .env.local và khởi động lại server, hoặc chuyển sang chế độ Chỉ xem trước ở trên.",
    },
    coach: {
      title: "Gia sư AI học tập",
      subtitle: "Bám sát tuyệt đối nội dung tài liệu đã tải lên với trích dẫn nguyên văn.",
      placeholder: "Đặt câu hỏi về tài liệu...",
      send: "Gửi",
      stop: "Dừng",
      clearChat: "Xóa đoạn chat",
      noDocument: "Chưa có tài liệu nào được tải lên",
      noDocDesc: "Hãy tải bài giảng slide, PDF hoặc tài liệu ôn thi lên trước để gia sư AI hỗ trợ bạn.",
      uploadPrompt: "Đến trang Tải tài liệu",
      welcomeMsg: "Xin chào! Mình là Gia sư AI của bạn. Hãy hỏi bất kỳ câu hỏi nào về tài liệu đã tải lên, mình sẽ giải thích bản chất kèm trích dẫn trang tài liệu cụ thể.",
      sourceGrounding: "Căn cứ tài liệu",
      groundedIn: "Căn cứ trực tiếp trên",
      citationProof: "Trích dẫn nguyên văn từ tài liệu",
      suggest1: "Những quy tắc và định nghĩa cốt lõi nhất là gì?",
      suggest2: "Những khái niệm nào dễ trở thành 'bẫy' trong bài thi nhất?",
      suggest3: "Tóm tắt ngắn gọn 3 gạch đầu dòng về các khái niệm cốt lõi",
      askCoachNow: "Hỏi gia sư ngay",
      askAnythingAbout: "Hỏi bất cứ điều gì về",
      everyAnswer: "Mọi câu trả lời đều trích dẫn chính xác số trang và dòng kiểm chứng. Nhấp vào trích dẫn để xem tài liệu gốc.",
      suggestedQuestions: "CÂU HỎI GỢI Ý",
    },
    library: {
      title: "Thư viện bộ đề",
      subtitle: "Tất cả các bộ thẻ và đề thi đã tạo hoặc nhập vào máy.",
      emptyTitle: "Chưa có bộ đề nào",
      emptyDesc: "Tải tài liệu lên hoặc dán mã chia sẻ để lưu bộ đề vào thư viện.",
      playBtn: "Luyện thi",
      shareBtn: "Chia sẻ",
      deleteBtn: "Xóa",
      questionsCount: "câu hỏi",
      close: "Đóng",
    },
    help: {
      title: "Hướng dẫn chơi Clutch Arena",
      subtitle: "Bứt phá điểm thi qua các buổi luyện tập phản xạ chủ động.",
      rule1Title: "Đồng hồ 10 giây",
      rule1Desc: "Mỗi câu hỏi có đồng hồ đếm ngược 10 giây. Trả lời nhanh sẽ giữ chuỗi nhân đôi điểm số.",
      rule2Title: "Biến thể sinh đôi (Concept Twins)",
      rule2Desc: "Câu hỏi kiểm tra cùng một nguyên lý cốt lõi nhưng đổi số liệu hoặc đảo ngược tình huống để kiểm tra bạn có thực sự hiểu bài hay không.",
      rule3Title: "Trích dẫn chính xác chống bịa đặt",
      rule3Desc: "Mọi câu hỏi và giải thích đều được gắn trực tiếp với trích dẫn nguyên văn trong tài liệu của bạn.",
      gotIt: "Đã hiểu, bắt đầu ôn thi!",
    },
    arena: {
      badge: "ĐẤU TRƯỜNG TRỰC TIẾP",
      heroTitle: "Thi đấu trực tiếp. Cùng nhau bứt phá.",
      heroDesc: "Thử thách bạn bè, bạn cùng lớp hoặc bot luyện tập trong các vòng đấu phản xạ đồng bộ với bảng xếp hạng trực tiếp và giải thích tức thì.",
      avatarLabel: "AVATAR ĐẤU TRƯỜNG CỦA BẠN",
      nicknameLabel: "BIỆT DANH",
      nicknamePlaceholder: "Tên hiển thị của bạn",
      createTab: "Tạo phòng đấu",
      joinTab: "Tham gia bằng mã",
      selectPack: "CHỌN BỘ ĐỀ HỌC TẬP",
      currentPack: "Bộ đề hiện tại của bạn",
      samplePack: "Bộ đề mẫu",
      userLibrary: "Thư viện người dùng",
      practiceMode: "CHẾ ĐỘ LUYỆN TẬP",
      classicRecall: "Ôn tập kinh điển",
      classicRecallDesc: "Giữ nguyên câu chữ gốc",
      conceptRemix: "Biến thể câu hỏi (Remix)",
      conceptRemixDesc: "Kịch bản mới & góc nhìn mở rộng",
      launchBtn: "Vào phòng đấu",
      creatingBtn: "Đang tạo phòng…",
      roomCodeLabel: "MÃ PHÒNG",
      joinBtn: "Vào phòng",
      openLobbies: "PHÒNG ĐANG MỞ",
      noOpenLobbies: "Hiện chưa có phòng công khai nào. Hãy tạo phòng ở trên để mời bạn bè!",
      serverVerified: "Chấm điểm máy chủ xác thực",
      botsSupported: "Hỗ trợ bot luyện tập",
      liveSync: "Đồng bộ hóa thời gian thực",
    },
  },
};
