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
    clutchNotes: string;
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
    notes: string;
    hideDocViewer: string;
    showDocViewer: string;
    toggleDocViewer: string;
    viewPricing: string;
    cramPassBtn: string;
    sendFeedback: string;
    switchToEn: string;
    switchToVi: string;
    selectLangAria: string;
  };
  headings: {
    clutchRunReady: string;
    clutchRunFinished: string;
    clutchRunInRun: string;
    uploadTitle: string;
    coachTitle: string;
    arenaTitle: string;
    notesTitle: string;
    eyebrow: string;
    arenaDesc: string;
    ingestDesc: string;
    coachDesc: string;
    notesDesc: string;
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
    statusNotes: string;
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
    welcomeTitle: string;
    welcomeDesc: string;
    gettingStartedTag: string;
    welcomeTutorialTitle: string;
    welcomeTutorialDesc: string;
    welcomeNotesTitle: string;
    welcomeNotesDesc: string;
    welcomeUploadTitle: string;
    welcomeUploadDesc: string;
    welcomeSampleTitle: string;
    welcomeSampleDesc: string;
    sessionLength: string;
    contenderMax10Q: string;
    questionsUnit: string;
    comebackSprintReady: string;
    weakSpotSingle: string;
    weakSpotPlural: string;
    weakSpotTargetPrefix: string;
    weakSpotMore: string;
    weakSpotTargetSuffix: string;
    leaveRun: string;
    keyboardAnswerHint: string;
    keyboardContinueHint: string;
    orWord: string;
    yourSession: string;
    oneConceptAtATime: string;
    practiceConceptFallback: string;
    reinforcing: string;
    correctCountWord: string;
    lookingGood: string;
    perQuestion15s: string;
    takeABreather: string;
    progressTitle: string;
    progressDesc: string;
    runsCompleted: string;
    totalXp: string;
    bestStreakLabel: string;
    masteredLabel: string;
    runsHistoryTab: string;
    conceptMasteryTab: string;
    practiceRunItemTitle: string;
    historyEmptyTitle: string;
    historyEmptyDesc: string;
    inARow: string;
    masteryEmptyTitle: string;
    masteryEmptyDesc: string;
    backToPractice: string;
    leaveDialogTitle: string;
    leaveDialogDesc: string;
    keepGoing: string;
    pauseDialogTitle: string;
    pauseDialogDesc: string;
    resumeRun: string;
    cheatSheetBtn: string;
    summaryFootnote: string;
    keepMomentum: string;
    queuedForRetry: string;
    flagCitation: string;
    questionEyebrow: string;
    masteryRoundTag: string;
    conceptVariantTag: string;
    practiceTag: string;
    livesHud: string;
    livesRemainingAria: string;
    timeToThink: string;
    clockPaused: string;
    reviewFlashcardsTooltip: string;
    switchDeckTooltip: string;
    shareExportTooltip: string;
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
    contenderBadge: string;
    paidBadgeSuffix: string;
    removeFileAria: string;
    errorPrefix: string;
    noFileSelected: string;
    tooLargeError: string;
    guestLimitError: string;
    cancelledError: string;
    genericIngestError: string;
    extractingStructure: string;
    readingAnalyzing: string;
    extractingTextBlocks: string;
    readingParsing: string;
    synthesizingTopics: string;
    formulatingQuestions: string;
    verifyingCitations: string;
    previewExtractedTitle: string;
    blocksWord: string;
    charactersWord: string;
    previewLoadedDesc: string;
    generateQuestionsNowPrefix: string;
    generateQuestionsNowSuffix: string;
    multiDocLimitReason: string;
    sampleQuestion: string;
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
    focusMissedPrefix: string;
    focusDebriefPrefix: string;
    explainAutoPrompt: string;
    debriefAutoPrompt: string;
    dismissFocus: string;
    streamingStatus: string;
    connectionError: string;
    genericCoachError: string;
    docWord: string;
    slideWord: string;
    focusDebriefCorrect: string;
    jumpToCitation: string;
    jumpToCitationViewerSuffix: string;
    jumpToCitationAria: string;
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
    savedPacksHeader: string;
    importJson: string;
    importErrorFallback: string;
    noPacksSavedTitle: string;
    noPacksSavedDesc: string;
    arenaBtn: string;
    hostInArenaTooltip: string;
    shareExportTooltip: string;
    deletePackTooltip: string;
    confirmDelete: string;
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
    hostPaysTitle: string;
    hostPaysDesc: string;
    viewTiersBtn: string;
    noPacksTitle: string;
    noPacksDesc: string;
    enterCodeError: string;
    enterNicknameError: string;
    joinFailedError: string;
    selectPackError: string;
    createFailedError: string;
    playersWord: string;
    connectingToArena: string;
    couldNotConnectTitle: string;
    roomClosedDesc: string;
    backToEntrance: string;
    exitArena: string;
    roomBadge: string;
    lobbyEyebrow: string;
    codeLabel: string;
    copiedPill: string;
    linkCopiedBtn: string;
    shareRoomLinkBtn: string;
    contendersHeader: string;
    joinedWord: string;
    addPracticeBot: string;
    botSpeed: string;
    botSteady: string;
    botWildcard: string;
    youPill: string;
    roleBot: string;
    roleHost: string;
    roleChallenger: string;
    readyTag: string;
    waitingTag: string;
    openSlotTitle: string;
    openSlotDescPrefix: string;
    openSlotDescSuffix: string;
    openTag: string;
    matchRulesEyebrow: string;
    matchRulesTitle: string;
    rule1Bold: string;
    rule1Text: string;
    rule2Bold: string;
    rule2Text: string;
    rule3Bold: string;
    rule3Text: string;
    startMatchBtn: string;
    cancelReadyBtn: string;
    imReadyBtn: string;
    hostCaption: string;
    guestCaption: string;
    matchStartingEyebrow: string;
    getReadyTitle: string;
    countdownSubtitle: string;
    roundLabel: string;
    livesLabel: string;
    answerLockedBanner: string;
    spectatorBanner: string;
    clutchCorrectPrefix: string;
    timedOutLife: string;
    missedLife: string;
    nextRoundIn4s: string;
    toSubmitHint: string;
    syncServerDeadline: string;
    liveLeaderboardEyebrow: string;
    arenaRankingsTitle: string;
    lockedInTag: string;
    thinkingTag: string;
    missTag: string;
    matchConcludedEyebrow: string;
    claimsVictorySuffix: string;
    matchCompleteTitle: string;
    podiumSubtitle: string;
    finalScoreboard: string;
    classAnalyticsTitle: string;
    classAnalyticsSubtitle: string;
    exportGradebookBtn: string;
    earlyEliminationPrefix: string;
    earlyEliminationSuffix: string;
    classAvgAccuracy: string;
    totalPlayersKpi: string;
    totalQuestionsKpi: string;
    missedDiagnosticHeader: string;
    needsReteachBadge: string;
    topTrapPrefix: string;
    missedWord: string;
    hostRematchBtn: string;
    waitingForRematch: string;
    hideAnalyticsBtn: string;
    viewAnalyticsBtn: string;
    scoreboardCopiedBtn: string;
    shareResultsBtn: string;
    debriefWithCoachBtn: string;
    leaveArenaBtn: string;
    backToSoloLink: string;
    brandAlt: string;
    headerSubtitle: string;
    loadingArena: string;
    hostPrivilegesNotice: string;
    passSuffix: string;
    proBadge: string;
    roomCodePlaceholder: string;
    clickToCopyCode: string;
    questionsUnit: string;
    botSpeedTitle: string;
    botSteadyTitle: string;
    botWildcardTitle: string;
    removeBotTitle: string;
    scoreLabel: string;
    streakLabel: string;
    questionNum: string;
    of: string;
    orWord: string;
    bestStreakLabel: string;
    livesRemaining: string;
  };
  flashcard: {
    eyebrow: string;
    conceptRemixSuffix: string;
    shuffle: string;
    exit: string;
    cardsReviewedAria: string;
    gotItCount: string;
    stillLearningCount: string;
    summaryAllKnown: string;
    summarySomeLearning: string;
    startClutchRun: string;
    reviewStillLearningPrefix: string;
    reviewStillLearningSuffix: string;
    restartAll: string;
    cardWord: string;
    ofWord: string;
    questionSide: string;
    answerSide: string;
    flipHint: string;
    showQuestionAria: string;
    revealAnswerAria: string;
    prevCardAria: string;
    nextCardAria: string;
    stillLearningBtn: string;
    gotItBtn: string;
    revealAnswerBtn: string;
  };
  docViewer: {
    emptyTitle: string;
    emptyDesc: string;
    uploadDocBtn: string;
    pagesWord: string;
    sectionsWord: string;
    searchPlaceholder: string;
    searchAria: string;
    clearSearchAria: string;
    noMatchesPrefix: string;
    clearFilter: string;
    askCoachBtn: string;
    askCoachTooltip: string;
    copyTextTooltip: string;
    showLess: string;
    readMore: string;
    viewerAria: string;
    sourceBlocksAria: string;
  };
  share: {
    title: string;
    conceptsSelected: string;
    exportScope: string;
    allConcepts: string;
    missedOnly: string;
    exportFormats: string;
    copiedMarkdown: string;
    copyMarkdown: string;
    printableGuideTitle: string;
    printableGuideDesc: string;
    printableGuideTooltip: string;
    markdownTitle: string;
    markdownDesc: string;
    markdownTooltip: string;
    ankiTitle: string;
    ankiDesc: string;
    ankiTooltip: string;
    quizletTitle: string;
    quizletDesc: string;
    quizletTooltip: string;
    csvTitle: string;
    csvDesc: string;
    csvTooltip: string;
    jsonTitle: string;
    jsonDesc: string;
    jsonTooltip: string;
    shareLinkLabel: string;
    shareLinkAria: string;
    buildingLink: string;
    copiedBtn: string;
    copyBtn: string;
    linkErrorBuild: string;
    clipboardBlockedLink: string;
    clipboardBlockedMd: string;
    longLinkWarningPrefix: string;
    charactersWord: string;
    longLinkWarningSuffix: string;
    shareNote: string;
    zeroCostTitle: string;
    zeroCostDesc: string;
    earnPassNote: string;
  };
  notes: {
    badge: string;
    tierBadge: string;
    dailyQuota: string;
    remaining: string;
    title: string;
    subtitle: string;
    pillNoise: string;
    pillBilingual: string;
    pillLatex: string;
    pillPdf: string;
    uploadHeader: string;
    fileLimitNote: string;
    paidTiersBadge: string;
    readyToSynthesize: string;
    dropTitle: string;
    dropDesc: string;
    lockedNotice: string;
    focusLabel: string;
    focusPlaceholder: string;
    loadSampleBtn: string;
    synthesizeBtn: string;
    showcaseEyebrow: string;
    showcaseTitle: string;
    showcaseDesc: string;
    showcaseBtn: string;
    someSlidesUnread: string;
    unreadFormulasNote: string;
    step1: string;
    step2: string;
    step3: string;
    step4: string;
    step5: string;
    step6: string;
    newDeckBtn: string;
    slidesWord: string;
    pagesWord: string;
    noiseStripped: string;
    copiedBtn: string;
    copyMarkdownBtn: string;
    exportPdfBtn: string;
    verifiedBadge: string;
    derivedBadge: string;
    derivedFromPrefix: string;
    needsReviewBadge: string;
    contradictedBadge: string;
    reviewNotePrefix: string;
    whereVariables: string;
    whereLabel: string;
    slideWord: string;
    keyTakeawaysHeading: string;
    omittedExerciseReason: string;
    omittedDuplicateReason: string;
    slideContextPrefix: string;
    divergenceBadge: string;
    lecturerForm: string;
    textbookForm: string;
    noticesTitle: string;
    noticeSingle: string;
    noticePlural: string;
    noticesFooter: string;
    uncapturedTitle: string;
    formulaOmittedSingle: string;
    formulaOmittedPlural: string;
    uncapturedDesc: string;
    reasonLabel: string;
    synthesizingDefault: string;
    errInvalidFileType: string;
    errFileTooLargePrefix: string;
    errFileTooLargeSuffix: string;
    errLocalExtractionFailedPrefix: string;
    errLocalExtractionFailedSuffix: string;
    errPayloadTooLarge: string;
    errGatewayTimeout: string;
    errSubscriptionRequired: string;
    errDailyQuotaReached: string;
    errServerGeneric: string;
    errTimeoutClient: string;
    errNetwork: string;
    errUnexpected: string;
    pricingInitialReason: string;
    modalTitle: string;
    modalDesc: string;
    modalCloseAria: string;
    modalBadgeUnlocked: string;
    modalTransformPrefix: string;
    modalTransformSlides: string;
    modalTransformInto: string;
    modalTransformSheet: string;
    modalDescFull: string;
    modalBeforeHeader: string;
    modalBeforeStats: string;
    modalNoiseLabel: string;
    modalSlide12Title: string;
    modalSlide7Title: string;
    modalSlide7Desc: string;
    modalSlide14Title: string;
    modalSlide14Desc: string;
    modalSlide27Title: string;
    modalBeforeWarning: string;
    modalAfterHeader: string;
    modalAfterStats: string;
    modalFormulaHeading: string;
    modalFormulaCondition: string;
    modalWherePriceToday: string;
    modalWhereDividend: string;
    modalWhereRequiredReturn: string;
    modalKeyTakeawaysHeading: string;
    modalTakeaway1: string;
    modalTakeaway2: string;
    modalTakeaway3Prefix: string;
    modalTakeaway3Suffix: string;
    modalAfterFooter: string;
    modalKatexPdfBadge: string;
    modalProp1Title: string;
    modalProp1Desc: string;
    modalProp2Title: string;
    modalProp2Desc: string;
    modalProp3Title: string;
    modalProp3Desc: string;
    modalProp4Title: string;
    modalProp4Desc: string;
    modalUpgradeBtn: string;
    modalDemoBtn: string;
  };
  auth: {
    myAccount: string;
    signInTitle: string;
    createAccountTitle: string;
    accountDesc: string;
    guestDesc: string;
    guestLimitTitle: string;
    guestLimitDesc: string;
    localDevMode: string;
    cloudSync: string;
    activeStatus: string;
    planTier: string;
    daysLeft: string;
    signOut: string;
    signInTab: string;
    signUpTab: string;
    continueGoogle: string;
    continueGithub: string;
    orEmail: string;
    emailLabel: string;
    passwordLabel: string;
    processing: string;
    createFreeAccountBtn: string;
    guestStudent: string;
    accountSuffix: string;
    usedWord: string;
    freeBadge: string;
    guestBadge: string;
    userIdLabel: string;
    localDevNote: string;
    tierContender: string;
    tierCramPass: string;
    tierPro: string;
    tierTutor: string;
    enterBothEmailPassword: string;
    signInError: string;
    signUpError: string;
    signUpSuccess: string;
    oauthError: string;
  };
  pricing: {
    vietQrHeader: string;
    selectedPlanLabel: string;
    bankLabel: string;
    accountNumberLabel: string;
    accountNameLabel: string;
    transferNoteLabel: string;
    checkingPaymentBtn: string;
    verifyPaymentBtn: string;
    openPayosPortal: string;
    securityNote: string;
    copyAccountTitle: string;
    copyNoteTitle: string;
    globalCardsLabel: string;
    globalSecurityNote: string;
    backToPlans: string;
    autoVerifiedIn3s: string;
    payosLinkedBank: string;
  };
  tutorial: {
    quickTourBadge: string;
    stepWord: string;
    ofWord: string;
    skipBtn: string;
    backBtn: string;
    nextBtn: string;
    closeExploreBtn: string;
    playSampleBtn: string;
    uploadOwnBtn: string;
    closeAria: string;
    goToStepAria: string;
    andWord: string;
    // Step 0
    step0Title: string;
    step0Desc: string;
    step0Feature1Title: string;
    step0Feature1Desc: string;
    step0Feature2Title: string;
    step0Feature2Desc: string;
    step0Feature3Title: string;
    step0Feature3Desc: string;
    // Step 1
    step1Title: string;
    step1Desc: string;
    step1SampleFile: string;
    step1FormatsPrefix: string;
    step1FormatsSuffix: string;
    step1SupportedFormats: string;
    step1Bullet1: string;
    step1Bullet2: string;
    step1Bullet3: string;
    // Step 2
    step2Title: string;
    step2Desc: string;
    step2DescPrefix: string;
    step2DescHighlight: string;
    step2DescSuffix: string;
    step2SampleBadge: string;
    step2SampleClock: string;
    step2SampleQuestion: string;
    step2SampleOptionA: string;
    step2SampleOptionB: string;
    step2SampleCitation: string;
    step2Footer: string;
    // Step 3
    step3Title: string;
    step3Desc: string;
    step3Topic1: string;
    step3Mastery1: string;
    step3Topic2: string;
    step3Mastery2: string;
    step3Footer: string;
    step3FooterPrefix: string;
    step3FooterHighlight: string;
    step3FooterSuffix: string;
    // Step 4
    step4Title: string;
    step4Desc: string;
    step4RoomLabel: string;
    step4LiveBadge: string;
    step4User1: string;
    step4Points1: string;
    step4User2: string;
    step4Points2: string;
    step4User3: string;
    step4Points3: string;
    step4SpeedPointsTitle: string;
    step4SpeedPointsDesc: string;
    step4AdaptiveBotsTitle: string;
    step4AdaptiveBotsDesc: string;
    // Step 5
    step5Title: string;
    step5Desc: string;
    step5DescPrefix: string;
    step5DescHighlight: string;
    step5DescSuffix: string;
  };
  common: {
    errorTitle: string;
    errorDesc: string;
    errorFallback: string;
    tryAgain: string;
    tryAgainBtn: string;
    loadingText: string;
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
      notes: "Notes",
      hideDocViewer: "Hide Document Viewer",
      showDocViewer: "Show Document Viewer",
      toggleDocViewer: "Toggle Document Viewer",
      viewPricing: "View student passes and pricing",
      cramPassBtn: "Cram Pass",
      sendFeedback: "Send Feedback",
      switchToEn: "Switch to English",
      switchToVi: "Switch to Vietnamese",
      selectLangAria: "Select website language",
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
      statusArena: "Arena live",
      statusIngest: "Ingestion",
      statusCoach: "Coach active",
      statusSolo: "Solo practice",
      statusNotes: "Notes synthesis",
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
      welcomeTitle: "Welcome to Clutch Arena",
      welcomeDesc: "No study deck loaded yet. Take the quick tour to see how it works, upload your course notes, or try our example deck.",
      gettingStartedTag: "Getting Started",
      welcomeTutorialTitle: "Interactive Tutorial",
      welcomeTutorialDesc: "Take a 1-minute guided tour of active recall and live arenas.",
      welcomeNotesTitle: "Clutch Notes AI",
      welcomeNotesDesc: "Turn 27-slide lecture decks into 3-page bilingual revision notes with LaTeX & PDF export.",
      welcomeUploadTitle: "Upload Study Notes",
      welcomeUploadDesc: "Drop your lecture PDFs, DOCX, or PPTX to generate study questions.",
      welcomeSampleTitle: "Load Example Deck",
      welcomeSampleDesc: "Try 15 questions from Microeconomics Ch 1–5 with citations.",
      sessionLength: "Session Length",
      contenderMax10Q: "Contender (Max 10Q)",
      questionsUnit: "Questions",
      comebackSprintReady: "Comeback Sprint Ready",
      weakSpotSingle: "weak spot",
      weakSpotPlural: "weak spots",
      weakSpotTargetPrefix: "Target",
      weakSpotMore: "more",
      weakSpotTargetSuffix: "in a rapid 5-question sprint.",
      leaveRun: "Leave run",
      keyboardAnswerHint: "to answer",
      keyboardContinueHint: "to continue",
      orWord: "or",
      yourSession: "YOUR SESSION",
      oneConceptAtATime: "One concept at a time.",
      practiceConceptFallback: "Practice concept",
      reinforcing: "Reinforcing",
      correctCountWord: "correct",
      lookingGood: "Looking good",
      perQuestion15s: "15s / question",
      takeABreather: "Take a breather",
      progressTitle: "Every session adds up.",
      progressDesc: "Completed runs saved in this browser, on this device.",
      runsCompleted: "Runs completed",
      totalXp: "Total XP",
      bestStreakLabel: "Best streak",
      masteredLabel: "Mastered",
      runsHistoryTab: "Runs History",
      conceptMasteryTab: "Concept Mastery",
      practiceRunItemTitle: "Practice session",
      historyEmptyTitle: "Your first win is waiting.",
      historyEmptyDesc: "Complete a run to start your progress story.",
      inARow: "in a row",
      masteryEmptyTitle: "No concept data yet.",
      masteryEmptyDesc: "Complete practice questions to build your topic mastery profile.",
      backToPractice: "Back to practice",
      leaveDialogTitle: "Call it a practice round?",
      leaveDialogDesc: "Your clock is paused. Leaving discards this unfinished run; completed runs stay saved.",
      keepGoing: "Keep going",
      pauseDialogTitle: "Breathe. You’ve got time.",
      pauseDialogDesc: "Your timer is paused. Take a moment and come back when you’re ready.",
      resumeRun: "Resume run",
      cheatSheetBtn: "1-Click PDF Cheat Sheet",
      summaryFootnote: "This run is saved on this device when browser storage is available.",
      keepMomentum: "Keep that momentum.",
      queuedForRetry: "Queued for a fresh attempt.",
      flagCitation: "Flag citation",
      questionEyebrow: "QUESTION",
      masteryRoundTag: "Mastery round",
      conceptVariantTag: "Concept variant",
      practiceTag: "Practice",
      livesHud: "LIVES",
      livesRemainingAria: "lives remaining",
      timeToThink: "Time to think",
      clockPaused: "Clock paused",
      reviewFlashcardsTooltip: "Review cards before the timed run",
      switchDeckTooltip: "Switch or import a different study deck",
      shareExportTooltip: "Share & export pack",
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
      contenderBadge: "Contender: 2 uploads/wk (1 file)",
      paidBadgeSuffix: "Unlimited (10 files)",
      removeFileAria: "Remove file",
      errorPrefix: "Error",
      noFileSelected: "Please select at least one file to upload.",
      tooLargeError: "Combined files exceed 25 MB limit. Please select fewer or smaller files.",
      guestLimitError: "Free guest limit reached (2/2). Please sign in or create an account to generate custom study packs.",
      cancelledError: "Upload was cancelled.",
      genericIngestError: "Something went wrong while processing the document.",
      extractingStructure: "Extracting structure across",
      readingAnalyzing: "Reading and analyzing",
      extractingTextBlocks: "Extracting text blocks across",
      readingParsing: "Reading & parsing",
      synthesizingTopics: "Synthesizing key topics & learning objectives",
      formulatingQuestions: "Formulating active-recall questions & variants",
      verifyingCitations: "Verifying source citations and finalizing study pack",
      previewExtractedTitle: "Preview Extracted",
      blocksWord: "blocks",
      charactersWord: "characters",
      previewLoadedDesc: "The document is now loaded in the Document Viewer on the left. Ready to generate questions from it?",
      generateQuestionsNowPrefix: "Generate",
      generateQuestionsNowSuffix: "Questions Now",
      multiDocLimitReason: "Multi-document synthesis (up to 10 files / 25MB) requires a 7-Day Cram Pass or Clutch Pro. Free Contender includes 1 file per upload.",
      sampleQuestion: "Sample Question",
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
      focusMissedPrefix: "Focus: Missed question",
      focusDebriefPrefix: "Focus: Post-run debrief",
      explainAutoPrompt: "Why is the correct answer right, and what was the main trap in this question?",
      debriefAutoPrompt: "Can you debrief my run, identify my biggest conceptual weaknesses, and give me a 3-step review plan?",
      dismissFocus: "Dismiss focus",
      streamingStatus: "Coach is analyzing source material...",
      connectionError: "AI Coach encountered an issue connecting to the model. Please verify your GEMINI_API_KEY or GROQ_API_KEY and try again.",
      genericCoachError: "Failed to get coach response. Check API configuration or try again.",
      docWord: "Doc",
      slideWord: "Slide",
      focusDebriefCorrect: "correct",
      jumpToCitation: "Jump to",
      jumpToCitationViewerSuffix: "in Document Viewer",
      jumpToCitationAria: "Jump to citation",
    },
    library: {
      title: "Study Library",
      subtitle: "All your generated and imported quiz decks saved locally.",
      emptyTitle: "No study decks yet",
      emptyDesc: "Upload your lecture notes or paste a shared pack token to get started.",
      playBtn: "Play",
      shareBtn: "Share",
      deleteBtn: "Delete",
      questionsCount: "questions",
      close: "Close",
      savedPacksHeader: "SAVED STUDY PACKS",
      importJson: "Import JSON",
      importErrorFallback: "Failed to import pack file.",
      noPacksSavedTitle: "No uploaded packs saved yet.",
      noPacksSavedDesc: "Upload your slides, PDFs, or notes in the Ingest tab to generate custom study packs that stay saved here.",
      arenaBtn: "Arena",
      hostInArenaTooltip: "Host in Arena",
      shareExportTooltip: "Share & Export",
      deletePackTooltip: "Delete saved pack",
      confirmDelete: "Are you sure you want to delete this study pack? This cannot be undone.",
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
      hostPaysTitle: "⚡ Host-Pays, Friends-Play-Free:",
      hostPaysDesc: "Anyone can join friend lobbies for 100% free ($0 AI cost). Only room host needs a Cram Pass or Pro to launch custom 30Q remix packs.",
      viewTiersBtn: "View Tiers & Passes",
      noPacksTitle: "No Study Packs Found",
      noPacksDesc: "Upload lecture notes in the Ingest tab to generate a custom study pack to host here.",
      enterCodeError: "Please enter a room code.",
      enterNicknameError: "Please enter a nickname.",
      joinFailedError: "Could not join room. Check code or room may have already started.",
      selectPackError: "Please select or upload a study pack before creating an arena room.",
      createFailedError: "Could not create arena room. Please try again.",
      playersWord: "player(s)",
      connectingToArena: "Connecting to Arena",
      couldNotConnectTitle: "Could not connect to Arena",
      roomClosedDesc: "Room may have closed or expired.",
      backToEntrance: "Back to Arena Entrance",
      exitArena: "Exit Arena",
      roomBadge: "ROOM",
      lobbyEyebrow: "MULTIPLAYER STUDY ARENA LOBBY",
      codeLabel: "CODE:",
      copiedPill: "Copied!",
      linkCopiedBtn: "Link Copied!",
      shareRoomLinkBtn: "Share Room Link",
      contendersHeader: "Contenders in the Arena",
      joinedWord: "joined",
      addPracticeBot: "Add Practice Bot",
      botSpeed: "⚡ Speed",
      botSteady: "🦉 Steady",
      botWildcard: "🔥 Wildcard",
      youPill: "YOU",
      roleBot: "AI Practice Bot",
      roleHost: "Arena Host",
      roleChallenger: "Challenger",
      readyTag: "Ready",
      waitingTag: "Waiting",
      openSlotTitle: "Open Contender Slot",
      openSlotDescPrefix: "Share room code",
      openSlotDescSuffix: "or add a bot above",
      openTag: "Open",
      matchRulesEyebrow: "MATCH RULES",
      matchRulesTitle: "Fast recall under pressure.",
      rule1Bold: "15 seconds per question",
      rule1Text: "Everyone answers at the same time.",
      rule2Bold: "Streak Multipliers",
      rule2Text: "3 in a row unlocks 1.5×, 5 unlocks 2× XP.",
      rule3Bold: "3 Hearts",
      rule3Text: "A wrong answer or timeout costs 1 heart. Last survivors take the podium!",
      startMatchBtn: "Start Arena Match",
      cancelReadyBtn: "Cancel Ready",
      imReadyBtn: "I’m Ready!",
      hostCaption: "Once started, all players transition into the synchronized countdown.",
      guestCaption: "Waiting for the arena host to begin the countdown.",
      matchStartingEyebrow: "MATCH STARTING",
      getReadyTitle: "Get Ready!",
      countdownSubtitle: "15 seconds per round · Synchronized answers",
      roundLabel: "ROUND",
      livesLabel: "LIVES",
      answerLockedBanner: "Answer locked in! Waiting for other contenders…",
      spectatorBanner: "Out of hearts — Spectating remaining contenders. Final standings appear on the podium!",
      clutchCorrectPrefix: "Clutch!",
      timedOutLife: "Timed out! -1 Life",
      missedLife: "Missed! -1 Life",
      nextRoundIn4s: "Next round in 4s…",
      toSubmitHint: "to submit",
      syncServerDeadline: "Synchronized server deadline",
      liveLeaderboardEyebrow: "LIVE LEADERBOARD",
      arenaRankingsTitle: "Arena Rankings",
      lockedInTag: "✓ In",
      thinkingTag: "Thinking…",
      missTag: "Miss",
      matchConcludedEyebrow: "ARENA MATCH CONCLUDED",
      claimsVictorySuffix: "claims victory!",
      matchCompleteTitle: "Match Complete!",
      podiumSubtitle: "A battle of speed, precision, and focus.",
      finalScoreboard: "FINAL SCOREBOARD",
      classAnalyticsTitle: "Post-Match Class Analytics",
      classAnalyticsSubtitle: "Diagnostic breakdown of student comprehension and high-priority re-teach topics.",
      exportGradebookBtn: "Export Gradebook CSV",
      earlyEliminationPrefix: "student(s)",
      earlyEliminationSuffix: "lost all 3 hearts before Round 5.",
      classAvgAccuracy: "Class Average Accuracy",
      totalPlayersKpi: "Total Players",
      totalQuestionsKpi: "Total Questions",
      missedDiagnosticHeader: "Missed Questions Diagnostic (Sorted Worst First)",
      needsReteachBadge: "Needs Re-Teach",
      topTrapPrefix: "Top trap: Option",
      missedWord: "missed",
      hostRematchBtn: "Host Rematch",
      waitingForRematch: "Waiting for host to rematch…",
      hideAnalyticsBtn: "Hide Class Analytics",
      viewAnalyticsBtn: "View Class Analytics",
      scoreboardCopiedBtn: "Scoreboard Copied!",
      shareResultsBtn: "Share Results",
      debriefWithCoachBtn: "Debrief with Coach",
      leaveArenaBtn: "Leave Arena",
      backToSoloLink: "← Back to Solo Practice",
      brandAlt: "Clutch Arena",
      headerSubtitle: "MULTIPLAYER STUDY ARENA",
      loadingArena: "Loading Arena…",
      hostPrivilegesNotice: "Host Privileges: Hosting Concept Remix arena rooms requires a 7-Day Cram Pass or Clutch Pro. Friends can join and play for free!",
      passSuffix: "Pass",
      proBadge: "Pro",
      roomCodePlaceholder: "CLUTCH",
      clickToCopyCode: "Click to copy room code",
      questionsUnit: "questions",
      botSpeedTitle: "Add Alex (Speed Demon)",
      botSteadyTitle: "Add Maya (Steady Scholar)",
      botWildcardTitle: "Add Sam (Wildcard)",
      removeBotTitle: "Remove bot",
      scoreLabel: "SCORE",
      streakLabel: "STREAK",
      questionNum: "QUESTION",
      of: "OF",
      orWord: "or",
      bestStreakLabel: "Best streak",
      livesRemaining: "lives remaining",
    },
    flashcard: {
      eyebrow: "FLASHCARD REVIEW",
      conceptRemixSuffix: " · CONCEPT REMIX",
      shuffle: "Shuffle",
      exit: "Exit",
      cardsReviewedAria: "Cards reviewed",
      gotItCount: "Got it",
      stillLearningCount: "Still learning",
      summaryAllKnown: "Every card felt solid. Time to test it under pressure.",
      summarySomeLearning: "Nice pass. Run the shaky ones again, or test yourself for real.",
      startClutchRun: "Start Clutch Run",
      reviewStillLearningPrefix: "Review",
      reviewStillLearningSuffix: "still learning",
      restartAll: "Restart all cards",
      cardWord: "Card",
      ofWord: "of",
      questionSide: "QUESTION",
      answerSide: "ANSWER",
      flipHint: "Click or press Space to flip",
      showQuestionAria: "Show question",
      revealAnswerAria: "Reveal answer",
      prevCardAria: "Previous card",
      nextCardAria: "Skip card",
      stillLearningBtn: "Still learning",
      gotItBtn: "Got it",
      revealAnswerBtn: "Reveal answer",
    },
    docViewer: {
      emptyTitle: "No study material loaded",
      emptyDesc: "Upload lecture slides, notes, or test banks (PDF, Word, TXT) to view source pages, inspect citations, and ask the AI Coach questions.",
      uploadDocBtn: "Upload document",
      pagesWord: "pages",
      sectionsWord: "sections",
      searchPlaceholder: "Search source blocks...",
      searchAria: "Search within document",
      clearSearchAria: "Clear search",
      noMatchesPrefix: "No sections match",
      clearFilter: "Clear filter",
      askCoachBtn: "Ask Coach",
      askCoachTooltip: "Ask Coach about this section",
      copyTextTooltip: "Copy text",
      showLess: "Show less",
      readMore: "Read more",
      viewerAria: "Document viewer",
      sourceBlocksAria: "Source blocks",
    },
    share: {
      title: "Share & Export Study Deck",
      conceptsSelected: "concepts selected",
      exportScope: "EXPORT SCOPE",
      allConcepts: "All Concepts",
      missedOnly: "Missed Only",
      exportFormats: "EXPORT FORMATS",
      copiedMarkdown: "Copied Markdown!",
      copyMarkdown: "Copy Markdown",
      printableGuideTitle: "Printable Guide",
      printableGuideDesc: "Print or Save as PDF",
      printableGuideTooltip: "Open print view or save as PDF",
      markdownTitle: "Markdown (.md)",
      markdownDesc: "Obsidian, Notion, Notes",
      markdownTooltip: "Download clean Markdown study guide",
      ankiTitle: "Anki (.anki.txt)",
      ankiDesc: "Spaced repetition deck",
      ankiTooltip: "Import into Anki for spaced repetition",
      quizletTitle: "Quizlet",
      quizletDesc: "Pasteable flashcard terms",
      quizletTooltip: "Import into Quizlet as flashcard terms and definitions",
      csvTitle: "CSV Spreadsheet",
      csvDesc: "Excel, Google Sheets",
      csvTooltip: "Download spreadsheet CSV",
      jsonTitle: "Clutch JSON",
      jsonDesc: "Full backup — re-import",
      jsonTooltip: "Full pack backup to re-import into Clutch Arena",
      shareLinkLabel: "SHARE LINK",
      shareLinkAria: "Share link",
      buildingLink: "Building link…",
      copiedBtn: "Copied!",
      copyBtn: "Copy",
      linkErrorBuild: "Couldn’t build a share link. Use the JSON export instead.",
      clipboardBlockedLink: "Clipboard access was blocked — select the link and copy it manually.",
      clipboardBlockedMd: "Clipboard access was blocked — try downloading the file instead.",
      longLinkWarningPrefix: "This link is long",
      charactersWord: "characters",
      longLinkWarningSuffix: "Some chat apps may cut it off — send the JSON file instead if it doesn’t open.",
      shareNote: "The whole pack lives inside the link itself. Nothing is uploaded, so anyone with the link can study these questions on any device.",
      zeroCostTitle: "$0 AI Token Cost · Zero-CAC Distribution",
      zeroCostDesc: "Importing and playing this shared link uses $0 in LLM tokens because all questions and citations are pre-computed inside the token. Free users can import and study in Classic mode forever!",
      earnPassNote: "🎁 Earn-Your-Pass: When 3 classmates import your pack link, you automatically unlock 3 free Concept Remix runs!",
    },
    notes: {
      badge: "Clutch Notes AI",
      tierBadge: "CRAM PASS · PRO · TUTOR",
      dailyQuota: "Daily Quota:",
      remaining: "remaining",
      title: "Slide-to-Summary Note Generator",
      subtitle: "Upload raw lecturer slide decks (PDF or PowerPoint). The Academic Synthesis Engine strips away agenda slides and attendance QR codes, structuring exam-ready bilingual notes with standardized LaTeX math formulas and Clutch Arena watermarked PDF export.",
      pillNoise: "Noise Stripping (Agendas & QR removed)",
      pillBilingual: "Bilingual Anchoring (EN/VI)",
      pillLatex: "LaTeX Math & Variable Definitions",
      pillPdf: "Watermarked PDF Export",
      uploadHeader: "Upload Lecturer Slide Deck",
      fileLimitNote: "PDF or PPTX up to 25MB",
      paidTiersBadge: "PAID TIERS",
      readyToSynthesize: "Ready to synthesize",
      dropTitle: "Drag and drop your lecture slide deck here, or click to browse",
      dropDesc: "Accepts .pdf and .pptx files from university courses (Finance, Economics, Engineering, STEM). Max 25MB per deck.",
      lockedNotice: "Available on 7-Day Cram Pass (69.000đ), Đấu Sĩ Pro (299.000đ), and Giảng Viên plans",
      focusLabel: "Optional Study Focus or Chapter Topics:",
      focusPlaceholder: "e.g. Gordon Growth Model, Two-Stage Valuation, Dividend Discount boundary conditions...",
      loadSampleBtn: "Load Sample Valuation Deck (27 Slides)",
      synthesizeBtn: "Synthesize Clutch Note",
      showcaseEyebrow: "Interactive Before / After Showcase",
      showcaseTitle: "See how 27 slides become a 3-page bilingual cheat sheet",
      showcaseDesc: "Compare messy lecturer slides with the structured Clutch Arena output, complete with standardized LaTeX equations and variable definitions.",
      showcaseBtn: "View Before / After Comparison",
      someSlidesUnread: "Some slides could not be read",
      unreadFormulasNote: "Formulas shown as images on these slides may be missing from this note — check the original slides.",
      step1: "Extracting slide text & mathematical notation locally...",
      step2: "Stripping attendance QR codes, cover slides & repetitive noise...",
      step3: "Extracting mathematical notation and bilingual conceptual structure...",
      step4: "Analyzing valuation models, accounting formulas & economic principles...",
      step5: "Standardizing LaTeX equations and compiling variable list...",
      step6: "Synthesizing exam-ready Key Takeaways & boundary condition rules...",
      newDeckBtn: "New Deck",
      slidesWord: "Slides",
      pagesWord: "Pages",
      noiseStripped: "Noise Stripped",
      copiedBtn: "Copied",
      copyMarkdownBtn: "Copy Markdown",
      exportPdfBtn: "Export PDF",
      verifiedBadge: "Verified",
      derivedBadge: "Derived",
      derivedFromPrefix: "Derived from",
      needsReviewBadge: "Needs review",
      contradictedBadge: "Contradicted",
      reviewNotePrefix: "Review note:",
      whereVariables: "Where:",
      whereLabel: "Where:",
      slideWord: "Slide",
      keyTakeawaysHeading: "KEY TAKEAWAYS",
      omittedExerciseReason: "Appeared solely in a practice exercise or worked example",
      omittedDuplicateReason: "Omitted from core summary sections as non-essential or duplicate",
      slideContextPrefix: "Slide context:",
      divergenceBadge: "Textbook Divergence Notice",
      lecturerForm: "Lecturer's Form",
      textbookForm: "Standard Textbook Form",
      noticesTitle: "Ingestion & Verification Notices",
      noticeSingle: "Notice",
      noticePlural: "Notices",
      noticesFooter: "Formulas or tables from these slides should be double-checked against your original lecture deck.",
      uncapturedTitle: "Uncaptured Source Formulas",
      formulaOmittedSingle: "Formula Omitted",
      formulaOmittedPlural: "Formulas Omitted",
      uncapturedDesc: "The following formulas appeared in the lecture slides (e.g. in practice exercises or appendices) but were omitted from core summary sections.",
      reasonLabel: "Reason:",
      synthesizingDefault: "Synthesizing lecture notes...",
      errInvalidFileType: "Please upload a PowerPoint (.pptx) or PDF (.pdf) lecture slide deck.",
      errFileTooLargePrefix: "File size is ",
      errFileTooLargeSuffix: "MB. Maximum allowed slide deck size is 25MB.",
      errLocalExtractionFailedPrefix: "Local slide extraction failed",
      errLocalExtractionFailedSuffix: "and file size exceeds the 4.5MB direct upload fallback limit. Please compress the file or upload a smaller chapter deck.",
      errPayloadTooLarge: "Slide deck exceeds serverless upload limit (4.5MB). Please compress the PDF/PPTX or upload specific chapters.",
      errGatewayTimeout: "The note synthesis timed out on the server (120s limit). Please try converting fewer slides or specify a focused chapter topic.",
      errSubscriptionRequired: "Paid subscription required (Cram Pass, Pro, or Tutor).",
      errDailyQuotaReached: "Daily limit reached: up to 30 deck conversions per day.",
      errServerGeneric: "Failed to synthesize study notes. Please try again.",
      errTimeoutClient: "Synthesis timed out after 2 minutes. The slide deck may be too dense or complex. Try compressing the PDF or uploading single chapter slides.",
      errNetwork: "Network connection interrupted or serverless gateway timed out. If your slide file is large, please compress the PDF/PPTX or upload fewer slides.",
      errUnexpected: "An unexpected error occurred during note synthesis.",
      pricingInitialReason: "Upgrade to Clutch Pro to unlock unlimited Clutch Notes AI slide synthesis.",
      modalTitle: "Clutch Notes AI Pro Upgrade",
      modalDesc: "Compare raw lecture slides to synthesized exam notes",
      modalCloseAria: "Close upgrade modal",
      modalBadgeUnlocked: "Unlocked on Cram Pass, Pro & Tutor",
      modalTransformPrefix: "Transform",
      modalTransformSlides: "27 Cluttered Slides",
      modalTransformInto: "into a",
      modalTransformSheet: "3-Page Exam Sheet",
      modalDescFull: "Clutch Notes AI strips away administrative fluff, attendance QR codes, and repetitive homework steps to produce bilingual revision notes with LaTeX equations and watermarked PDF export. Included in the 7-Day Cram Pass (69.000đ), Đấu Sĩ Pro (299.000đ), and Giảng Viên & Nhóm Học.",
      modalBeforeHeader: "Before: Raw Lecturer Deck",
      modalBeforeStats: "27 Slides · 65% Clutter",
      modalNoiseLabel: "NOISE",
      modalSlide12Title: "Slide 1-2: Course Info & Attendance QR",
      modalSlide7Title: "Slide 7: Agenda",
      modalSlide7Desc: "Overview, announcements, homework review, 10-min break...",
      modalSlide14Title: "Slide 14: Messy Spreadsheet Screenshot",
      modalSlide14Desc: "Row 42: P0 = D1/(r-g) = 2.40/(0.12 - 0.05) = $34.28 (unformatted cell calculation)",
      modalSlide27Title: "Slide 27: \"Any questions? Thank you!\"",
      modalBeforeWarning: "Wastes 45+ minutes skimming through non-exam material",
      modalAfterHeader: "After: Clutch Arena Note",
      modalAfterStats: "3 Pages · 100% Exam-Ready",
      modalFormulaHeading: "B. GENERAL FORMULA",
      modalFormulaCondition: "If investing for 1 year only:",
      modalWherePriceToday: "Price today",
      modalWhereDividend: "Expected dividend",
      modalWhereRequiredReturn: "Required return",
      modalKeyTakeawaysHeading: "KEY TAKEAWAYS",
      modalTakeaway1: "Zero growth → Perpetuity · Constant growth → Gordon model",
      modalTakeaway2: "Only use DDM if company pays dividends regularly",
      modalTakeaway3Prefix: "Make sure ",
      modalTakeaway3Suffix: ", otherwise the model breaks down",
      modalAfterFooter: "89% Noise Stripped · Bilingual Anchoring",
      modalKatexPdfBadge: "KaTeX & PDF",
      modalProp1Title: "30 Decks / Day",
      modalProp1Desc: "Up to 25MB PDF/PPTX",
      modalProp2Title: "Bilingual EN/VI",
      modalProp2Desc: "Academic terms in context",
      modalProp3Title: "LaTeX Math",
      modalProp3Desc: "\"Trong đó:\" variable lists",
      modalProp4Title: "Watermarked PDF",
      modalProp4Desc: "Exam revision sheets",
      modalUpgradeBtn: "View Plans & Unlock (From 69.000đ)",
      modalDemoBtn: "Try Interactive Demo Note",
    },
    auth: {
      myAccount: "My Account",
      signInTitle: "Sign In to ClutchArena",
      createAccountTitle: "Create a Free Account",
      accountDesc: "Manage your ClutchArena study account, quotas, and preferences.",
      guestDesc: "Sign in to save study packs across devices, track active recall progress, and compete in the arena.",
      guestLimitTitle: "Free Guest Quota Reached",
      guestLimitDesc: "You have used your 2 free anonymous generations. Create a free account to unlock continuous uploads, cloud deck saves, and multiplayer battles!",
      localDevMode: "🛠️ Local Development Mode",
      cloudSync: "Cloud Sync",
      activeStatus: "Active ✓",
      planTier: "Plan Tier",
      daysLeft: "d left",
      signOut: "Sign Out",
      signInTab: "Sign In",
      signUpTab: "Create Account",
      continueGoogle: "Continue with Google",
      continueGithub: "Continue with GitHub",
      orEmail: "or continue with email",
      emailLabel: "Email Address",
      passwordLabel: "Password",
      processing: "Processing...",
      createFreeAccountBtn: "Create Free Account",
      guestStudent: "Guest Student",
      accountSuffix: "Account",
      usedWord: "used",
      freeBadge: "Free",
      guestBadge: "Guest",
      userIdLabel: "User ID:",
      localDevNote: "Supabase Auth credentials are not yet configured in .env.local. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable live cloud authentication.",
      tierContender: "Clutch Free",
      tierCramPass: "7-Day Cram Pass",
      tierPro: "Clutch Pro (Semester)",
      tierTutor: "Tutor & Study Group",
      enterBothEmailPassword: "Please enter both email and password.",
      signInError: "Failed to sign in. Please verify your credentials.",
      signUpError: "Failed to create account.",
      signUpSuccess: "Account created! Please check your email to verify your account, or sign in now.",
      oauthError: "Failed to sign in with provider.",
    },
    pricing: {
      vietQrHeader: "Scan VietQR (MoMo, ZaloPay, Any Banking App)",
      selectedPlanLabel: "Selected Plan",
      bankLabel: "Bank:",
      accountNumberLabel: "Account Number:",
      accountNameLabel: "Account Name:",
      transferNoteLabel: "Transfer Description:",
      checkingPaymentBtn: "Verifying transaction status...",
      verifyPaymentBtn: "Verify Payment Status",
      openPayosPortal: "Open PayOS Checkout Page",
      securityNote: "100% Secure · Automatically activates once your bank confirms the transfer.",
      copyAccountTitle: "Copy account number",
      copyNoteTitle: "Copy transfer note",
      globalCardsLabel: "Apple Pay · Google Pay · Credit & Debit Cards",
      globalSecurityNote: "Processed securely by LemonSqueezy Merchant of Record. Tax compliant.",
      backToPlans: "Back to all plans",
      autoVerifiedIn3s: "Auto-verified in 3 seconds",
      payosLinkedBank: "PayOS Linked Bank",
    },
    tutorial: {
      quickTourBadge: "Quick Tour",
      stepWord: "Step",
      ofWord: "of",
      skipBtn: "Skip Tutorial",
      backBtn: "Back",
      nextBtn: "Next",
      closeExploreBtn: "Close & Explore",
      playSampleBtn: "Practice with Example Deck (Microeconomics)",
      uploadOwnBtn: "Upload My Own Course Notes",
      closeAria: "Close tutorial",
      goToStepAria: "Go to step",
      andWord: "and",
      // Step 0
      step0Title: "Welcome to Clutch Arena",
      step0Desc: "Clutch Arena transforms your static lecture slides, PDFs, notes, and testbanks into high-yield active recall quizzes and real-time multiplayer arenas.",
      step0Feature1Title: "Drop Any Course Notes",
      step0Feature1Desc: "AI analyzes your documents and generates multi-choice questions with verified citations.",
      step0Feature2Title: "Solo Clutch Run",
      step0Feature2Desc: "15-second pressure clock, combo multipliers, flashcard mode, and targeted weak-spot sprints.",
      step0Feature3Title: "Live Study Arena",
      step0Feature3Desc: "Real-time buzzer showdowns with classmates or adaptive bots using edge WebSockets.",
      // Step 1
      step1Title: "1. Upload Notes & AI Question Ingestion",
      step1Desc: "Never waste hours manually typing flashcards. Just upload your study documents in the Ingest tab.",
      step1SampleFile: "Lecture_Slides_Week_1_5.pdf",
      step1FormatsPrefix: "Supports ",
      step1FormatsSuffix: " files.",
      step1SupportedFormats: "Supports PDF, DOCX, PPTX, and TXT files.",
      step1Bullet1: "Extracts key definitions, laws, and quantitative formulas",
      step1Bullet2: 'Generates "Concept Twin" question variations to prevent rote memorization',
      step1Bullet3: "Pins precise textbook/slide excerpts to every question",
      // Step 2
      step2Title: "2. Solo Clutch Run (Example: Microeconomics)",
      step2Desc: "Questions are backed by zero-hallucination source citations. Here is how a question looks in our Microeconomics example deck:",
      step2DescPrefix: "Questions are backed by ",
      step2DescHighlight: "zero-hallucination source citations",
      step2DescSuffix: ". Here is how a question looks in our Microeconomics example deck:",
      step2SampleBadge: "Microeconomics Ch 5",
      step2SampleClock: "15s Clock",
      step2SampleQuestion: "A competitive firm observes that Marginal Revenue ($50) exceeds Marginal Cost ($45). To maximize profit, the firm should:",
      step2SampleOptionA: "A. Expand output until MR = MC",
      step2SampleOptionB: "B. Decrease output immediately",
      step2SampleCitation: "Citation: Chapter 5 · Marginal Profit Condition (Page 142)",
      step2Footer: "Clicking citations opens the document viewer directly to the verbatim line in your lecture notes.",
      // Step 3
      step3Title: "3. AI Coach & Weak Spot Sprints",
      step3Desc: "Clutch Arena tracks your errors and builds customized drills so you don't repeat the same mistakes on test day.",
      step3Topic1: "Consumer Surplus & Equilibrium",
      step3Mastery1: "100% Mastery",
      step3Topic2: "Price Elasticity Calculations",
      step3Mastery2: "40% Mastery (Weak Spot)",
      step3Footer: "The AI Coach creates a 5-question sprint focusing exclusively on your weak topics until you achieve mastery.",
      step3FooterPrefix: "The AI Coach creates a ",
      step3FooterHighlight: "5-question sprint",
      step3FooterSuffix: " focusing exclusively on your weak topics until you achieve mastery.",
      // Step 4
      step4Title: "4. Live Study Arena (Multiplayer)",
      step4Desc: "Turn study sessions into fast-paced live buzzer showdowns with your classmates or study groups.",
      step4RoomLabel: "ROOM: #ECON42",
      step4LiveBadge: "● LIVE WEBSOCKET",
      step4User1: "1. Kyle (You)",
      step4Points1: "1,240 pts ⚡",
      step4User2: "2. StudyBot-Alpha",
      step4Points2: "1,020 pts",
      step4User3: "3. Alex",
      step4Points3: "880 pts",
      step4SpeedPointsTitle: "Speed points",
      step4SpeedPointsDesc: ": The fastest correct buzzer wins extra bonus XP.",
      step4AdaptiveBotsTitle: "Adaptive Bots",
      step4AdaptiveBotsDesc: ": Fill empty spots with bots if practicing solo at night.",
      // Step 5
      step5Title: "Ready to Clutch Your Exam?",
      step5Desc: "Choose how you want to begin: practice right now using the Microeconomics sample pack, or upload your own lecture notes!",
      step5DescPrefix: "Choose how you want to begin: practice right now using the ",
      step5DescHighlight: "Microeconomics sample pack",
      step5DescSuffix: ", or upload your own lecture notes!",
    },
    common: {
      errorTitle: "Let’s take that again.",
      errorDesc: "Something interrupted this session. Start fresh to get back into your run.",
      errorFallback: "Something interrupted this session. Start fresh to get back into your run.",
      tryAgain: "Try again",
      tryAgainBtn: "Try again",
      loadingText: "Getting your comeback ready…",
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
      notes: "Tóm tắt AI",
      hideDocViewer: "Ẩn trình xem tài liệu",
      showDocViewer: "Hiện trình xem tài liệu",
      toggleDocViewer: "Bật/tắt trình xem tài liệu",
      viewPricing: "Xem các gói học tập và bảng giá",
      cramPassBtn: "Gói Ôn Thi",
      sendFeedback: "Góp ý & Báo lỗi",
      switchToEn: "Chuyển sang Tiếng Anh",
      switchToVi: "Chuyển sang Tiếng Việt",
      selectLangAria: "Chọn ngôn ngữ hiển thị",
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
      statusArena: "Đấu trường trực tiếp",
      statusIngest: "Nạp tài liệu",
      statusCoach: "Gia sư đang hoạt động",
      statusSolo: "Luyện tập cá nhân",
      statusNotes: "Tổng hợp slide Pro",
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
      welcomeTitle: "Chào mừng đến với Clutch Arena",
      welcomeDesc: "Chưa có bộ đề nào được chọn. Hãy xem hướng dẫn nhanh, tải tài liệu môn học của bạn lên, hoặc thử bộ đề mẫu ngay.",
      gettingStartedTag: "Bắt đầu ngay",
      welcomeTutorialTitle: "Hướng dẫn tương tác",
      welcomeTutorialDesc: "Khám phá nhanh cách ôn tập chủ động và đấu trường trực tiếp trong 1 phút.",
      welcomeNotesTitle: "Clutch Notes AI",
      welcomeNotesDesc: "Biến 27 slide bài giảng thành 3 trang tóm tắt song ngữ cô đọng kèm công thức LaTeX & xuất PDF.",
      welcomeUploadTitle: "Tải tài liệu học tập",
      welcomeUploadDesc: "Kéo thả tệp PDF, DOCX hoặc PPTX bài giảng để tạo bộ câu hỏi ôn tập.",
      welcomeSampleTitle: "Thử bộ đề mẫu",
      welcomeSampleDesc: "Trải nghiệm 15 câu hỏi Kinh tế vi mô Chương 1–5 kèm trích dẫn nguồn.",
      sessionLength: "Số lượng câu hỏi",
      contenderMax10Q: "Contender (Tối đa 10 câu)",
      questionsUnit: "câu",
      comebackSprintReady: "Sẵn sàng Lượt Bứt Phá",
      weakSpotSingle: "điểm yếu",
      weakSpotPlural: "điểm yếu",
      weakSpotTargetPrefix: "Tập trung ôn",
      weakSpotMore: "khác",
      weakSpotTargetSuffix: "trong lượt bứt phá nhanh 5 câu hỏi.",
      leaveRun: "Rời bài thi",
      keyboardAnswerHint: "để chọn đáp án",
      keyboardContinueHint: "để tiếp tục",
      orWord: "hoặc",
      yourSession: "PHIÊN CỦA BẠN",
      oneConceptAtATime: "Chinh phục từng khái niệm một.",
      practiceConceptFallback: "Khái niệm ôn tập",
      reinforcing: "Đang củng cố",
      correctCountWord: "câu đúng",
      lookingGood: "Đã nắm vững",
      perQuestion15s: "15s / câu",
      takeABreather: "Tạm nghỉ một chút",
      progressTitle: "Mỗi phiên học đều tích lũy tiến bộ.",
      progressDesc: "Các lượt làm bài hoàn thành được lưu trên trình duyệt của thiết bị này.",
      runsCompleted: "Lượt hoàn thành",
      totalXp: "Tổng XP",
      bestStreakLabel: "Chuỗi cao nhất",
      masteredLabel: "Thành thạo",
      runsHistoryTab: "Lịch sử làm bài",
      conceptMasteryTab: "Độ thông thạo",
      practiceRunItemTitle: "Phiên luyện tập",
      historyEmptyTitle: "Chiến thắng đầu tiên đang chờ bạn.",
      historyEmptyDesc: "Hoàn thành một lượt làm bài để bắt đầu lưu dấu ấn tiến bộ.",
      inARow: "liên tiếp",
      masteryEmptyTitle: "Chưa có dữ liệu khái niệm.",
      masteryEmptyDesc: "Hoàn thành các câu hỏi luyện tập để xây dựng hồ sơ thông thạo kiến thức.",
      backToPractice: "Quay lại luyện tập",
      leaveDialogTitle: "Dừng lượt luyện tập này?",
      leaveDialogDesc: "Đồng hồ đang tạm dừng. Rời đi sẽ hủy lượt làm bài chưa hoàn thành này; các lượt đã xong vẫn được lưu.",
      keepGoing: "Tiếp tục làm bài",
      pauseDialogTitle: "Hít thở sâu. Bạn vẫn còn thời gian.",
      pauseDialogDesc: "Đồng hồ đã tạm dừng. Hãy nghỉ ngơi một chút và quay lại khi bạn sẵn sàng.",
      resumeRun: "Tiếp tục bài thi",
      cheatSheetBtn: "Xuất PDF Cheat Sheet 1 chạm",
      summaryFootnote: "Kết quả lượt thi này được lưu trên thiết bị của bạn.",
      keepMomentum: "Giữ vững phong độ này nhé.",
      queuedForRetry: "Đã đưa vào hàng đợi để ôn lại.",
      flagCitation: "Báo lỗi trích dẫn",
      questionEyebrow: "CÂU HỎI",
      masteryRoundTag: "Vòng khắc phục",
      conceptVariantTag: "Biến thể tương đương",
      practiceTag: "Luyện tập",
      livesHud: "CƠ HỘI",
      livesRemainingAria: "mạng còn lại",
      timeToThink: "Thời gian suy nghĩ",
      clockPaused: "Đã tạm dừng",
      reviewFlashcardsTooltip: "Ôn thẻ Flashcard trước khi làm bài tính giờ",
      switchDeckTooltip: "Đổi hoặc nhập một bộ đề học tập khác",
      shareExportTooltip: "Chia sẻ & xuất bộ đề",
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
      contenderBadge: "Contender: 2 lượt tải/tuần (1 tệp)",
      paidBadgeSuffix: "Không giới hạn (10 tệp)",
      removeFileAria: "Xóa tệp",
      errorPrefix: "Lỗi",
      noFileSelected: "Vui lòng chọn ít nhất một tệp để tải lên.",
      tooLargeError: "Tổng dung lượng vượt quá giới hạn 25 MB. Vui lòng chọn ít tệp hơn hoặc tệp nhỏ hơn.",
      guestLimitError: "Đã hết 2/2 lượt tạo đề miễn phí cho khách. Vui lòng đăng nhập hoặc tạo tài khoản để tiếp tục.",
      cancelledError: "Đã hủy tải lên.",
      genericIngestError: "Đã xảy ra lỗi khi xử lý tài liệu.",
      extractingStructure: "Đang trích xuất cấu trúc từ",
      readingAnalyzing: "Đang đọc và phân tích",
      extractingTextBlocks: "Đang trích xuất văn bản từ",
      readingParsing: "Đang đọc & phân tích",
      synthesizingTopics: "Đang tổng hợp chủ đề cốt lõi & mục tiêu học tập",
      formulatingQuestions: "Đang tạo câu hỏi trắc nghiệm & biến thể",
      verifyingCitations: "Đang đối chiếu trích dẫn nguồn và hoàn tất bộ đề",
      previewExtractedTitle: "Đã trích xuất bản xem trước",
      blocksWord: "đoạn nguồn",
      charactersWord: "ký tự",
      previewLoadedDesc: "Tài liệu đã được nạp vào khung Xem tài liệu bên trái. Bạn đã sẵn sàng tạo câu hỏi từ tài liệu này chưa?",
      generateQuestionsNowPrefix: "Tạo ngay",
      generateQuestionsNowSuffix: "câu hỏi",
      multiDocLimitReason: "Tổng hợp đa tài liệu cùng lúc (tối đa 10 tệp / 25MB) yêu cầu Vé Ôn Thi Cấp Tốc (Cram Pass) hoặc Clutch Pro. Gói Contender miễn phí hỗ trợ 1 tệp mỗi lần tải.",
      sampleQuestion: "Câu hỏi mẫu",
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
      focusMissedPrefix: "Trọng tâm: Câu trả lời sai",
      focusDebriefPrefix: "Trọng tâm: Tổng kết sau lượt thi",
      explainAutoPrompt: "Tại sao đáp án đúng lại chính xác, và bẫy chính trong câu hỏi này là gì?",
      debriefAutoPrompt: "Hãy tổng kết lượt làm bài của mình, chỉ ra các lỗ hổng kiến thức lớn nhất và gợi ý lộ trình ôn tập 3 bước nhé?",
      dismissFocus: "Đóng trọng tâm",
      streamingStatus: "Gia sư AI đang phân tích tài liệu nguồn...",
      connectionError: "Gia sư AI gặp sự cố kết nối mô hình. Vui lòng kiểm tra cấu hình khóa API và thử lại.",
      genericCoachError: "Không thể nhận phản hồi từ Gia sư AI. Vui lòng thử lại sau.",
      docWord: "Tài liệu",
      slideWord: "Trang",
      focusDebriefCorrect: "câu đúng",
      jumpToCitation: "Chuyển đến",
      jumpToCitationViewerSuffix: "trong khung Xem tài liệu",
      jumpToCitationAria: "Chuyển đến trích dẫn",
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
      savedPacksHeader: "BỘ ĐỀ ĐÃ LƯU",
      importJson: "Nhập tệp JSON",
      importErrorFallback: "Không thể nhập tệp bộ đề.",
      noPacksSavedTitle: "Chưa có bộ đề nào được lưu.",
      noPacksSavedDesc: "Hãy tải slide, PDF hoặc ghi chú lên ở mục Tài liệu để tạo bộ đề tùy chỉnh và lưu tại đây.",
      arenaBtn: "Đấu trường",
      hostInArenaTooltip: "Tổ chức trong Đấu trường",
      shareExportTooltip: "Chia sẻ & Xuất tệp",
      deletePackTooltip: "Xóa bộ đề đã lưu",
      confirmDelete: "Bạn có chắc chắn muốn xóa bộ đề này không? Thao tác này không thể hoàn tác.",
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
      hostPaysTitle: "⚡ Chủ phòng mở đề, Bạn bè chơi miễn phí:",
      hostPaysDesc: "Mọi người đều có thể vào phòng đấu của bạn bè miễn phí 100% (0đ chi phí AI). Chỉ chủ phòng mới cần Cram Pass hoặc Pro để mở đề 30 câu Remix.",
      viewTiersBtn: "Xem các gói nâng cấp",
      noPacksTitle: "Chưa có bộ đề nào",
      noPacksDesc: "Hãy tải tài liệu lên ở mục Tài liệu để tạo bộ đề tùy chỉnh và mở phòng đấu tại đây.",
      enterCodeError: "Vui lòng nhập mã phòng.",
      enterNicknameError: "Vui lòng nhập biệt danh của bạn.",
      joinFailedError: "Không thể vào phòng. Vui lòng kiểm tra lại mã phòng hoặc trận đấu đã bắt đầu.",
      selectPackError: "Vui lòng chọn hoặc tải lên một bộ đề trước khi tạo phòng đấu.",
      createFailedError: "Không thể tạo phòng đấu lúc này. Vui lòng thử lại.",
      playersWord: "người chơi",
      connectingToArena: "Đang kết nối vào Đấu trường",
      couldNotConnectTitle: "Không thể kết nối vào Đấu trường",
      roomClosedDesc: "Phòng đấu có thể đã đóng hoặc hết hạn.",
      backToEntrance: "Quay lại sảnh Đấu trường",
      exitArena: "Rời Đấu trường",
      roomBadge: "PHÒNG",
      lobbyEyebrow: "SẢNH CHỜ ĐẤU TRƯỜNG HỌC TẬP",
      codeLabel: "MÃ:",
      copiedPill: "Đã chép!",
      linkCopiedBtn: "Đã chép liên kết!",
      shareRoomLinkBtn: "Chia sẻ liên kết phòng",
      contendersHeader: "Đấu sĩ trong phòng",
      joinedWord: "đã tham gia",
      addPracticeBot: "Thêm Bot luyện tập",
      botSpeed: "⚡ Tốc độ",
      botSteady: "🦉 Chắc chắn",
      botWildcard: "🔥 Đột biến",
      youPill: "BẠN",
      roleBot: "Bot AI luyện tập",
      roleHost: "Chủ phòng",
      roleChallenger: "Đấu sĩ",
      readyTag: "Sẵn sàng",
      waitingTag: "Đang chờ",
      openSlotTitle: "Vị trí còn trống",
      openSlotDescPrefix: "Chia sẻ mã phòng",
      openSlotDescSuffix: "hoặc thêm bot ở trên",
      openTag: "Trống",
      matchRulesEyebrow: "LUẬT THI ĐẤU",
      matchRulesTitle: "Phản xạ nhanh dưới áp lực thời gian.",
      rule1Bold: "15 giây mỗi câu",
      rule1Text: "Tất cả người chơi trả lời đồng thời.",
      rule2Bold: "Hệ số chuỗi đúng",
      rule2Text: "3 câu đúng liên tiếp nhân 1.5×, 5 câu nhân 2× XP.",
      rule3Bold: "3 Mạng (Tim)",
      rule3Text: "Trả lời sai hoặc hết giờ mất 1 tim. Người trụ vững cuối cùng sẽ lên bục vinh quang!",
      startMatchBtn: "Bắt đầu trận đấu",
      cancelReadyBtn: "Hủy sẵn sàng",
      imReadyBtn: "Sẵn sàng!",
      hostCaption: "Khi bắt đầu, tất cả người chơi sẽ cùng đếm ngược đồng bộ.",
      guestCaption: "Đang chờ chủ phòng bắt đầu trận đấu.",
      matchStartingEyebrow: "TRẬN ĐẤU BẮT ĐẦU",
      getReadyTitle: "Chuẩn bị!",
      countdownSubtitle: "15 giây mỗi vòng · Đồng bộ thời gian thực",
      roundLabel: "VÒNG",
      livesLabel: "MẠNG",
      answerLockedBanner: "Đã chốt đáp án! Đang chờ các đấu sĩ khác…",
      spectatorBanner: "Đã hết tim — Đang theo dõi các đấu sĩ còn lại. Bảng xếp hạng cuối cùng sẽ hiện ở bục vinh quang!",
      clutchCorrectPrefix: "Chuẩn xác!",
      timedOutLife: "Hết giờ! -1 Mạng",
      missedLife: "Chưa đúng! -1 Mạng",
      nextRoundIn4s: "Vòng tiếp theo sau 4s…",
      toSubmitHint: "để chọn đáp án",
      syncServerDeadline: "Đồng bộ thời gian máy chủ",
      liveLeaderboardEyebrow: "BẢNG XẾP HẠNG TRỰC TIẾP",
      arenaRankingsTitle: "Thứ hạng Đấu trường",
      lockedInTag: "✓ Đã chốt",
      thinkingTag: "Đang nghĩ…",
      missTag: "Sai",
      matchConcludedEyebrow: "TRẬN ĐẤU KẾT THÚC",
      claimsVictorySuffix: "giành chiến thắng!",
      matchCompleteTitle: "Hoàn thành trận đấu!",
      podiumSubtitle: "Cuộc đua của tốc độ, sự chính xác và tập trung cao độ.",
      finalScoreboard: "BẢNG ĐIỂM CHUNG CUỘC",
      classAnalyticsTitle: "Phân tích Lớp học Sau Trận đấu",
      classAnalyticsSubtitle: "Chẩn đoán mức độ hiểu bài của học viên và các chủ đề cần giảng kỹ lại.",
      exportGradebookBtn: "Xuất bảng điểm CSV",
      earlyEliminationPrefix: "học viên",
      earlyEliminationSuffix: "đã mất hết 3 tim trước Vòng 5.",
      classAvgAccuracy: "Độ chính xác trung bình",
      totalPlayersKpi: "Tổng người chơi",
      totalQuestionsKpi: "Tổng số câu hỏi",
      missedDiagnosticHeader: "Chẩn đoán Câu trả lời sai (Sắp xếp từ sai nhiều nhất)",
      needsReteachBadge: "Cần giảng lại",
      topTrapPrefix: "Bẫy nhiều người chọn: Đáp án",
      missedWord: "làm sai",
      hostRematchBtn: "Đấu lại trận mới",
      waitingForRematch: "Đang chờ chủ phòng mở trận đấu lại…",
      hideAnalyticsBtn: "Ẩn phân tích lớp học",
      viewAnalyticsBtn: "Xem phân tích lớp học",
      scoreboardCopiedBtn: "Đã chép bảng điểm!",
      shareResultsBtn: "Chia sẻ kết quả",
      debriefWithCoachBtn: "Tổng kết cùng Gia sư AI",
      leaveArenaBtn: "Rời Đấu trường",
      backToSoloLink: "← Quay lại Luyện tập Cá nhân",
      brandAlt: "Đấu trường Clutch Arena",
      headerSubtitle: "ĐẤU TRƯỜNG HỌC TẬP NHIỀU NGƯỜI",
      loadingArena: "Đang tải Đấu trường…",
      hostPrivilegesNotice: "Quyền chủ phòng: Mở phòng biến thể Concept Remix yêu cầu Vé Cram 7 ngày hoặc Clutch Pro. Bạn bè có thể tham gia thi đấu hoàn toàn miễn phí!",
      passSuffix: "Lượt",
      proBadge: "Pro",
      roomCodePlaceholder: "CLUTCH",
      clickToCopyCode: "Nhấn để sao chép mã phòng",
      questionsUnit: "câu hỏi",
      botSpeedTitle: "Thêm Alex (Tốc độ)",
      botSteadyTitle: "Thêm Maya (Chắc chắn)",
      botWildcardTitle: "Thêm Sam (Đột biến)",
      removeBotTitle: "Xóa bot",
      scoreLabel: "ĐIỂM",
      streakLabel: "CHUỖI",
      questionNum: "CÂU HỎI",
      of: "TRÊN",
      orWord: "hoặc",
      bestStreakLabel: "Chuỗi tốt nhất",
      livesRemaining: "mạng còn lại",
    },
    flashcard: {
      eyebrow: "ÔN TẬP FLASHCARD",
      conceptRemixSuffix: " · BIẾN THỂ REMIX",
      shuffle: "Trộn thẻ",
      exit: "Thoát",
      cardsReviewedAria: "Số thẻ đã xem",
      gotItCount: "Đã thuộc",
      stillLearningCount: "Cần ôn thêm",
      summaryAllKnown: "Mọi thẻ đều đã vững. Đã đến lúc thử thách dưới áp lực thời gian!",
      summarySomeLearning: "Lượt ôn tốt lắm. Hãy xem lại các thẻ chưa chắc hoặc vào bài thi thật ngay.",
      startClutchRun: "Bắt đầu làm bài",
      reviewStillLearningPrefix: "Ôn lại",
      reviewStillLearningSuffix: "thẻ chưa thuộc",
      restartAll: "Xem lại toàn bộ thẻ",
      cardWord: "Thẻ",
      ofWord: "trên",
      questionSide: "CÂU HỎI",
      answerSide: "ĐÁP ÁN",
      flipHint: "Nhấp chuột hoặc nhấn phím Cách (Space) để lật",
      showQuestionAria: "Hiện câu hỏi",
      revealAnswerAria: "Hiện đáp án",
      prevCardAria: "Thẻ trước",
      nextCardAria: "Thẻ tiếp theo",
      stillLearningBtn: "Chưa thuộc",
      gotItBtn: "Đã thuộc",
      revealAnswerBtn: "Lật xem đáp án",
    },
    docViewer: {
      emptyTitle: "Chưa nạp tài liệu học tập",
      emptyDesc: "Tải lên slide bài giảng, ghi chú hoặc ngân hàng đề (PDF, Word, TXT) để xem từng trang nguồn, đối chiếu trích dẫn và hỏi Gia sư AI.",
      uploadDocBtn: "Tải tài liệu lên",
      pagesWord: "trang",
      sectionsWord: "phần",
      searchPlaceholder: "Tìm kiếm nội dung nguồn...",
      searchAria: "Tìm kiếm trong tài liệu",
      clearSearchAria: "Xóa tìm kiếm",
      noMatchesPrefix: "Không có phần nào khớp với",
      clearFilter: "Xóa bộ lọc",
      askCoachBtn: "Hỏi Gia sư",
      askCoachTooltip: "Hỏi Gia sư AI về phần này",
      copyTextTooltip: "Sao chép văn bản",
      showLess: "Thu gọn",
      readMore: "Xem thêm",
      viewerAria: "Khung xem tài liệu",
      sourceBlocksAria: "Các đoạn trích nguồn",
    },
    share: {
      title: "Chia sẻ & Xuất bộ đề học tập",
      conceptsSelected: "khái niệm được chọn",
      exportScope: "PHẠM VI XUẤT",
      allConcepts: "Tất cả khái niệm",
      missedOnly: "Chỉ câu làm sai",
      exportFormats: "ĐỊNH DẠNG XUẤT",
      copiedMarkdown: "Đã chép Markdown!",
      copyMarkdown: "Chép Markdown",
      printableGuideTitle: "Bản in ôn tập",
      printableGuideDesc: "In hoặc Lưu thành PDF",
      printableGuideTooltip: "Mở chế độ in hoặc lưu dưới dạng PDF",
      markdownTitle: "Markdown (.md)",
      markdownDesc: "Obsidian, Notion, Ghi chú",
      markdownTooltip: "Tải bản tóm tắt ôn tập Markdown chuẩn",
      ankiTitle: "Anki (.anki.txt)",
      ankiDesc: "Bộ thẻ lặp lại ngắt quãng",
      ankiTooltip: "Nhập vào Anki để học lặp lại ngắt quãng",
      quizletTitle: "Quizlet",
      quizletDesc: "Thuật ngữ thẻ ghi nhớ",
      quizletTooltip: "Nhập vào Quizlet dưới dạng thuật ngữ và định nghĩa thẻ ghi nhớ",
      csvTitle: "Bảng tính CSV",
      csvDesc: "Excel, Google Sheets",
      csvTooltip: "Tải bảng tính CSV",
      jsonTitle: "Tệp Clutch JSON",
      jsonDesc: "Sao lưu đầy đủ — nhập lại",
      jsonTooltip: "Sao lưu đầy đủ bộ đề để nhập lại vào Clutch Arena",
      shareLinkLabel: "LIÊN KẾT CHIA SẺ",
      shareLinkAria: "Liên kết chia sẻ",
      buildingLink: "Đang tạo liên kết…",
      copiedBtn: "Đã chép!",
      copyBtn: "Sao chép",
      linkErrorBuild: "Không thể tạo liên kết chia sẻ. Vui lòng dùng tính năng xuất JSON.",
      clipboardBlockedLink: "Trình duyệt chặn bộ nhớ tạm — vui lòng bôi đen liên kết và sao chép thủ công.",
      clipboardBlockedMd: "Trình duyệt chặn bộ nhớ tạm — vui lòng tải tệp về máy.",
      longLinkWarningPrefix: "Liên kết này khá dài",
      charactersWord: "ký tự",
      longLinkWarningSuffix: "Một số ứng dụng nhắn tin có thể cắt bớt — hãy gửi tệp JSON nếu liên kết không mở được.",
      shareNote: "Toàn bộ bộ đề được mã hóa ngay trong liên kết. Bất kỳ ai có liên kết đều có thể ôn tập trên mọi thiết bị.",
      zeroCostTitle: "0đ Chi phí AI Token · Chia sẻ miễn phí",
      zeroCostDesc: "Nhập và làm bài qua liên kết chia sẻ không tốn chi phí AI vì câu hỏi và trích dẫn đã được đóng gói sẵn. Người dùng miễn phí có thể nhập và ôn tập mãi mãi!",
      earnPassNote: "🎁 Thưởng chia sẻ: Khi 3 bạn học nhập liên kết bộ đề của bạn, bạn tự động nhận ngay 3 lượt chơi Concept Remix miễn phí!",
    },
    notes: {
      badge: "Clutch Notes AI",
      tierBadge: "CRAM PASS · PRO · TUTOR",
      dailyQuota: "Hạn mức hôm nay:",
      remaining: "lượt còn lại",
      title: "Trình Tóm Tắt Slide Bài Giảng AI",
      subtitle: "Tải lên slide bài giảng gốc (PDF hoặc PowerPoint). Hệ thống AI Học Thuật sẽ lọc bỏ slide mục lục, mã QR điểm danh và phần rườm rà, cấu trúc lại thành bản tóm tắt ôn thi song ngữ kèm công thức LaTeX chuẩn hóa và xuất PDF.",
      pillNoise: "Lọc nhiễu 85%+ (Bỏ mục lục & QR)",
      pillBilingual: "Neo thuật ngữ song ngữ (EN/VI)",
      pillLatex: "Công thức LaTeX & Giải nghĩa biến số",
      pillPdf: "Xuất PDF ôn thi chuẩn A4",
      uploadHeader: "Tải lên Slide Bài Giảng",
      fileLimitNote: "PDF hoặc PPTX tối đa 25MB",
      paidTiersBadge: "GÓI NÂNG CẤP",
      readyToSynthesize: "Sẵn sàng tổng hợp",
      dropTitle: "Kéo và thả tệp slide bài giảng vào đây, hoặc nhấp để chọn tệp",
      dropDesc: "Hỗ trợ tệp .pdf và .pptx từ các môn đại học (Tài chính, Kinh tế, Kỹ thuật, STEM). Tối đa 25MB mỗi tệp.",
      lockedNotice: "Khả dụng trong gói Vé Ôn Thi 7 Ngày (69.000đ), Đấu Sĩ Pro (299.000đ) và Giảng Viên",
      focusLabel: "Trọng tâm ôn tập hoặc Chủ đề chương (Tùy chọn):",
      focusPlaceholder: "VD: Mô hình tăng trưởng Gordon, Định giá 2 giai đoạn, điều kiện biên DDM...",
      loadSampleBtn: "Xem Bản Mẫu Định Giá Cổ Phiếu (27 Slide)",
      synthesizeBtn: "Tổng hợp Tài liệu Ôn thi",
      showcaseEyebrow: "So sánh Trực quan Trước / Sau",
      showcaseTitle: "Xem cách 27 slide bài giảng cô đọng thành 3 trang cẩm nang ôn thi",
      showcaseDesc: "Đối chiếu slide bài giảng gốc nhiều chữ với bản tóm tắt chuẩn mực của Clutch Arena, đầy đủ công thức LaTeX và giải thích biến số.",
      showcaseBtn: "Xem So sánh Trước / Sau",
      someSlidesUnread: "Một số slide không thể đọc được",
      unreadFormulasNote: "Công thức dạng ảnh chụp trên các slide này có thể bị khuyết — vui lòng đối chiếu slide gốc.",
      step1: "Đang trích xuất văn bản slide & ký hiệu toán học...",
      step2: "Đang loại bỏ mã QR điểm danh, trang bìa & nội dung thừa...",
      step3: "Đang trích xuất công thức toán học và cấu trúc khái niệm song ngữ...",
      step4: "Đang phân tích mô hình định giá, công thức và nguyên lý cốt lõi...",
      step5: "Đang chuẩn hóa phương trình LaTeX và lập danh sách biến số...",
      step6: "Đang tổng hợp Điểm cốt lõi (Key Takeaways) & điều kiện áp dụng...",
      newDeckBtn: "Tài liệu mới",
      slidesWord: "Slide",
      pagesWord: "Trang",
      noiseStripped: "Đã lọc nhiễu",
      copiedBtn: "Đã chép",
      copyMarkdownBtn: "Chép Markdown",
      exportPdfBtn: "Xuất PDF",
      verifiedBadge: "Đã kiểm chứng",
      derivedBadge: "Suy dẫn",
      derivedFromPrefix: "Suy dẫn từ",
      needsReviewBadge: "Cần kiểm tra",
      contradictedBadge: "Mâu thuẫn nguồn",
      reviewNotePrefix: "Ghi chú kiểm tra:",
      whereVariables: "Trong đó:",
      whereLabel: "Trong đó:",
      slideWord: "Slide",
      keyTakeawaysHeading: "ĐIỂM CỐT LÕI (KEY TAKEAWAYS)",
      omittedExerciseReason: "Chỉ xuất hiện trong bài tập thực hành hoặc ví dụ giải mẫu",
      omittedDuplicateReason: "Được lược khỏi phần tóm tắt lý thuyết do trùng lặp hoặc không bắt buộc",
      slideContextPrefix: "Ngữ cảnh slide:",
      divergenceBadge: "Lưu ý Khác biệt Giáo trình",
      lecturerForm: "Công thức của Giảng viên",
      textbookForm: "Công thức Giáo trình Chuẩn",
      noticesTitle: "Thông báo Trích xuất & Kiểm chứng",
      noticeSingle: "Lưu ý",
      noticePlural: "Lưu ý",
      noticesFooter: "Các công thức hoặc bảng biểu từ những slide này nên được đối chiếu lại với tệp bài giảng gốc.",
      uncapturedTitle: "Công thức Nguồn Chưa Đưa Vào Tóm Tắt",
      formulaOmittedSingle: "Công thức lược bỏ",
      formulaOmittedPlural: "Công thức lược bỏ",
      uncapturedDesc: "Các công thức dưới đây xuất hiện trong slide (ví dụ trong bài tập thực hành hoặc phụ lục) nhưng được lược khỏi phần tóm tắt lý thuyết cốt lõi.",
      reasonLabel: "Lý do:",
      synthesizingDefault: "Đang tổng hợp tài liệu bài giảng...",
      errInvalidFileType: "Vui lòng tải lên tệp bài giảng định dạng PowerPoint (.pptx) hoặc PDF (.pdf).",
      errFileTooLargePrefix: "Kích thước tệp là ",
      errFileTooLargeSuffix: "MB. Dung lượng tối đa cho phép là 25MB.",
      errLocalExtractionFailedPrefix: "Trích xuất slide cục bộ không thành công",
      errLocalExtractionFailedSuffix: "và dung lượng tệp vượt quá giới hạn tải lên trực tiếp 4.5MB. Vui lòng nén tệp hoặc tải lên tệp bài giảng từng chương nhỏ hơn.",
      errPayloadTooLarge: "Tệp bài giảng vượt quá giới hạn tải lên máy chủ (4.5MB). Vui lòng nén PDF/PPTX hoặc tải lên các chương cụ thể.",
      errGatewayTimeout: "Tổng hợp bài giảng quá thời gian chờ trên máy chủ (giới hạn 120 giây). Vui lòng chuyển đổi ít slide hơn hoặc chọn chủ đề trọng tâm.",
      errSubscriptionRequired: "Yêu cầu gói trả phí (Vé Ôn Thi, Đấu Sĩ Pro hoặc Giảng Viên).",
      errDailyQuotaReached: "Đã đạt giới hạn hôm nay: tối đa 30 lượt chuyển đổi slide mỗi ngày.",
      errServerGeneric: "Không thể tổng hợp tài liệu học tập. Vui lòng thử lại.",
      errTimeoutClient: "Quá trình tổng hợp đã quá thời gian 2 phút. Slide bài giảng có thể quá nặng hoặc phức tạp. Hãy nén PDF hoặc tải lên từng chương slide.",
      errNetwork: "Kết nối mạng bị gián đoạn hoặc cổng xử lý quá thời gian. Nếu tệp lớn, vui lòng nén PDF/PPTX hoặc tải lên ít slide hơn.",
      errUnexpected: "Đã xảy ra lỗi không mong muốn trong quá trình tổng hợp tài liệu.",
      pricingInitialReason: "Nâng cấp lên Đấu Sĩ Pro để mở khóa không giới hạn tổng hợp bài giảng Clutch Notes AI.",
      modalTitle: "Nâng Cấp Clutch Notes AI Pro",
      modalDesc: "So sánh slide bài giảng gốc với bản tóm tắt ôn thi tinh gọn",
      modalCloseAria: "Đóng cửa sổ nâng cấp",
      modalBadgeUnlocked: "Mở khóa trên Vé Ôn Thi, Pro & Giảng Viên",
      modalTransformPrefix: "Biến",
      modalTransformSlides: "27 Slide Lộn Xộn",
      modalTransformInto: "thành",
      modalTransformSheet: "Bản Tóm Tắt Ôn Thi 3 Trang",
      modalDescFull: "Clutch Notes AI loại bỏ nội dung hành chính, mã QR điểm danh và bài tập rườm rà để tạo tài liệu ôn thi song ngữ với công thức LaTeX chuẩn và xuất PDF chống bản quyền. Đi kèm trong Vé Ôn Thi 7 Ngày (69.000đ), Đấu Sĩ Pro (299.000đ) và Giảng Viên & Nhóm Học.",
      modalBeforeHeader: "Trước: Slide Bài Giảng Gốc",
      modalBeforeStats: "27 Slide · 65% Rườm Rà",
      modalNoiseLabel: "RÁC",
      modalSlide12Title: "Slide 1-2: Thông tin môn học & Mã QR điểm danh",
      modalSlide7Title: "Slide 7: Mục lục buổi học",
      modalSlide7Desc: "Tổng quan, thông báo, chữa bài tập, nghỉ giải lao 10 phút...",
      modalSlide14Title: "Slide 14: Ảnh chụp bảng tính Excel lộn xộn",
      modalSlide14Desc: "Dòng 42: P0 = D1/(r-g) = 2.40/(0.12 - 0.05) = $34.28 (tính toán ô chưa định dạng)",
      modalSlide27Title: "Slide 27: \"Có câu hỏi nào không? Cảm ơn!\"",
      modalBeforeWarning: "Lãng phí hơn 45 phút lướt qua các nội dung không thi",
      modalAfterHeader: "Sau: Bản Tóm Tắt Clutch Arena",
      modalAfterStats: "3 Trang · 100% Sẵn Sàng Ôn Thi",
      modalFormulaHeading: "B. CÔNG THỨC TỔNG QUÁT",
      modalFormulaCondition: "Nếu chỉ đầu tư trong 1 năm:",
      modalWherePriceToday: "Giá hôm nay",
      modalWhereDividend: "Cổ tức kỳ vọng",
      modalWhereRequiredReturn: "Lợi suất yêu cầu",
      modalKeyTakeawaysHeading: "ĐIỂM CỐT LÕI",
      modalTakeaway1: "Tăng trưởng bằng 0 → Dòng tiền đều vô hạn · Tăng trưởng không đổi → Mô hình Gordon",
      modalTakeaway2: "Chỉ sử dụng DDM nếu công ty trả cổ tức đều đặn",
      modalTakeaway3Prefix: "Đảm bảo ",
      modalTakeaway3Suffix: ", nếu không mô hình sẽ bị vô nghiệm",
      modalAfterFooter: "Lọc 89% nhiễu · Neo thuật ngữ song ngữ",
      modalKatexPdfBadge: "KaTeX & PDF",
      modalProp1Title: "30 Bộ Slide / Ngày",
      modalProp1Desc: "PDF/PPTX tối đa 25MB",
      modalProp2Title: "Song ngữ EN/VI",
      modalProp2Desc: "Thuật ngữ học thuật theo ngữ cảnh",
      modalProp3Title: "Công thức LaTeX",
      modalProp3Desc: "Danh sách biến số \"Trong đó:\"",
      modalProp4Title: "Xuất PDF Bản Quyền",
      modalProp4Desc: "Cẩm nang ôn thi cấp tốc",
      modalUpgradeBtn: "Xem Gói & Mở Khóa (Từ 69.000đ)",
      modalDemoBtn: "Trải Nghiệm Bản Tóm Tắt Mẫu",
    },
    auth: {
      myAccount: "Tài khoản của tôi",
      signInTitle: "Đăng nhập ClutchArena",
      createAccountTitle: "Tạo tài khoản miễn phí",
      accountDesc: "Quản lý tài khoản học tập ClutchArena, hạn mức và tùy chọn của bạn.",
      guestDesc: "Đăng nhập để đồng bộ bộ đề trên mọi thiết bị, lưu tiến độ học tập và thi đấu tại đấu trường.",
      guestLimitTitle: "Đã hết lượt dùng thử cho Khách",
      guestLimitDesc: "Bạn đã dùng hết 2 lượt tạo đề miễn phí cho khách. Hãy tạo tài khoản miễn phí để tiếp tục tải tài liệu, lưu bộ đề đám mây và thi đấu nhiều người!",
      localDevMode: "🛠️ Chế độ Phát triển Cục bộ",
      cloudSync: "Đồng bộ đám mây",
      activeStatus: "Đang bật ✓",
      planTier: "Gói hiện tại",
      daysLeft: "ngày còn lại",
      signOut: "Đăng xuất",
      signInTab: "Đăng nhập",
      signUpTab: "Đăng ký",
      continueGoogle: "Tiếp tục với Google",
      continueGithub: "Tiếp tục với GitHub",
      orEmail: "hoặc dùng email",
      emailLabel: "Địa chỉ Email",
      passwordLabel: "Mật khẩu",
      processing: "Đang xử lý...",
      createFreeAccountBtn: "Tạo tài khoản miễn phí",
      guestStudent: "Sinh viên (Khách)",
      accountSuffix: "Tài khoản",
      usedWord: "đã dùng",
      freeBadge: "Miễn phí",
      guestBadge: "Khách",
      userIdLabel: "Mã người dùng:",
      localDevNote: "Thông tin xác thực Supabase Auth chưa được cấu hình trong .env.local. Hãy thêm NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY để bật tính năng xác thực.",
      tierContender: "Clutch Miễn phí",
      tierCramPass: "Vé Ôn Cấp Tốc (7 Ngày)",
      tierPro: "Đấu Sĩ Pro (Học Kỳ)",
      tierTutor: "Giảng Viên & Nhóm Học (Tutor)",
      enterBothEmailPassword: "Vui lòng nhập cả email và mật khẩu.",
      signInError: "Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.",
      signUpError: "Tạo tài khoản thất bại.",
      signUpSuccess: "Tài khoản đã tạo thành công! Vui lòng kiểm tra email để xác thực, hoặc đăng nhập ngay.",
      oauthError: "Đăng nhập qua dịch vụ liên kết thất bại.",
    },
    pricing: {
      vietQrHeader: "Quét mã VietQR (MoMo, ZaloPay, Mọi Ngân Hàng)",
      selectedPlanLabel: "Gói đăng ký",
      bankLabel: "Ngân hàng:",
      accountNumberLabel: "Số tài khoản:",
      accountNameLabel: "Chủ tài khoản:",
      transferNoteLabel: "Nội dung chuyển khoản:",
      checkingPaymentBtn: "Đang kiểm tra xác thực giao dịch...",
      verifyPaymentBtn: "Kiểm tra trạng thái thanh toán",
      openPayosPortal: "Mở cổng thanh toán PayOS",
      securityNote: "Bảo mật 100% · Hệ thống tự động kích hoạt sau khi ngân hàng xác nhận giao dịch.",
      copyAccountTitle: "Sao chép số tài khoản",
      copyNoteTitle: "Sao chép nội dung",
      globalCardsLabel: "Apple Pay · Google Pay · Thẻ tín dụng & Thẻ ghi nợ",
      globalSecurityNote: "Thanh toán an toàn qua cổng LemonSqueezy Merchant of Record. Đảm bảo tuân thủ thuế quốc tế.",
      backToPlans: "Quay lại danh sách gói",
      autoVerifiedIn3s: "Xác nhận tự động trong 3 giây",
      payosLinkedBank: "Ngân hàng liên kết PayOS",
    },
    tutorial: {
      quickTourBadge: "Hướng dẫn nhanh",
      stepWord: "Bước",
      ofWord: "trên",
      skipBtn: "Bỏ qua hướng dẫn",
      backBtn: "Quay lại",
      nextBtn: "Tiếp theo",
      closeExploreBtn: "Đóng & Khám phá",
      playSampleBtn: "Thực hành với Bộ đề mẫu (Kinh tế vi mô)",
      uploadOwnBtn: "Tải lên Tài liệu Môn học Của Tôi",
      closeAria: "Đóng hướng dẫn",
      goToStepAria: "Chuyển đến bước",
      andWord: "và",
      // Step 0
      step0Title: "Chào mừng đến với Clutch Arena",
      step0Desc: "Clutch Arena biến slide bài giảng, file PDF, ghi chú và đề cương thi của bạn thành các bài luyện tập chủ động năng suất cao và đấu trường đối kháng nhiều người chơi theo thời gian thực.",
      step0Feature1Title: "Nạp Bất Kỳ Tài Liệu Học Tập Nào",
      step0Feature1Desc: "AI phân tích tài liệu và tự động tạo các câu hỏi trắc nghiệm kèm trích dẫn nguồn đã được xác thực.",
      step0Feature2Title: "Luyện Thi Tốc Độ (Solo)",
      step0Feature2Desc: "Đồng hồ đếm ngược 15 giây, chuỗi combo điểm số, chế độ flashcard và các bài tập tăng tốc khắc phục điểm yếu.",
      step0Feature3Title: "Đấu Trường Học Tập Trực Tiếp",
      step0Feature3Desc: "Tranh tài bấm chuông theo thời gian thực với bạn cùng lớp hoặc bot thích ứng qua edge WebSockets.",
      // Step 1
      step1Title: "1. Tải Lên Ghi Chú & Nạp Câu Hỏi Bằng AI",
      step1Desc: "Không còn mất hàng giờ gõ flashcard thủ công. Chỉ cần tải tài liệu học tập của bạn lên trong tab Nạp tài liệu.",
      step1SampleFile: "Slide_Bai_Giang_Tuan_1_5.pdf",
      step1FormatsPrefix: "Hỗ trợ các định dạng ",
      step1FormatsSuffix: ".",
      step1SupportedFormats: "Hỗ trợ các tệp định dạng PDF, DOCX, PPTX và TXT.",
      step1Bullet1: "Trích xuất các định nghĩa cốt lõi, định luật và công thức định lượng",
      step1Bullet2: 'Tạo biến thể câu hỏi "Song sinh ý niệm" để chống việc học vẹt',
      step1Bullet3: "Ghim chính xác đoạn trích từ giáo trình/slide bài giảng vào từng câu hỏi",
      // Step 2
      step2Title: "2. Luyện Thi Tốc Độ (Ví dụ: Kinh tế Vi mô)",
      step2Desc: "Mọi câu hỏi đều có nguồn trích dẫn rõ ràng, tuyệt đối không ảo giác. Dưới đây là ví dụ một câu hỏi trong bộ đề Kinh tế Vi mô:",
      step2DescPrefix: "Mọi câu hỏi đều có ",
      step2DescHighlight: "trích dẫn nguồn tuyệt đối không ảo giác",
      step2DescSuffix: ". Dưới đây là giao diện câu hỏi trong bộ đề mẫu Kinh tế Vi mô:",
      step2SampleBadge: "Kinh tế Vi mô Chương 5",
      step2SampleClock: "Thời gian 15s",
      step2SampleQuestion: "Một doanh nghiệp cạnh tranh nhận thấy Doanh thu biên (50$) vượt quá Chi phí biên (45$). Để tối đa hóa lợi nhuận, doanh nghiệp nên:",
      step2SampleOptionA: "A. Mở rộng sản lượng cho đến khi MR = MC",
      step2SampleOptionB: "B. Giảm sản lượng ngay lập tức",
      step2SampleCitation: "Trích dẫn: Chương 5 · Điều kiện lợi nhuận cận biên (Trang 142)",
      step2Footer: "Bấm vào trích dẫn sẽ mở Trình xem tài liệu trực tiếp đến đúng dòng nguyên văn trong ghi chú bài giảng của bạn.",
      // Step 3
      step3Title: "3. Gia Sư AI & Luyện Tập Trọng Điểm Điểm Yếu",
      step3Desc: "Clutch Arena theo dõi các lỗi sai và tạo các bài tập mục tiêu để bạn không lặp lại sai lầm trong ngày thi.",
      step3Topic1: "Thặng dư Tiêu dùng & Cân bằng",
      step3Mastery1: "100% Thành thạo",
      step3Topic2: "Tính toán Độ co giãn của Cầu",
      step3Mastery2: "40% Thành thạo (Điểm yếu)",
      step3Footer: "Gia sư AI sẽ tạo một đợt luyện 5 câu hỏi tập trung hoàn toàn vào các chủ đề yếu của bạn cho đến khi bạn thành thạo.",
      step3FooterPrefix: "Gia sư AI sẽ tạo một ",
      step3FooterHighlight: "đợt luyện nhanh 5 câu",
      step3FooterSuffix: " tập trung hoàn toàn vào các chủ đề còn yếu của bạn đến khi đạt độ nhuần nhuyễn.",
      // Step 4
      step4Title: "4. Đấu Trường Học Tập Trực Tiếp (Multiplayer)",
      step4Desc: "Biến các buổi tự học thành những màn tranh tài bấm chuông gay cấn theo thời gian thực cùng bạn bè.",
      step4RoomLabel: "PHÒNG: #ECON42",
      step4LiveBadge: "● WEBSOCKET TRỰC TIẾP",
      step4User1: "1. Kyle (Bạn)",
      step4Points1: "1.240 điểm ⚡",
      step4User2: "2. StudyBot-Alpha",
      step4Points2: "1.020 điểm",
      step4User3: "3. Alex",
      step4Points3: "880 điểm",
      step4SpeedPointsTitle: "Điểm tốc độ",
      step4SpeedPointsDesc: ": Người bấm chuông đúng nhanh nhất sẽ nhận thêm điểm kinh nghiệm thưởng.",
      step4AdaptiveBotsTitle: "Bot Thích ứng",
      step4AdaptiveBotsDesc: ": Tự động bổ sung bot nếu bạn luyện tập một mình vào đêm khuya.",
      // Step 5
      step5Title: "Sẵn Sàng Bứt Phá Điểm Thi?",
      step5Desc: "Hãy chọn cách bạn muốn bắt đầu: luyện tập ngay với bộ đề mẫu Kinh tế Vi mô, hoặc tải lên ghi chú bài giảng của riêng bạn!",
      step5DescPrefix: "Hãy chọn cách bạn muốn bắt đầu: luyện tập ngay với ",
      step5DescHighlight: "bộ đề mẫu Kinh tế Vi mô",
      step5DescSuffix: ", hoặc tải lên ghi chú bài giảng của riêng bạn!",
    },
    common: {
      errorTitle: "Hãy thử lại một lần nữa nhé.",
      errorDesc: "Có sự cố nhỏ làm gián đoạn phiên học. Hãy làm mới để quay lại bài thi của bạn.",
      errorFallback: "Có sự cố nhỏ làm gián đoạn phiên học. Hãy làm mới để quay lại bài thi của bạn.",
      tryAgain: "Thử lại",
      tryAgainBtn: "Thử lại",
      loadingText: "Đang chuẩn bị không gian ôn tập cho bạn…",
    },
  },
};
