(function () {
  "use strict";

  let timelineSteps = [];
  let currentIndex = -1;
  let timer = null;

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function applyStep(index) {
    if (!timelineSteps.length) {
      globalThis.TV2PacketInspector?.render(null, 0, 0);
      return;
    }
    currentIndex = Math.max(0, Math.min(index, timelineSteps.length - 1));
    const step = timelineSteps[currentIndex];

    globalThis.TV2PacketInspector?.render(step, currentIndex, timelineSteps.length);

    if (globalThis.TV1TopologyUI && step.highlight) {
      globalThis.TV1TopologyUI.highlight(step.highlight);
    }

    const items = document.querySelectorAll("#result .steps li");
    items.forEach((li, idx) => {
      li.classList.toggle("active-step", idx === currentIndex);
    });
  }

  function loadProbeResult(probeRes) {
    stopTimer();
    timelineSteps = probeRes?.detailedSteps || [];
    if (!timelineSteps.length) {
      currentIndex = -1;
      globalThis.TV2PacketInspector?.render(null, 0, 0);
      return;
    }
    // Mặc định hiển thị bước cuối cùng để thấy tổng thể kết quả, người dùng bấm Reset/Prev/Play để tua từng bước
    applyStep(timelineSteps.length - 1);

    const items = document.querySelectorAll("#result .steps li");
    items.forEach((li, idx) => {
      li.addEventListener("click", () => {
        stopTimer();
        applyStep(idx);
      });
    });
  }

  function stepNext() {
    stopTimer();
    if (!timelineSteps.length) return;
    if (currentIndex < timelineSteps.length - 1) {
      applyStep(currentIndex + 1);
    }
  }

  function stepPrev() {
    stopTimer();
    if (!timelineSteps.length) return;
    if (currentIndex > 0) {
      applyStep(currentIndex - 1);
    }
  }

  function stepReset() {
    stopTimer();
    if (!timelineSteps.length) return;
    applyStep(0);
  }

  function stepPlay() {
    stopTimer();
    if (!timelineSteps.length) return;
    if (currentIndex >= timelineSteps.length - 1) {
      applyStep(0);
    }
    timer = setInterval(() => {
      if (currentIndex < timelineSteps.length - 1) {
        applyStep(currentIndex + 1);
      } else {
        stopTimer();
      }
    }, 1250);
  }

  function initSimulatorControls() {
    document.getElementById("step-play")?.addEventListener("click", stepPlay);
    document.getElementById("step-pause")?.addEventListener("click", stopTimer);
    document.getElementById("step-prev")?.addEventListener("click", stepPrev);
    document.getElementById("step-next")?.addEventListener("click", stepNext);
    document.getElementById("step-reset")?.addEventListener("click", stepReset);

    document.addEventListener("tv1:topologychange", () => {
      stopTimer();
      timelineSteps = [];
      currentIndex = -1;
      globalThis.TV2PacketInspector?.render(null, 0, 0);
    });

    globalThis.TV2PacketInspector?.render(null, 0, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSimulatorControls);
  } else {
    initSimulatorControls();
  }

  globalThis.TV2PacketSimulator = Object.freeze({
    loadProbeResult,
    stepNext,
    stepPrev,
    stepReset,
    stepPlay,
    stopTimer
  });
})();