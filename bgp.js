(function () {
  "use strict";

  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

  let bgpState = [
    {
      id: "route-ispa",
      neighbor: "AS65002 (100.64.1.1)",
      nextHop: "100.64.1.1",
      egressIf: "g0/1",
      asPath: [65002, 65005],
      localPref: 100,
      accepted: true,
      linkIds: ["c12-lan-src", "ebgp-1-2", "ebgp-2-5", "c12-lan-dst"]
    },
    {
      id: "route-ispb",
      neighbor: "AS65003 (100.64.2.1)",
      nextHop: "100.64.2.1",
      egressIf: "g0/2",
      asPath: [65003, 65004, 65005],
      localPref: 200,
      accepted: true,
      linkIds: ["c12-lan-src", "ebgp-1-3", "ebgp-3-4", "ebgp-4-5", "c12-lan-dst"]
    }
  ];

  function selectBestBgpRoute(net) {
    const downLinks = new Set(net.links.filter(l => !l.up).map(l => l.id));
    const candidates = bgpState.map(r => {
      const linkBroken = r.linkIds.some(id => downLinks.has(id));
      return { ...r, linkBroken, usable: r.accepted && !linkBroken };
    });

    const valid = candidates.filter(c => c.usable);
    valid.sort((a, b) => {
      if (b.localPref !== a.localPref) return b.localPref - a.localPref; // Ưu tiên 1: Local Preference cao hơn
      return a.asPath.length - b.asPath.length;                         // Ưu tiên 2: AS-PATH ngắn hơn
    });

    const best = valid[0] || null;
    const backup = valid[1] || null;

    let reason = "Không có tuyến BGP khả dụng (do bị lọc bởi chính sách hoặc đứt liên kết vật lý).";
    if (best) {
      const shorterRejected = valid.find(r => r.id !== best.id && r.asPath.length < best.asPath.length);
      if (shorterRejected) {
        reason = "Chọn tuyến qua " + best.neighbor + " (AS-PATH: " + best.asPath.join(" → ") +
          ") dù AS-PATH dài hơn (" + best.asPath.length + " AS so với " + shorterRejected.asPath.length +
          " AS), vì BGP ưu tiên thuộc tính quản trị Local Preference cao hơn (" + best.localPref + " > " + shorterRejected.localPref + ").";
      } else {
        reason = "Chọn tuyến qua " + best.neighbor + " (Local Pref = " + best.localPref +
          ", AS-PATH = [" + best.asPath.join(" ") + "] gồm " + best.asPath.length + " AS).";
      }
    }

    return { candidates, best, backup, reason, downLinks: [...downLinks] };
  }

  function renderCase12Panel() {
    const net = globalThis.TV1TopologyUI?.getNetwork();
    let panel = document.getElementById("tv5-bgp-panel");
    if (!net || net.id !== "case12") {
      if (panel) panel.hidden = true;
      return;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "tv5-bgp-panel";
      panel.className = "panel checks";
      const main = document.querySelector("main.wrap");
      main.insertBefore(panel, document.getElementById("tv5-timeline-panel") || main.querySelector("footer"));
    }
    panel.hidden = false;

    const decision = selectBestBgpRoute(net);

    panel.innerHTML =
      '<div class="panel-head">' +
        '<div><span class="eyebrow">TV5 · CASE 12 · INTER-DOMAIN ROUTING (BGP)</span><h2>Bảng BGP &amp; Chính sách chọn đường tại AS65001 (Prefix 198.51.100.0/24)</h2></div>' +
        '<button type="button" id="tv5-bgp-apply" class="primary">Áp dụng &amp; Tô sáng Best Path</button>' +
      '</div>' +
      '<p class="case-desc">' + esc(decision.reason) + '</p>' +
      '<table><thead><tr>' +
        '<th>BGP Neighbor</th><th>Next Hop</th><th>AS-PATH (Độ dài)</th><th>Local Preference</th><th>Chính sách Import</th><th>Kết quả chọn</th>' +
      '</tr></thead><tbody>' +
      decision.candidates.map(c => {
        const isBest = decision.best?.id === c.id;
        return '<tr>' +
          '<td><strong>' + esc(c.neighbor) + '</strong></td>' +
          '<td><code>' + esc(c.nextHop) + '</code> (' + esc(c.egressIf) + ')</td>' +
          '<td><code>' + esc(c.asPath.join(" → ")) + '</code> (' + c.asPath.length + ' AS)</td>' +
          '<td><input type="number" data-bgp-lp="' + esc(c.id) + '" min="1" max="9999" value="' + c.localPref + '" style="max-width:110px"></td>' +
          '<td><select data-bgp-accept="' + esc(c.id) + '" style="max-width:165px">' +
            '<option value="true"' + (c.accepted ? " selected" : "") + '>Permit (Chấp nhận)</option>' +
            '<option value="false"' + (!c.accepted ? " selected" : "") + '>Deny (Từ chối tuyến)</option>' +
          '</select></td>' +
          '<td>' +
            (c.linkBroken ? '<span class="state no">Liên kết Down</span>' :
             !c.accepted ? '<span class="state no">Bị lọc (Filtered)</span>' :
             isBest ? '<span class="state yes">&gt;* Best Path</span>' : '<span class="pill" style="background:#ecf4f6;color:#142c3d">Valid (Backup)</span>') +
          '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table>';

    panel.querySelectorAll("[data-bgp-lp]").forEach(input => {
      input.addEventListener("change", ev => {
        const target = bgpState.find(r => r.id === ev.target.dataset.bgpLp);
        if (target) target.localPref = Number(ev.target.value) || 100;
        renderCase12Panel();
      });
    });

    panel.querySelectorAll("[data-bgp-accept]").forEach(select => {
      select.addEventListener("change", ev => {
        const target = bgpState.find(r => r.id === ev.target.dataset.bgpAccept);
        if (target) target.accepted = ev.target.value === "true";
        renderCase12Panel();
      });
    });

    panel.querySelector("#tv5-bgp-apply")?.addEventListener("click", () => {
      const currentNet = globalThis.TV1TopologyUI.getNetwork();
      const res = selectBestBgpRoute(currentNet);
      const highlightObj = {
        path: res.best ? res.best.linkIds : [],
        backup: res.backup ? res.backup.linkIds : [],
        faults: res.downLinks,
        faultNode: res.best ? "" : "as65001"
      };
      globalThis.TV1TopologyUI.highlight(highlightObj);
      globalThis.TV5EventTimeline?.record({
        type: "BGP",
        status: res.best ? "SUCCESS" : "FAILED",
        device: "as65001",
        description: res.best
          ? "BGP chọn Best Path tới 198.51.100.0/24 qua " + res.best.neighbor + " (LocalPref=" + res.best.localPref + ", AS-PATH=" + res.best.asPath.join(" ") + ")."
          : "BGP không tìm thấy tuyến hợp lệ tới 198.51.100.0/24.",
        hypothesis: res.reason,
        highlight: highlightObj
      });
    });
  }

  document.addEventListener("tv1:topologychange", renderCase12Panel);
  globalThis.TV5BGP = Object.freeze({ selectBestBgpRoute, renderCase12Panel });
})();