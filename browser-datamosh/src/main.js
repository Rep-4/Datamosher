// File: src/main.js

import "./style.css";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  fetchFile,
  toBlobURL
} from "@ffmpeg/util";

const elements = {
  engineState: document.querySelector("#engineState"),
  fileInput: document.querySelector("#fileInput"),
  videoTree: document.querySelector("#videoTree"),
  treeStatus: document.querySelector("#treeStatus"),
  clearFilesButton: document.querySelector("#clearFilesButton"),

  sourcePreview: document.querySelector("#sourcePreview"),
  previewPlaceholder: document.querySelector("#previewPlaceholder"),
  previewFileName: document.querySelector("#previewFileName"),
  previewMetadata: document.querySelector("#previewMetadata"),

  analysisNotice: document.querySelector("#analysisNotice"),
  analysisProgress: document.querySelector("#analysisProgress"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  progressTrack: document.querySelector("#progressTrack"),
  progressBar: document.querySelector("#progressBar"),
  progressDetail: document.querySelector("#progressDetail"),

  widthInput: document.querySelector("#widthInput"),
  heightInput: document.querySelector("#heightInput"),
  fpsInput: document.querySelector("#fpsInput"),
  gopInput: document.querySelector("#gopInput"),
  prepareButton: document.querySelector("#prepareButton"),
  resetButton: document.querySelector("#resetButton"),

  editedPreview: document.querySelector("#editedPreview"),
  editedPreviewStatus: document.querySelector("#editedPreviewStatus"),
  editedPreviewPlaceholder: document.querySelector(
    "#editedPreviewPlaceholder"
  ),
  editedPreviewBusy: document.querySelector("#editedPreviewBusy"),
  editedPreviewTime: document.querySelector("#editedPreviewTime"),
  editedPreviewFrame: document.querySelector("#editedPreviewFrame"),

  timelineEmpty: document.querySelector("#timelineEmpty"),
  timelineArea: document.querySelector("#timelineArea"),
  timelineCanvas: document.querySelector("#timelineCanvas"),
  timelineSlider: document.querySelector("#timelineSlider"),
  timelineScale: document.querySelector("#timelineScale"),

  frameNumberInput: document.querySelector("#frameNumberInput"),
  duplicateCountInput: document.querySelector("#duplicateCountInput"),
  selectFrameButton: document.querySelector("#selectFrameButton"),
  duplicateButton: document.querySelector("#duplicateButton"),
  deleteIFrameButton: document.querySelector("#deleteIFrameButton"),
  seamButton: document.querySelector("#seamButton"),
  selectedFrameInfo: document.querySelector("#selectedFrameInfo"),
  frameTableBody: document.querySelector("#frameTableBody"),

  outputNameInput: document.querySelector("#outputNameInput"),
  exportButton: document.querySelector("#exportButton"),
  logOutput: document.querySelector("#logOutput")
};

const ffmpeg = new FFmpeg();

let ffmpegLoaded = false;
let processing = false;

let videoEntries = [];
let selectedVideoEntryId = null;
let draggedVideoEntryId = null;
let previewObjectURL = null;
let nextVideoEntryId = 1;

let parsedClips = [];
let originalFrames = [];
let workingFrames = [];
let selectedFrameIndex = 0;
let baseAvi = null;
let seamOperationApplied = false;
let nextFrameId = 1;

let analysisDirty = false;
let displayedProgress = 0;

let progressContext = {
  active: false,
  clipIndex: 0,
  clipCount: 0,
  fileName: ""
};

let analyzedFps = 30;
let editedPreviewObjectURL = null;
let editedPreviewRendering = false;
let editedPreviewRenderTimer = null;
let editedPreviewRequestedVersion = 0;
let editedPreviewCompletedVersion = 0;
let previewSynchronizationLocked = false;
let analysisSucceeded = false;

ffmpeg.on("log", ({ message }) => {
  appendLog(message);
});

ffmpeg.on("progress", ({ progress }) => {
  if (
    !progressContext.active ||
    !Number.isFinite(progress)
  ) {
    return;
  }

  const localProgress = clamp(progress, 0, 1);
  const totalProgress =
    (
      progressContext.clipIndex +
      localProgress
    ) /
    Math.max(progressContext.clipCount, 1);

  setAnalysisProgress(
    totalProgress * 100,
    `動画 ${progressContext.clipIndex + 1} / ` +
    `${progressContext.clipCount} を変換中`,
    `${progressContext.fileName} — ` +
    `変換 ${Math.round(localProgress * 100)}%`,
    "processing"
  );
});

elements.fileInput.addEventListener(
  "change",
  handleFileSelection
);

elements.clearFilesButton.addEventListener(
  "click",
  clearVideoEntries
);

elements.sourcePreview.addEventListener(
  "loadedmetadata",
  updatePreviewMetadata
);

elements.sourcePreview.addEventListener(
  "error",
  handlePreviewError
);

elements.prepareButton.addEventListener(
  "click",
  prepareVideos
);

elements.resetButton.addEventListener(
  "click",
  resetEdits
);

elements.selectFrameButton.addEventListener(
  "click",
  selectFrameByInput
);

elements.timelineSlider.addEventListener(
  "input",
  selectFrameBySlider
);

elements.timelineCanvas.addEventListener(
  "click",
  selectFrameFromCanvas
);

elements.duplicateButton.addEventListener(
  "click",
  duplicateSelectedPFrame
);

elements.deleteIFrameButton.addEventListener(
  "click",
  deleteSelectedIFrame
);

elements.seamButton.addEventListener(
  "click",
  removeSeamIFrames
);

elements.exportButton.addEventListener(
  "click",
  exportAvi
);

elements.editedPreview.addEventListener(
  "timeupdate",
  synchronizeTimelineFromPreview
);

elements.editedPreview.addEventListener(
  "seeking",
  synchronizeTimelineFromPreview
);

elements.editedPreview.addEventListener(
  "loadedmetadata",
  handleEditedPreviewMetadata
);

elements.editedPreview.addEventListener(
  "play",
  updateEditedPreviewStatus
);

elements.editedPreview.addEventListener(
  "pause",
  updateEditedPreviewStatus
);

elements.editedPreview.addEventListener(
  "ended",
  updateEditedPreviewStatus
);

elements.editedPreview.addEventListener(
  "error",
  handleEditedPreviewError
);

window.addEventListener(
  "keydown",
  handleGlobalPlaybackShortcut
);

[
  elements.widthInput,
  elements.heightInput,
  elements.fpsInput,
  elements.gopInput
].forEach((input) => {
  input.addEventListener("change", () => {
    if (videoEntries.length > 0) {
      markAnalysisDirty();
    }
  });
});

window.addEventListener("resize", drawTimeline);

window.addEventListener("beforeunload", () => {
  releasePreviewObjectURL();
  releaseEditedPreviewObjectURL();
});

renderVideoTree();

setAnalysisProgress(
  0,
  "解析待機中",
  "処理は開始されていません。",
  "idle",
  true
);

updateInterface();

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;

  if (elements.logOutput.textContent === "待機中") {
    elements.logOutput.textContent = line;
  } else {
    elements.logOutput.textContent += `\n${line}`;
  }

  elements.logOutput.scrollTop =
    elements.logOutput.scrollHeight;
}

function setEngineState(text, type) {
  elements.engineState.textContent = text;
  elements.engineState.className = `state state-${type}`;
}

function setAnalysisProgress(
  percent,
  label,
  detail,
  state = "processing",
  allowDecrease = false
) {
  let normalized = Number.isFinite(percent)
    ? clamp(percent, 0, 100)
    : 0;

  if (
    state === "processing" &&
    !allowDecrease
  ) {
    normalized = Math.max(
      displayedProgress,
      normalized
    );
  }

  displayedProgress = normalized;

  elements.progressLabel.textContent = label;
  elements.progressPercent.textContent =
    `${Math.round(normalized)}%`;

  elements.progressBar.style.width =
    `${normalized}%`;

  elements.progressTrack.setAttribute(
    "aria-valuenow",
    String(Math.round(normalized))
  );

  elements.progressDetail.textContent = detail;

  elements.analysisProgress.classList.remove(
    "processing",
    "error"
  );

  if (state === "processing") {
    elements.analysisProgress.classList.add(
      "processing"
    );
  }

  if (state === "error") {
    elements.analysisProgress.classList.add(
      "error"
    );
  }
}

function handleFileSelection() {
  const files = [...elements.fileInput.files];

  if (files.length === 0) {
    return;
  }

  for (const file of files) {
    videoEntries.push({
      id: nextVideoEntryId,
      file
    });

    nextVideoEntryId += 1;
  }

  if (
    selectedVideoEntryId === null &&
    videoEntries.length > 0
  ) {
    selectedVideoEntryId = videoEntries[0].id;
  }

  elements.fileInput.value = "";

  markAnalysisDirty();
  renderVideoTree();
  updateSourcePreview();
  updateInterface();
}

function renderVideoTree() {
  elements.clearFilesButton.disabled =
    processing || videoEntries.length === 0;

  if (videoEntries.length === 0) {
    const empty = document.createElement("div");

    empty.className = "tree-empty";
    empty.textContent =
      "動画ファイルを追加してください。";

    elements.videoTree.replaceChildren(empty);
    elements.treeStatus.textContent =
      "動画が登録されていません。";

    return;
  }

  const root = document.createElement("ul");
  const rootItem = document.createElement("li");
  const rootLabel = document.createElement("div");
  const children = document.createElement("ul");

  root.className = "tree-root";
  root.setAttribute("role", "tree");

  rootItem.setAttribute("role", "treeitem");
  rootItem.setAttribute("aria-expanded", "true");

  rootLabel.className = "tree-root-label";
  rootLabel.textContent =
    `連結動画プロジェクト（${videoEntries.length}本）`;

  children.className = "tree-children";
  children.setAttribute("role", "group");

  videoEntries.forEach((entry, index) => {
    children.append(
      createVideoTreeItem(entry, index)
    );
  });

  rootItem.append(rootLabel, children);
  root.append(rootItem);
  elements.videoTree.replaceChildren(root);

  const totalSize = videoEntries.reduce(
    (sum, entry) => sum + entry.file.size,
    0
  );

  elements.treeStatus.textContent =
    `${videoEntries.length}本 / ` +
    `${formatFileSize(totalSize)} / 上から順に連結`;
}

function createVideoTreeItem(entry, index) {
  const item = document.createElement("li");
  const handle = document.createElement("span");
  const information = document.createElement("div");
  const name = document.createElement("div");
  const details = document.createElement("div");
  const actions = document.createElement("div");

  item.className = "tree-video-item";
  item.draggable = !processing;
  item.dataset.entryId = String(entry.id);
  item.setAttribute("role", "treeitem");
  item.tabIndex = 0;

  if (entry.id === selectedVideoEntryId) {
    item.classList.add("selected");
    item.setAttribute("aria-selected", "true");
  } else {
    item.setAttribute("aria-selected", "false");
  }

  handle.className = "tree-drag-handle";
  handle.textContent = "⠿";
  handle.title = "ドラッグして順序を変更";

  information.className = "tree-file-information";

  name.className = "tree-file-name";
  name.textContent = `${index + 1}. ${entry.file.name}`;
  name.title = entry.file.name;

  details.className = "tree-file-details";
  details.textContent =
    `${formatFileSize(entry.file.size)} / ` +
    `${entry.file.type || "形式不明"}`;

  actions.className = "tree-file-actions";

  actions.append(
    createTreeActionButton(
      "↑",
      "上へ移動",
      index === 0 || processing,
      () => moveVideoEntry(index, index - 1)
    ),
    createTreeActionButton(
      "↓",
      "下へ移動",
      index === videoEntries.length - 1 || processing,
      () => moveVideoEntry(index, index + 1)
    ),
    createTreeActionButton(
      "×",
      "この動画を削除",
      processing,
      () => removeVideoEntry(entry.id),
      "tree-delete-button"
    )
  );

  information.append(name, details);
  item.append(handle, information, actions);

  item.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    selectVideoEntry(entry.id);
  });

  item.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      selectVideoEntry(entry.id);
    }

    if (
      event.key === "ArrowUp" &&
      index > 0
    ) {
      event.preventDefault();
      moveVideoEntry(index, index - 1);
    }

    if (
      event.key === "ArrowDown" &&
      index < videoEntries.length - 1
    ) {
      event.preventDefault();
      moveVideoEntry(index, index + 1);
    }

    if (event.key === "Delete") {
      event.preventDefault();
      removeVideoEntry(entry.id);
    }
  });

  item.addEventListener("dragstart", (event) => {
    if (processing) {
      event.preventDefault();
      return;
    }

    draggedVideoEntryId = entry.id;
    item.classList.add("dragging");

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      String(entry.id)
    );
  });

  item.addEventListener("dragover", (event) => {
    if (
      processing ||
      draggedVideoEntryId === entry.id
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    clearDragIndicators();

    const rectangle = item.getBoundingClientRect();
    const insertAfter =
      event.clientY >
      rectangle.top + rectangle.height / 2;

    item.classList.add(
      insertAfter
        ? "drag-over-after"
        : "drag-over-before"
    );
  });

  item.addEventListener("drop", (event) => {
    event.preventDefault();

    const sourceId = Number.parseInt(
      event.dataTransfer.getData("text/plain"),
      10
    );

    const sourceIndex = videoEntries.findIndex(
      (candidate) => candidate.id === sourceId
    );

    const targetIndex = videoEntries.findIndex(
      (candidate) => candidate.id === entry.id
    );

    if (
      sourceIndex < 0 ||
      targetIndex < 0 ||
      sourceIndex === targetIndex
    ) {
      finishDragging();
      return;
    }

    const rectangle = item.getBoundingClientRect();
    const insertAfter =
      event.clientY >
      rectangle.top + rectangle.height / 2;

    reorderVideoEntry(
      sourceIndex,
      targetIndex,
      insertAfter
    );

    finishDragging();
  });

  item.addEventListener(
    "dragend",
    finishDragging
  );

  return item;
}

function createTreeActionButton(
  text,
  title,
  disabled,
  handler,
  className = ""
) {
  const button = document.createElement("button");

  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;

  if (className) {
    button.className = className;
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });

  return button;
}

function selectVideoEntry(entryId) {
  selectedVideoEntryId = entryId;
  renderVideoTree();
  updateSourcePreview();
}

function moveVideoEntry(sourceIndex, targetIndex) {
  if (
    processing ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= videoEntries.length ||
    targetIndex >= videoEntries.length
  ) {
    return;
  }

  const [entry] = videoEntries.splice(
    sourceIndex,
    1
  );

  videoEntries.splice(targetIndex, 0, entry);

  markAnalysisDirty();
  renderVideoTree();
  updateInterface();
}

function reorderVideoEntry(
  sourceIndex,
  targetIndex,
  insertAfter
) {
  const [entry] = videoEntries.splice(
    sourceIndex,
    1
  );

  let insertionIndex = targetIndex;

  if (sourceIndex < targetIndex) {
    insertionIndex -= 1;
  }

  if (insertAfter) {
    insertionIndex += 1;
  }

  insertionIndex = clampInteger(
    insertionIndex,
    0,
    0,
    videoEntries.length
  );

  videoEntries.splice(
    insertionIndex,
    0,
    entry
  );

  markAnalysisDirty();
  renderVideoTree();
  updateInterface();
}

function removeVideoEntry(entryId) {
  if (processing) {
    return;
  }

  const index = videoEntries.findIndex(
    (entry) => entry.id === entryId
  );

  if (index < 0) {
    return;
  }

  const wasSelected =
    selectedVideoEntryId === entryId;

  videoEntries.splice(index, 1);

  if (wasSelected) {
    const nextEntry =
      videoEntries[
      Math.min(index, videoEntries.length - 1)
      ];

    selectedVideoEntryId =
      nextEntry?.id ?? null;
  }

  markAnalysisDirty();
  renderVideoTree();
  updateSourcePreview();
  updateInterface();
}

function clearVideoEntries() {
  if (
    processing ||
    videoEntries.length === 0
  ) {
    return;
  }

  const confirmed = window.confirm(
    "入力動画をすべて削除しますか？\n" +
    "以前の解析結果は再解析するまで残ります。"
  );

  if (!confirmed) {
    return;
  }

  videoEntries = [];
  selectedVideoEntryId = null;

  releasePreviewObjectURL();
  resetPreviewDisplay();

  markAnalysisDirty();
  renderVideoTree();
  updateInterface();
}

function clearDragIndicators() {
  document
    .querySelectorAll(
      ".drag-over-before, .drag-over-after"
    )
    .forEach((element) => {
      element.classList.remove(
        "drag-over-before",
        "drag-over-after"
      );
    });
}

function finishDragging() {
  draggedVideoEntryId = null;

  document
    .querySelectorAll(".tree-video-item")
    .forEach((element) => {
      element.classList.remove("dragging");
    });

  clearDragIndicators();
}

function markAnalysisDirty() {
  analysisDirty = true;

  elements.analysisNotice.className =
    "analysis-notice dirty";

  if (workingFrames.length > 0) {
    elements.analysisNotice.textContent =
      "入力動画または変換設定が変更されています。" +
      "「動画を解析」をもう一度押すと、変更が反映されます。";
  } else if (videoEntries.length > 0) {
    elements.analysisNotice.textContent =
      "入力動画が変更されました。" +
      "「動画を解析」を押してください。";
  } else {
    elements.analysisNotice.textContent =
      "動画を追加して「動画を解析」を押してください。";
  }
}

function updateSourcePreview() {
  const entry = videoEntries.find(
    (candidate) =>
      candidate.id === selectedVideoEntryId
  );

  releasePreviewObjectURL();

  if (!entry) {
    resetPreviewDisplay();
    return;
  }

  previewObjectURL =
    URL.createObjectURL(entry.file);

  elements.sourcePreview.pause();
  elements.sourcePreview.removeAttribute("src");
  elements.sourcePreview.load();

  elements.sourcePreview.src = previewObjectURL;
  elements.sourcePreview.classList.add("visible");
  elements.previewPlaceholder.classList.add("hidden");
  elements.previewFileName.textContent =
    entry.file.name;

  elements.previewMetadata.textContent =
    `${formatFileSize(entry.file.size)} / ` +
    `${entry.file.type || "形式不明"} / ` +
    "メタデータを読み込み中";

  elements.sourcePreview.load();
}

function updatePreviewMetadata() {
  const video = elements.sourcePreview;
  const entry = videoEntries.find(
    (candidate) =>
      candidate.id === selectedVideoEntryId
  );

  if (!entry) {
    return;
  }

  const dimensions =
    video.videoWidth > 0 && video.videoHeight > 0
      ? `${video.videoWidth} × ${video.videoHeight}`
      : "解像度不明";

  elements.previewMetadata.textContent =
    `${dimensions} / ` +
    `${formatDuration(video.duration)} / ` +
    `${formatFileSize(entry.file.size)} / ` +
    `${entry.file.type || "形式不明"}`;
}

function handlePreviewError() {
  const entry = videoEntries.find(
    (candidate) =>
      candidate.id === selectedVideoEntryId
  );

  elements.previewMetadata.textContent =
    "この形式はブラウザでプレビューできません。" +
    "FFmpegで解析できる場合はあります。";

  if (entry) {
    elements.previewFileName.textContent =
      `${entry.file.name} — プレビュー非対応`;
  }
}

function resetPreviewDisplay() {
  elements.sourcePreview.pause();
  elements.sourcePreview.removeAttribute("src");
  elements.sourcePreview.load();
  elements.sourcePreview.classList.remove("visible");

  elements.previewPlaceholder.classList.remove("hidden");
  elements.previewFileName.textContent =
    "動画を選択してください。";
  elements.previewMetadata.textContent =
    "プレビュー情報はありません。";
}

function releasePreviewObjectURL() {
  if (!previewObjectURL) {
    return;
  }

  URL.revokeObjectURL(previewObjectURL);
  previewObjectURL = null;
}

function seekEditedPreviewToSelectedFrame() {
  const video = elements.editedPreview;

  if (
    !video.src ||
    video.readyState < HTMLMediaElement.HAVE_METADATA ||
    workingFrames.length === 0
  ) {
    updateEditedPreviewPositionDisplay();
    return;
  }

  const targetTime =
    selectedFrameIndex /
    Math.max(analyzedFps, 1);

  const maximumTime = Number.isFinite(video.duration)
    ? Math.max(0, video.duration - 0.001)
    : targetTime;

  previewSynchronizationLocked = true;

  video.currentTime = Math.min(
    targetTime,
    maximumTime
  );

  window.requestAnimationFrame(() => {
    previewSynchronizationLocked = false;
  });

  updateEditedPreviewPositionDisplay();
}

function synchronizeTimelineFromPreview() {
  const video = elements.editedPreview;

  updateEditedPreviewPositionDisplay();

  if (
    previewSynchronizationLocked ||
    workingFrames.length === 0 ||
    !Number.isFinite(video.currentTime)
  ) {
    return;
  }

  const frameIndex = Math.min(
    workingFrames.length - 1,
    Math.max(
      0,
      Math.floor(
        video.currentTime *
        Math.max(analyzedFps, 1)
      )
    )
  );

  if (frameIndex === selectedFrameIndex) {
    return;
  }

  selectedFrameIndex = frameIndex;
  updateInterface();
}

function updateEditedPreviewPositionDisplay() {
  const video = elements.editedPreview;

  const currentTime = Number.isFinite(video.currentTime)
    ? video.currentTime
    : 0;

  const duration = Number.isFinite(video.duration)
    ? video.duration
    : workingFrames.length /
    Math.max(analyzedFps, 1);

  elements.editedPreviewTime.textContent =
    `${formatPreciseDuration(currentTime)} / ` +
    `${formatPreciseDuration(duration)}`;

  if (workingFrames.length === 0) {
    elements.editedPreviewFrame.textContent =
      "フレーム -- / --";

    return;
  }

  elements.editedPreviewFrame.textContent =
    `フレーム ${selectedFrameIndex + 1} / ` +
    `${workingFrames.length}`;
}

function formatPreciseDuration(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "00:00.000";
  }

  const milliseconds =
    Math.floor(seconds * 1000) % 1000;

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);

  const minutes = Math.floor(
    totalSeconds % 3600 / 60
  );

  const remainingSeconds =
    totalSeconds % 60;

  const base = [
    String(minutes).padStart(2, "0"),
    String(remainingSeconds).padStart(2, "0")
  ].join(":");

  const fraction =
    String(milliseconds).padStart(3, "0");

  if (hours > 0) {
    return (
      `${String(hours).padStart(2, "0")}:` +
      `${base}.${fraction}`
    );
  }

  return `${base}.${fraction}`;
}

function handleGlobalPlaybackShortcut(event) {
  if (
    event.key !== "Shift" ||
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return;
  }

  if (isEditableElement(event.target)) {
    return;
  }

  if (
    !elements.editedPreview.src ||
    editedPreviewRendering
  ) {
    return;
  }

  event.preventDefault();
  toggleEditedPreviewPlayback();
}

function isEditableElement(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, button, " +
      "[contenteditable='true']"
    )
  );
}

async function toggleEditedPreviewPlayback() {
  const video = elements.editedPreview;

  if (!video.src) {
    return;
  }

  if (video.paused || video.ended) {
    if (video.ended) {
      video.currentTime = 0;
    }

    try {
      await video.play();
    } catch (error) {
      appendLog(
        `プレビュー再生エラー: ` +
        `${getErrorMessage(error)}`
      );
    }

    return;
  }

  video.pause();
}

function updateEditedPreviewStatus() {
  const video = elements.editedPreview;

  if (editedPreviewRendering) {
    return;
  }

  if (!video.src) {
    elements.editedPreviewStatus.textContent =
      "動画を解析するとプレビューが生成されます。";

    return;
  }

  if (video.ended) {
    elements.editedPreviewStatus.textContent =
      "再生が終了しました。Shiftで先頭から再生できます。";

    return;
  }

  elements.editedPreviewStatus.textContent =
    video.paused
      ? "停止中 — Shiftで再生"
      : "再生中 — Shiftで停止";
}

function scheduleEditedPreviewRender(
  delay = 250
) {
  if (
    !ffmpegLoaded ||
    !baseAvi ||
    workingFrames.length === 0
  ) {
    return;
  }

  editedPreviewRequestedVersion += 1;

  window.clearTimeout(
    editedPreviewRenderTimer
  );

  elements.editedPreviewStatus.textContent =
    "編集内容が変更されました。プレビューを更新します。";

  editedPreviewRenderTimer =
    window.setTimeout(() => {
      runEditedPreviewRenderQueue();
    }, delay);
}

async function runEditedPreviewRenderQueue() {
  if (
    editedPreviewRendering ||
    processing ||
    !baseAvi ||
    workingFrames.length === 0
  ) {
    return;
  }

  editedPreviewRendering = true;

  elements.editedPreviewBusy.classList.remove(
    "hidden"
  );

  elements.editedPreviewStatus.textContent =
    "編集結果プレビューを生成しています。";

  updateInterface();

  try {
    while (
      editedPreviewCompletedVersion <
      editedPreviewRequestedVersion &&
      !processing
    ) {
      const targetVersion =
        editedPreviewRequestedVersion;

      await renderEditedPreview(targetVersion);

      editedPreviewCompletedVersion =
        targetVersion;
    }
  } catch (error) {
    const message = getErrorMessage(error);

    elements.editedPreviewStatus.textContent =
      "プレビューの生成に失敗しました。";

    appendLog(
      `編集結果プレビュー生成エラー: ${message}`
    );

    console.error(error);
  } finally {
    editedPreviewRendering = false;

    elements.editedPreviewBusy.classList.add(
      "hidden"
    );

    updateEditedPreviewStatus();
    updateInterface();

    if (
      editedPreviewCompletedVersion <
      editedPreviewRequestedVersion
    ) {
      scheduleEditedPreviewRender(50);
    }
  }
}

async function renderEditedPreview(version) {
  const frameSnapshot = workingFrames.map(
    cloneFrame
  );

  const selectedTime =
    selectedFrameIndex /
    Math.max(analyzedFps, 1);

  const resumePlayback =
    !elements.editedPreview.paused &&
    !elements.editedPreview.ended;

  const aviBytes = buildAvi(
    baseAvi,
    frameSnapshot
  );

  const inputName =
    `edited-preview-${version}.avi`;

  const outputName =
    `edited-preview-${version}.mp4`;

  appendLog(
    `プレビュー生成: ` +
    `${frameSnapshot.length}フレーム`
  );

  try {
    await deleteVirtualFileIfPresent(
      inputName
    );

    await deleteVirtualFileIfPresent(
      outputName
    );

    await ffmpeg.writeFile(
      inputName,
      aviBytes
    );

    const exitCode = await ffmpeg.exec([
      "-fflags",
      "+discardcorrupt",
      "-err_detect",
      "ignore_err",
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      outputName
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `プレビュー変換に失敗しました。` +
        `終了コード: ${exitCode}`
      );
    }

    const result =
      await ffmpeg.readFile(outputName);

    const previewBytes =
      new Uint8Array(result);

    if (previewBytes.byteLength === 0) {
      throw new Error(
        "生成されたプレビューが空です。"
      );
    }

    applyEditedPreviewBlob(
      previewBytes,
      selectedTime,
      resumePlayback
    );

    appendLog(
      `プレビュー更新完了: ` +
      `${formatFileSize(previewBytes.byteLength)}`
    );
  } finally {
    await deleteVirtualFileIfPresent(
      inputName
    );

    await deleteVirtualFileIfPresent(
      outputName
    );
  }
}

async function deleteVirtualFileIfPresent(
  fileName
) {
  try {
    await ffmpeg.deleteFile(fileName);
  } catch {
    // 存在しない仮想ファイルは無視します。
  }
}

function applyEditedPreviewBlob(
  bytes,
  targetTime,
  resumePlayback
) {
  const blob = new Blob(
    [bytes],
    {
      type: "video/mp4"
    }
  );

  const nextObjectURL =
    URL.createObjectURL(blob);

  const previousObjectURL =
    editedPreviewObjectURL;

  editedPreviewObjectURL =
    nextObjectURL;

  elements.editedPreview.pause();
  elements.editedPreview.src =
    nextObjectURL;

  elements.editedPreview.classList.add(
    "visible"
  );

  elements.editedPreviewPlaceholder.classList.add(
    "hidden"
  );

  elements.editedPreview.addEventListener(
    "loadedmetadata",
    async () => {
      const maximumTime =
        Number.isFinite(
          elements.editedPreview.duration
        )
          ? Math.max(
            0,
            elements.editedPreview.duration - 0.001
          )
          : targetTime;

      elements.editedPreview.currentTime =
        Math.min(targetTime, maximumTime);

      updateEditedPreviewPositionDisplay();

      if (resumePlayback) {
        try {
          await elements.editedPreview.play();
        } catch {
          elements.editedPreviewStatus.textContent =
            "更新後の自動再生が拒否されました。" +
            "Shiftで再生してください。";
        }
      }
    },
    {
      once: true
    }
  );

  elements.editedPreview.load();

  if (previousObjectURL) {
    window.setTimeout(() => {
      URL.revokeObjectURL(
        previousObjectURL
      );
    }, 1000);
  }
}

function handleEditedPreviewMetadata() {
  updateEditedPreviewPositionDisplay();
  updateEditedPreviewStatus();
}

function handleEditedPreviewError() {
  if (editedPreviewRendering) {
    return;
  }

  elements.editedPreviewStatus.textContent =
    "生成したプレビューをブラウザで再生できませんでした。";
}

function releaseEditedPreviewObjectURL() {
  if (!editedPreviewObjectURL) {
    return;
  }

  URL.revokeObjectURL(
    editedPreviewObjectURL
  );

  editedPreviewObjectURL = null;
}

function resetEditedPreview() {
  window.clearTimeout(
    editedPreviewRenderTimer
  );

  editedPreviewRequestedVersion += 1;
  editedPreviewCompletedVersion =
    editedPreviewRequestedVersion;

  elements.editedPreview.pause();
  elements.editedPreview.removeAttribute(
    "src"
  );

  elements.editedPreview.load();
  elements.editedPreview.classList.remove(
    "visible"
  );

  elements.editedPreviewPlaceholder.classList.remove(
    "hidden"
  );

  elements.editedPreviewStatus.textContent =
    "動画を解析するとプレビューが生成されます。";

  releaseEditedPreviewObjectURL();
  updateEditedPreviewPositionDisplay();
}

async function ensureFFmpegLoaded() {
  if (ffmpegLoaded) {
    return;
  }

  setEngineState(
    "FFmpegを読み込み中",
    "working"
  );

  appendLog(
    "FFmpeg ESMコアを読み込んでいます。"
  );

  const assetBaseURL = new URL(
    `${import.meta.env.BASE_URL}ffmpeg-esm-0.12.10/`,
    window.location.origin
  );

  const cacheKey = Date.now();

  const coreSourceURL = new URL(
    `ffmpeg-core.js?v=${cacheKey}`,
    assetBaseURL
  ).href;

  const wasmSourceURL = new URL(
    `ffmpeg-core.wasm?v=${cacheKey}`,
    assetBaseURL
  ).href;

  try {
    appendLog("FFmpeg Coreを取得しています。");

    const coreURL = await toBlobURL(
      coreSourceURL,
      "text/javascript"
    );

    appendLog("FFmpeg WASMを取得しています。");

    const wasmURL = await toBlobURL(
      wasmSourceURL,
      "application/wasm"
    );

    appendLog("FFmpeg Workerを起動しています。");

    await ffmpeg.load({
      coreURL,
      wasmURL
    });

    ffmpegLoaded = true;

    setEngineState(
      "FFmpeg準備完了",
      "ready"
    );

    appendLog(
      "FFmpegコアの読み込みが完了しました。"
    );
  } catch (error) {
    ffmpegLoaded = false;

    setEngineState(
      "FFmpeg読込失敗",
      "error"
    );

    appendLog(
      `FFmpeg読込エラー: ${getErrorMessage(error)}`
    );

    throw error;
  }
}

async function prepareVideos() {
  if (
    processing ||
    editedPreviewRendering
  ) {
    return;
  }

  const files = videoEntries.map(
    (entry) => entry.file
  );

  if (files.length === 0) {
    alert("動画ファイルを1本以上追加してください。");
    return;
  }

  const width = normalizeEvenInteger(
    elements.widthInput.value,
    640,
    64,
    3840
  );

  const height = normalizeEvenInteger(
    elements.heightInput.value,
    360,
    64,
    2160
  );

  const fps = clampInteger(
    elements.fpsInput.value,
    30,
    1,
    60
  );

  const gop = clampInteger(
    elements.gopInput.value,
    90,
    2,
    600
  );

  elements.widthInput.value = width;
  elements.heightInput.value = height;
  elements.fpsInput.value = fps;
  elements.gopInput.value = gop;

  processing = true;
  analysisSucceeded = false;
  resetEditedPreview();
  parsedClips = [];
  originalFrames = [];
  workingFrames = [];
  baseAvi = null;
  selectedFrameIndex = 0;
  seamOperationApplied = false;
  nextFrameId = 1;
  displayedProgress = 0;

  elements.logOutput.textContent = "待機中";

  elements.analysisNotice.className =
    "analysis-notice";

  elements.analysisNotice.textContent =
    "現在のツリー順序で解析しています。";

  setControlsForProcessing(true);

  setAnalysisProgress(
    0,
    "解析を開始しています",
    `${files.length}本の動画を処理します。`,
    "processing",
    true
  );

  try {
    await ensureFFmpegLoaded();

    setAnalysisProgress(
      0,
      "FFmpeg準備完了",
      "動画の変換を開始します。",
      "processing",
      true
    );

    for (
      let index = 0;
      index < files.length;
      index += 1
    ) {
      const file = files[index];
      const inputName =
        createVirtualInputName(file, index);

      const outputName =
        `normalized-${index}.avi`;

      progressContext = {
        active: true,
        clipIndex: index,
        clipCount: files.length,
        fileName: file.name
      };

      const startPercent =
        index / files.length * 100;

      setAnalysisProgress(
        startPercent,
        `動画 ${index + 1} / ${files.length}`,
        `${file.name} を読み込み中`,
        "processing"
      );

      appendLog(
        `${index + 1}/${files.length}: ` +
        `${file.name} を読み込み中`
      );

      await ffmpeg.writeFile(
        inputName,
        await fetchFile(file)
      );

      setAnalysisProgress(
        startPercent,
        `動画 ${index + 1} / ${files.length}`,
        `${file.name} をAVIへ変換中`,
        "processing"
      );

      const exitCode = await ffmpeg.exec([
        "-i",
        inputName,
        "-map",
        "0:v:0",
        "-an",
        "-vf",
        `scale=${width}:${height}:` +
        "force_original_aspect_ratio=decrease," +
        `pad=${width}:${height}:` +
        "(ow-iw)/2:(oh-ih)/2:black," +
        `fps=${fps},format=yuv420p`,
        "-c:v",
        "mpeg4",
        "-vtag",
        "XVID",
        "-q:v",
        "4",
        "-g",
        String(gop),
        "-bf",
        "0",
        "-sc_threshold",
        "0",
        "-f",
        "avi",
        outputName
      ]);

      progressContext.active = false;

      if (exitCode !== 0) {
        throw new Error(
          `${file.name} の変換に失敗しました。` +
          `終了コード: ${exitCode}`
        );
      }

      setAnalysisProgress(
        (index + 0.92) / files.length * 100,
        `動画 ${index + 1} / ${files.length}`,
        `${file.name} のフレーム構造を解析中`,
        "processing"
      );

      const aviData =
        await ffmpeg.readFile(outputName);

      const aviBytes =
        new Uint8Array(aviData);

      const parsed = parseAvi(
        aviBytes,
        index,
        file.name
      );

      if (parsed.frames.length === 0) {
        throw new Error(
          `${file.name} から映像フレームを` +
          "検出できませんでした。"
        );
      }

      parsedClips.push(parsed);

      if (index === 0) {
        baseAvi = parsed;
      }

      originalFrames.push(...parsed.frames);

      appendLog(
        `${file.name}: ` +
        `${parsed.frames.length}フレームを検出`
      );

      setAnalysisProgress(
        (index + 1) / files.length * 100,
        `動画 ${index + 1} / ${files.length} 完了`,
        `${file.name}: ` +
        `${parsed.frames.length}フレーム`,
        "processing"
      );

      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch {
        appendLog(
          "仮想ファイルの削除を一部省略しました。"
        );
      }
    }

    workingFrames =
      originalFrames.map(cloneFrame);

    selectedFrameIndex = 0;
    analyzedFps = fps;
    analysisDirty = false;
    analysisSucceeded = true;
    progressContext.active = false;

    setAnalysisProgress(
      100,
      "解析完了",
      `${parsedClips.length}本、` +
      `${workingFrames.length}フレームを解析しました。`,
      "complete"
    );

    elements.analysisNotice.className =
      "analysis-notice ready";

    elements.analysisNotice.textContent =
      "現在のツリー順序が解析結果に反映されています。";

    setEngineState("解析完了", "ready");

    appendLog(
      `解析完了: ${workingFrames.length}フレーム、` +
      `${parsedClips.length}動画`
    );
  } catch (error) {
    progressContext.active = false;

    const message = getErrorMessage(error);

    setEngineState("エラー", "error");

    setAnalysisProgress(
      displayedProgress,
      "解析に失敗しました",
      message,
      "error"
    );

    elements.analysisNotice.className =
      "analysis-notice dirty";

    elements.analysisNotice.textContent =
      "解析に失敗しました。" +
      "入力動画または設定を確認してください。";

    appendLog(`エラー: ${message}`);
    console.error(error);
    alert(message);
  } finally {
    progressContext.active = false;
    processing = false;

    setControlsForProcessing(false);
    renderVideoTree();
    updateInterface();

    if (
      analysisSucceeded &&
      workingFrames.length > 0
    ) {
      scheduleEditedPreviewRender(0);
    }
  }
}

function parseAvi(bytes, clipIndex, clipName) {
  if (readFourCC(bytes, 0) !== "RIFF") {
    throw new Error(
      `${clipName} はRIFF形式ではありません。`
    );
  }

  if (readFourCC(bytes, 8) !== "AVI ") {
    throw new Error(
      `${clipName} はAVI形式ではありません。`
    );
  }

  const movi = findMoviList(bytes);

  if (!movi) {
    throw new Error(
      `${clipName} にmoviリストがありません。`
    );
  }

  const frames = [];

  collectVideoChunks(
    bytes,
    movi.dataStart,
    movi.end,
    frames,
    clipIndex,
    clipName
  );

  return {
    bytes,
    clipIndex,
    clipName,
    moviListOffset: movi.listOffset,
    moviDataStart: movi.dataStart,
    moviEnd: movi.end,
    headerPrefix: bytes.slice(0, movi.dataStart),
    frames
  };
}

function findMoviList(bytes) {
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = readFourCC(bytes, offset);
    const size = readUint32(bytes, offset + 4);
    const next = alignedChunkEnd(offset, size);

    if (
      id === "LIST" &&
      offset + 12 <= bytes.length &&
      readFourCC(bytes, offset + 8) === "movi"
    ) {
      return {
        listOffset: offset,
        dataStart: offset + 12,
        end: Math.min(
          offset + 8 + size,
          bytes.length
        )
      };
    }

    if (
      next <= offset ||
      next > bytes.length + 1
    ) {
      break;
    }

    offset = next;
  }

  return null;
}

function collectVideoChunks(
  bytes,
  start,
  end,
  frames,
  clipIndex,
  clipName
) {
  let offset = start;

  while (
    offset + 8 <= end &&
    offset + 8 <= bytes.length
  ) {
    const id = readFourCC(bytes, offset);
    const size = readUint32(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const chunkEnd = alignedChunkEnd(offset, size);

    if (
      dataEnd > bytes.length ||
      chunkEnd <= offset
    ) {
      break;
    }

    if (id === "LIST" && size >= 4) {
      collectVideoChunks(
        bytes,
        offset + 12,
        Math.min(offset + 8 + size, end),
        frames,
        clipIndex,
        clipName
      );
    } else if (isVideoChunkId(id)) {
      const frameId = nextFrameId;
      nextFrameId += 1;

      frames.push({
        id: frameId,
        sourceId: frameId,
        clipIndex,
        clipName,
        localFrameNumber: frames.length + 1,
        type: detectMpeg4FrameType(
          bytes.subarray(dataStart, dataEnd)
        ),
        chunkId: id,
        chunkBytes: bytes.slice(
          offset,
          Math.min(chunkEnd, bytes.length)
        ),
        duplicated: false
      });
    }

    offset = chunkEnd;
  }
}

function isVideoChunkId(id) {
  return /^[0-9][0-9](dc|db)$/i.test(id);
}

function detectMpeg4FrameType(payload) {
  for (
    let index = 0;
    index + 4 < payload.length;
    index += 1
  ) {
    if (
      payload[index] === 0x00 &&
      payload[index + 1] === 0x00 &&
      payload[index + 2] === 0x01 &&
      payload[index + 3] === 0xb6
    ) {
      const codingType =
        payload[index + 4] >> 6;

      if (codingType === 0) {
        return "I";
      }

      if (codingType === 1) {
        return "P";
      }

      if (codingType === 2) {
        return "B";
      }

      return "S";
    }
  }

  return "?";
}

function cloneFrame(frame) {
  return {
    ...frame
  };
}

function selectFrameByInput() {
  selectFrame(
    Number.parseInt(
      elements.frameNumberInput.value,
      10
    ) - 1,
    true
  );
}

function selectFrameBySlider() {
  selectFrame(
    Number.parseInt(
      elements.timelineSlider.value,
      10
    ) - 1,
    true
  );
}

function selectFrameFromCanvas(event) {
  if (workingFrames.length === 0) {
    return;
  }

  const rectangle =
    elements.timelineCanvas.getBoundingClientRect();

  const ratio = clamp(
    (event.clientX - rectangle.left) /
    rectangle.width,
    0,
    1
  );

  const index = Math.min(
    workingFrames.length - 1,
    Math.floor(ratio * workingFrames.length)
  );

  selectFrame(index, true);
}

function selectFrame(
  index,
  synchronizePreview = false
) {
  if (workingFrames.length === 0) {
    return;
  }

  selectedFrameIndex = clampInteger(
    index,
    0,
    0,
    workingFrames.length - 1
  );

  updateInterface();

  if (synchronizePreview) {
    seekEditedPreviewToSelectedFrame();
  }
}

function duplicateSelectedPFrame() {
  const frame =
    workingFrames[selectedFrameIndex];

  if (!frame || frame.type !== "P") {
    alert(
      "選択したフレームはPフレームではありません。"
    );
    return;
  }

  const count = clampInteger(
    elements.duplicateCountInput.value,
    5,
    1,
    300
  );

  elements.duplicateCountInput.value =
    String(count);

  const duplicates = Array.from(
    { length: count },
    () => ({
      ...frame,
      id: nextFrameId++,
      duplicated: true
    })
  );

  workingFrames.splice(
    selectedFrameIndex + 1,
    0,
    ...duplicates
  );

  appendLog(
    `${selectedFrameIndex + 1}番のPフレームを` +
    `${count}回複製しました。`
  );

  updateInterface();
  scheduleEditedPreviewRender();
}

function deleteSelectedIFrame() {
  const frame =
    workingFrames[selectedFrameIndex];

  if (!frame || frame.type !== "I") {
    alert(
      "選択したフレームはIフレームではありません。"
    );
    return;
  }

  const removedNumber =
    selectedFrameIndex + 1;

  workingFrames.splice(
    selectedFrameIndex,
    1
  );

  selectedFrameIndex = Math.min(
    selectedFrameIndex,
    Math.max(workingFrames.length - 1, 0)
  );

  appendLog(
    `${removedNumber}番のIフレームを削除しました。`
  );

  updateInterface();
  scheduleEditedPreviewRender();
}

function removeSeamIFrames() {
  if (parsedClips.length < 2) {
    alert(
      "継ぎ目処理には2本以上の動画が必要です。"
    );
    return;
  }

  if (seamOperationApplied) {
    alert(
      "継ぎ目処理はすでに適用されています。"
    );
    return;
  }

  let removed = 0;

  for (
    let clipIndex = 1;
    clipIndex < parsedClips.length;
    clipIndex += 1
  ) {
    const firstFrameIndex =
      workingFrames.findIndex(
        (frame) =>
          frame.clipIndex === clipIndex
      );

    if (firstFrameIndex < 0) {
      continue;
    }

    if (
      workingFrames[firstFrameIndex].type === "I"
    ) {
      workingFrames.splice(
        firstFrameIndex,
        1
      );

      removed += 1;
    }
  }

  seamOperationApplied = true;

  selectedFrameIndex = Math.min(
    selectedFrameIndex,
    Math.max(workingFrames.length - 1, 0)
  );

  appendLog(
    `継ぎ目処理で${removed}個のIフレームを削除しました。`
  );

  updateInterface();
  scheduleEditedPreviewRender();
}

function resetEdits() {
  workingFrames =
    originalFrames.map(cloneFrame);

  selectedFrameIndex = 0;
  seamOperationApplied = false;

  appendLog(
    "すべてのフレーム編集をリセットしました。"
  );

  updateInterface();
  scheduleEditedPreviewRender();
}

function updateInterface() {
  const hasFrames =
    workingFrames.length > 0;

  if (hasFrames) {
    selectedFrameIndex = clampInteger(
      selectedFrameIndex,
      0,
      0,
      workingFrames.length - 1
    );
  }

  const selectedFrame =
    workingFrames[selectedFrameIndex];

  elements.prepareButton.disabled =
    processing ||
    editedPreviewRendering ||
    videoEntries.length === 0;

  elements.clearFilesButton.disabled =
    processing || videoEntries.length === 0;

  elements.timelineEmpty.classList.toggle(
    "hidden",
    hasFrames
  );

  elements.timelineArea.classList.toggle(
    "hidden",
    !hasFrames
  );

  elements.frameNumberInput.disabled =
    !hasFrames || processing;

  elements.duplicateCountInput.disabled =
    !hasFrames || processing;

  elements.selectFrameButton.disabled =
    !hasFrames || processing;

  elements.resetButton.disabled =
    !hasFrames || processing;

  elements.exportButton.disabled =
    !hasFrames || processing;

  elements.duplicateButton.disabled =
    !hasFrames ||
    processing ||
    selectedFrame?.type !== "P";

  elements.deleteIFrameButton.disabled =
    !hasFrames ||
    processing ||
    selectedFrame?.type !== "I";

  elements.seamButton.disabled =
    !hasFrames ||
    processing ||
    parsedClips.length < 2 ||
    seamOperationApplied;

  if (!hasFrames) {
    elements.selectedFrameInfo.textContent =
      "フレームが選択されていません。";

    elements.frameTableBody.innerHTML =
      '<tr><td colspan="5">データがありません。</td></tr>';

    updateEditedPreviewPositionDisplay();
    return;
  }

  elements.frameNumberInput.max =
    String(workingFrames.length);

  elements.frameNumberInput.value =
    String(selectedFrameIndex + 1);

  elements.timelineSlider.max =
    String(workingFrames.length);

  elements.timelineSlider.value =
    String(selectedFrameIndex + 1);

  const frame =
    workingFrames[selectedFrameIndex];

  elements.selectedFrameInfo.textContent =
    `現在 ${selectedFrameIndex + 1} / ` +
    `${workingFrames.length} — ` +
    `種類: ${frame.type} — ` +
    `動画: ${frame.clipIndex + 1}` +
    `「${frame.clipName}」— ` +
    `元フレーム: ${frame.localFrameNumber}` +
    `${frame.duplicated ? " — 複製フレーム" : ""}`;

  elements.timelineScale.textContent =
    `全${workingFrames.length}フレーム / ` +
    `選択位置 ${selectedFrameIndex + 1}` +
    `${analysisDirty ? " / 入力構成に未反映の変更あり" : ""}`;

  renderFrameTable();
  drawTimeline();
  renderFrameTable();
  drawTimeline();
  updateEditedPreviewPositionDisplay();
}

function setControlsForProcessing(value) {
  elements.fileInput.disabled = value;
  elements.widthInput.disabled = value;
  elements.heightInput.disabled = value;
  elements.fpsInput.disabled = value;
  elements.gopInput.disabled = value;

  elements.prepareButton.disabled =
    value ||
    editedPreviewRendering ||
    videoEntries.length === 0;

  elements.clearFilesButton.disabled =
    value ||
    videoEntries.length === 0;

  renderVideoTree();
}

function renderFrameTable() {
  if (workingFrames.length === 0) {
    return;
  }

  const radius = 7;
  const start = Math.max(
    0,
    selectedFrameIndex - radius
  );

  const end = Math.min(
    workingFrames.length,
    selectedFrameIndex + radius + 1
  );

  const fragment =
    document.createDocumentFragment();

  for (
    let index = start;
    index < end;
    index += 1
  ) {
    const frame = workingFrames[index];
    const row = document.createElement("tr");

    if (index === selectedFrameIndex) {
      row.classList.add("selected-row");
    }

    row.addEventListener(
      "click",
      () => selectFrame(index, true)
    );

    const values = [
      String(index + 1),
      `${frame.clipIndex + 1}: ${frame.clipName}`,
      String(frame.localFrameNumber),
      frame.type,
      frame.duplicated
        ? "複製"
        : "元フレーム"
    ];

    values.forEach((value, cellIndex) => {
      const cell = document.createElement("td");

      cell.textContent = value;

      if (cellIndex === 3) {
        if (frame.type === "I") {
          cell.className = "frame-i";
        }

        if (frame.type === "P") {
          cell.className = "frame-p";
        }
      }

      row.append(cell);
    });

    fragment.append(row);
  }

  elements.frameTableBody.replaceChildren(
    fragment
  );
}

function drawTimeline() {
  if (workingFrames.length === 0) {
    return;
  }

  const canvas = elements.timelineCanvas;
  const context = canvas.getContext("2d");
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const pixelRatio =
    window.devicePixelRatio || 1;

  canvas.width = Math.max(
    1,
    Math.floor(cssWidth * pixelRatio)
  );

  canvas.height = Math.max(
    1,
    Math.floor(cssHeight * pixelRatio)
  );

  context.setTransform(
    pixelRatio,
    0,
    0,
    pixelRatio,
    0,
    0
  );

  context.fillStyle = "#080d15";
  context.fillRect(
    0,
    0,
    cssWidth,
    cssHeight
  );

  const plotTop = 18;
  const plotHeight = cssHeight - 36;

  for (
    let pixel = 0;
    pixel < cssWidth;
    pixel += 1
  ) {
    const start = Math.floor(
      pixel / cssWidth * workingFrames.length
    );

    const end = Math.max(
      start + 1,
      Math.floor(
        (pixel + 1) /
        cssWidth *
        workingFrames.length
      )
    );

    context.fillStyle =
      determineRangeColor(start, end);

    context.fillRect(
      pixel,
      plotTop,
      1,
      plotHeight
    );
  }

  drawClipBoundaries(
    context,
    cssWidth,
    plotTop,
    plotHeight
  );

  const selectedX =
    (
      selectedFrameIndex + 0.5
    ) /
    workingFrames.length *
    cssWidth;

  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(selectedX, 5);
  context.lineTo(
    selectedX,
    cssHeight - 5
  );
  context.stroke();
}

function determineRangeColor(start, end) {
  let hasPFrame = false;

  for (
    let index = start;
    index < end &&
    index < workingFrames.length;
    index += 1
  ) {
    const type = workingFrames[index].type;

    if (type === "I") {
      return "#ff5268";
    }

    if (type === "P") {
      hasPFrame = true;
    }
  }

  return hasPFrame
    ? "#38cda0"
    : "#71809a";
}

function drawClipBoundaries(
  context,
  width,
  top,
  height
) {
  let previousClip =
    workingFrames[0]?.clipIndex;

  for (
    let index = 1;
    index < workingFrames.length;
    index += 1
  ) {
    const clipIndex =
      workingFrames[index].clipIndex;

    if (clipIndex === previousClip) {
      continue;
    }

    const x =
      index / workingFrames.length * width;

    context.strokeStyle = "#f7c85d";
    context.lineWidth = 2;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(x, top - 8);
    context.lineTo(x, top + height + 8);
    context.stroke();
    context.setLineDash([]);

    previousClip = clipIndex;
  }
}

function exportAvi() {
  if (
    !baseAvi ||
    workingFrames.length === 0
  ) {
    return;
  }

  try {
    appendLog(
      "AVI構造を再構築しています。"
    );

    const output = buildAvi(
      baseAvi,
      workingFrames
    );

    const blob = new Blob(
      [output],
      {
        type: "video/x-msvideo"
      }
    );

    const fileName =
      normalizeOutputFileName(
        elements.outputNameInput.value
      );

    const objectURL =
      URL.createObjectURL(blob);

    const anchor =
      document.createElement("a");

    anchor.href = objectURL;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(objectURL);
    }, 1000);

    appendLog(
      `${fileName} を出力しました。` +
      `${workingFrames.length}フレーム、` +
      `${formatFileSize(output.byteLength)}`
    );
  } catch (error) {
    const message = getErrorMessage(error);

    appendLog(
      `書き出しエラー: ${message}`
    );

    console.error(error);
    alert(message);
  }
}

function buildAvi(base, frames) {
  const header = base.headerPrefix.slice();

  const frameChunkLength = frames.reduce(
    (sum, frame) =>
      sum + frame.chunkBytes.length,
    0
  );

  const indexDataLength =
    frames.length * 16;

  const totalLength =
    header.length +
    frameChunkLength +
    8 +
    indexDataLength;

  if (totalLength > 0xffffffff) {
    throw new Error(
      "出力が通常のAVIサイズ上限を超えています。"
    );
  }

  const output =
    new Uint8Array(totalLength);

  output.set(header, 0);

  let writeOffset = header.length;
  let moviRelativeOffset = 4;
  const indexEntries = [];

  for (const frame of frames) {
    output.set(
      frame.chunkBytes,
      writeOffset
    );

    const chunkSize =
      readUint32(frame.chunkBytes, 4);

    indexEntries.push({
      chunkId: frame.chunkId,
      flags: frame.type === "I"
        ? 0x10
        : 0,
      offset: moviRelativeOffset,
      size: chunkSize
    });

    writeOffset += frame.chunkBytes.length;
    moviRelativeOffset +=
      frame.chunkBytes.length;
  }

  writeFourCC(
    output,
    writeOffset,
    "idx1"
  );

  writeUint32(
    output,
    writeOffset + 4,
    indexDataLength
  );

  writeOffset += 8;

  for (const entry of indexEntries) {
    writeFourCC(
      output,
      writeOffset,
      entry.chunkId
    );

    writeUint32(
      output,
      writeOffset + 4,
      entry.flags
    );

    writeUint32(
      output,
      writeOffset + 8,
      entry.offset
    );

    writeUint32(
      output,
      writeOffset + 12,
      entry.size
    );

    writeOffset += 16;
  }

  writeUint32(
    output,
    4,
    output.length - 8
  );

  writeUint32(
    output,
    base.moviListOffset + 4,
    4 + frameChunkLength
  );

  patchAviFrameCounts(
    output,
    frames.length
  );

  patchSuggestedBufferSize(
    output,
    frames
  );

  return output;
}

function patchAviFrameCounts(
  bytes,
  frameCount
) {
  const avihOffset =
    findFourCC(bytes, "avih", 12);

  if (
    avihOffset >= 0 &&
    avihOffset + 28 <= bytes.length
  ) {
    writeUint32(
      bytes,
      avihOffset + 24,
      frameCount
    );
  }

  let searchOffset = 12;

  while (searchOffset < bytes.length) {
    const strhOffset = findFourCC(
      bytes,
      "strh",
      searchOffset
    );

    if (
      strhOffset < 0 ||
      strhOffset + 48 > bytes.length
    ) {
      break;
    }

    if (
      readFourCC(
        bytes,
        strhOffset + 8
      ) === "vids"
    ) {
      writeUint32(
        bytes,
        strhOffset + 40,
        frameCount
      );

      break;
    }

    searchOffset = strhOffset + 4;
  }
}

function patchSuggestedBufferSize(
  bytes,
  frames
) {
  let maximumChunkSize = 0;

  for (const frame of frames) {
    maximumChunkSize = Math.max(
      maximumChunkSize,
      readUint32(frame.chunkBytes, 4)
    );
  }

  const avihOffset =
    findFourCC(bytes, "avih", 12);

  if (
    avihOffset >= 0 &&
    avihOffset + 40 <= bytes.length
  ) {
    writeUint32(
      bytes,
      avihOffset + 36,
      maximumChunkSize
    );
  }
}

function readFourCC(bytes, offset) {
  if (
    offset < 0 ||
    offset + 4 > bytes.length
  ) {
    return "";
  }

  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function writeFourCC(
  bytes,
  offset,
  text
) {
  for (
    let index = 0;
    index < 4;
    index += 1
  ) {
    bytes[offset + index] =
      text.charCodeAt(index) || 0x20;
  }
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] |
    bytes[offset + 1] << 8 |
    bytes[offset + 2] << 16 |
    bytes[offset + 3] << 24
  ) >>> 0;
}

function writeUint32(
  bytes,
  offset,
  value
) {
  const normalized = value >>> 0;

  bytes[offset] =
    normalized & 0xff;

  bytes[offset + 1] =
    normalized >>> 8 & 0xff;

  bytes[offset + 2] =
    normalized >>> 16 & 0xff;

  bytes[offset + 3] =
    normalized >>> 24 & 0xff;
}

function alignedChunkEnd(offset, size) {
  return offset + 8 + size + (size & 1);
}

function findFourCC(
  bytes,
  text,
  start = 0
) {
  const values = [...text].map(
    (character) =>
      character.charCodeAt(0)
  );

  for (
    let index = start;
    index + 4 <= bytes.length;
    index += 1
  ) {
    if (
      bytes[index] === values[0] &&
      bytes[index + 1] === values[1] &&
      bytes[index + 2] === values[2] &&
      bytes[index + 3] === values[3]
    ) {
      return index;
    }
  }

  return -1;
}

function createVirtualInputName(
  file,
  index
) {
  const extensionMatch =
    file.name.match(/\.[a-zA-Z0-9]+$/);

  const extension = extensionMatch
    ? extensionMatch[0].toLowerCase()
    : ".video";

  return `input-${index}${extension}`;
}

function normalizeOutputFileName(value) {
  let fileName =
    value.trim() || "datamosh-output.avi";

  fileName = fileName.replace(
    /[\\/:*?"<>|]/g,
    "_"
  );

  if (
    !fileName.toLowerCase().endsWith(".avi")
  ) {
    fileName += ".avi";
  }

  return fileName;
}

function formatFileSize(byteLength) {
  if (
    !Number.isFinite(byteLength) ||
    byteLength <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KiB",
    "MiB",
    "GiB"
  ];

  const unitIndex = Math.min(
    Math.floor(
      Math.log(byteLength) /
      Math.log(1024)
    ),
    units.length - 1
  );

  const value =
    byteLength / 1024 ** unitIndex;

  return (
    value.toFixed(
      unitIndex === 0 ? 0 : 2
    ) +
    ` ${units[unitIndex]}`
  );
}

function formatDuration(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "--:--";
  }

  const totalSeconds =
    Math.floor(seconds);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutes =
    Math.floor(
      totalSeconds % 3600 / 60
    );

  const remainingSeconds =
    totalSeconds % 60;

  if (hours > 0) {
    return [
      hours,
      String(minutes).padStart(2, "0"),
      String(remainingSeconds).padStart(2, "0")
    ].join(":");
  }

  return [
    minutes,
    String(remainingSeconds).padStart(2, "0")
  ].join(":");
}

function normalizeEvenInteger(
  value,
  fallback,
  min,
  max
) {
  let number = clampInteger(
    value,
    fallback,
    min,
    max
  );

  if (number % 2 !== 0) {
    number -= 1;
  }

  return Math.max(min, number);
}

function clampInteger(
  value,
  fallback,
  min,
  max
) {
  const parsed =
    Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(min, parsed)
  );
}

function clamp(value, min, max) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}