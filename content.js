// RaceApp MileSplit Entry — Content Script
// Runs on MileSplit meet registration event pages

(function () {
  "use strict"

  const storageApi = (typeof browser !== "undefined" ? browser : chrome).storage.local

  // =========================================
  // HTML escaping
  // =========================================

  function esc(str) {
    const el = document.createElement("span")
    el.textContent = str
    return el.innerHTML
  }

  // =========================================
  // Name matching utilities
  // =========================================

  function normalizeForMatch(name) {
    return name
      .toLowerCase()
      .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function splitName(normalized) {
    const parts = normalized.split(" ")
    const last = parts[parts.length - 1]
    const first = parts[0]
    const middle = parts.length > 2 ? parts.slice(1, -1) : []
    return { first, last, middle, full: normalized }
  }

  function editDistance(a, b) {
    if (a === b) return 0
    const m = a.length, n = b.length
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    return dp[m][n]
  }

  function matchScore(raceappName, milesplitName) {
    const ra = splitName(normalizeForMatch(raceappName))
    const ms = splitName(normalizeForMatch(milesplitName))

    // Exact after normalization
    if (ra.full === ms.full) return { score: 100, type: "exact" }

    // Try without middle names: "Amara Britt Harris" matches "Amara Harris"
    const raNoMiddle = ra.first + " " + ra.last
    const msNoMiddle = ms.first + " " + ms.last
    if (raNoMiddle === msNoMiddle) return { score: 95, type: "exact" }

    // Full name edit distance — catches typos like "Nicolson" vs "Nicholson"
    const fullDist = editDistance(ra.full, ms.full)
    if (fullDist === 1) return { score: 85, type: "fuzzy" }
    if (fullDist === 2) return { score: 75, type: "fuzzy" }

    // Check last name: exact or within 1-2 edits
    const lastDist = editDistance(ra.last, ms.last)
    if (lastDist > 2) return { score: 0, type: "none" }

    // Last name close — check first name
    const firstDist = editDistance(ra.first, ms.first)

    if (lastDist === 0 && firstDist === 0) return { score: 90, type: "exact" }
    if (lastDist === 0 && firstDist <= 1) return { score: 80, type: "fuzzy" }
    if (lastDist === 0 && firstDist <= 2) return { score: 70, type: "fuzzy" }

    // First name prefix (3+ chars) with close last name
    const minLen = Math.min(ra.first.length, ms.first.length)
    if (minLen >= 3 && ra.first.substring(0, 3) === ms.first.substring(0, 3))
      return { score: 65, type: "fuzzy" }

    // Last name close + any first name
    if (lastDist <= 1 && firstDist <= 2) return { score: 55, type: "fuzzy" }

    // Last name exact, first name distant
    if (lastDist === 0) return { score: 30, type: "fuzzy" }

    return { score: 0, type: "none" }
  }

  function extractNameFromLabel(labelText) {
    // Labels look like "Ariana Shine 13.70" or "Ariana Shine"
    // Browser collapses whitespace in textContent, so we can't rely on double-space detection.
    // Strip trailing mark: time (13.70, 2:05.30), distance (18-06.50, 5-02.00), or plain number
    return labelText
      .replace(/\s+\d+[:\-]\d+[.:]\d+\s*$/, "")  // 2:05.30 or 18-06.50
      .replace(/\s+\d+[.:]\d+\s*$/, "")            // 13.70
      .replace(/\s+\d+\s*$/, "")                    // bare number
      .trim()
  }

  // =========================================
  // Page detection
  // =========================================

  function detectCurrentEvent() {
    const sel = document.querySelector("#event")
    if (!sel) return null
    const opt = sel.querySelector("option:checked") || sel.options[sel.selectedIndex]
    return opt ? opt.textContent.trim() : null
  }

  function detectCurrentDivision() {
    // Parse the inline script containing Registration.Event( to extract genderText and divisionName
    const scripts = document.querySelectorAll("script")
    for (const script of scripts) {
      const text = script.textContent
      if (!text.includes("Registration.Event(")) continue

      const genderMatch = text.match(/"genderText"\s*:\s*"([^"]+)"/)
      const divMatch = text.match(/"divisionName"\s*:\s*"([^"]+)"/)

      if (genderMatch && divMatch) {
        // Unescape JSON string escapes (e.g. \/ → /)
        const gender = genderMatch[1].replace(/\\(.)/g, "$1")
        const division = divMatch[1].replace(/\\(.)/g, "$1")
        return gender + " " + division
      }
    }
    return null
  }

  // Manual division mappings: MileSplit division name → RaceApp plan division key
  // Populated from storage at init, updated when user picks from the dropdown
  let divisionMappings = {}

  // Build a loose regex from a division name: "Boys Frosh/Soph" → /boys.*frosh.*soph/i
  function divisionPattern(name) {
    const words = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    return new RegExp(words.join(".*"), "i")
  }

  function findPlanDivision(plan, detectedDivision) {
    if (!plan.divisions) return null
    // Check manual mapping first
    if (divisionMappings[detectedDivision] && plan.divisions[divisionMappings[detectedDivision]]) {
      return divisionMappings[detectedDivision]
    }
    // Try exact match
    if (plan.divisions[detectedDivision]) return detectedDivision
    // Try loose regex match
    const pattern = divisionPattern(detectedDivision)
    for (const key of Object.keys(plan.divisions)) {
      if (pattern.test(key)) return key
    }
    return null
  }

  function saveDivisionMapping(milesplitDiv, planDiv) {
    divisionMappings[milesplitDiv] = planDiv
    storageApi.get(["divisionMappings"], (data) => {
      const mappings = data.divisionMappings || {}
      mappings[milesplitDiv] = planDiv
      storageApi.set({ divisionMappings: mappings })
    })
  }

  function isLastEvent() {
    const sel = document.querySelector("#event")
    if (!sel || !sel.options.length) return false
    return sel.selectedIndex === sel.options.length - 1
  }

  // =========================================
  // Find checkboxes in athlete pool
  // =========================================

  function getAllAthleteCheckboxes() {
    return Array.from(
      document.querySelectorAll('#athletePool input.add-athlete[type="checkbox"]')
    )
  }

  function findBestMatch(athleteName, checkboxes) {
    let best = null
    let bestScore = 0

    for (const cb of checkboxes) {
      const label = cb.parentElement.querySelector("label")
      if (!label) continue

      const msName = extractNameFromLabel(label.textContent)
      const result = matchScore(athleteName, msName)

      if (result.score > bestScore) {
        bestScore = result.score
        best = { checkbox: cb, label, msName, ...result }
      }
    }

    return best
  }

  // =========================================
  // AJAX waiting
  // =========================================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function waitForLoaderDone(timeout = 5000) {
    const loader = document.getElementById("loader")
    if (!loader) return

    const start = Date.now()
    // Brief pause for loader to appear
    await sleep(200)

    // Wait for loader to disappear
    while (Date.now() - start < timeout) {
      const style = getComputedStyle(loader)
      if (style.display === "none" || style.visibility === "hidden") return
      await sleep(100)
    }
  }

  // =========================================
  // Panel UI
  // =========================================

  function createPanel() {
    const existing = document.getElementById("raceapp-panel")
    if (existing) existing.remove()

    const panel = document.createElement("div")
    panel.id = "raceapp-panel"
    document.body.appendChild(panel)
    return panel
  }

  function renderDivisionPicker(plan, currentDivision, currentEvent, totalEntries, completedCount) {
    const panel = createPanel()
    const divKeys = Object.keys(plan.divisions || {})
    const optionsHTML = divKeys.map(
      (k) => `<option value="${esc(k)}">${esc(k)}</option>`
    ).join("")

    panel.innerHTML = `
      <div class="ra-header">
        <h3>RaceApp Entries</h3>
        <div class="ra-subtitle">${esc(currentDivision)} &middot; ${esc(currentEvent)}</div>
      </div>
      <div class="ra-body" style="padding: 14px;">
        <p style="margin-bottom:8px;"><strong>Could not match division</strong></p>
        <p style="margin-bottom:8px; font-size:12px; color:#64748b;">
          MileSplit says "<em>${esc(currentDivision)}</em>" — pick the matching RaceApp division:
        </p>
        <select id="ra-division-picker" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px; font-size:13px; margin-bottom:8px;">
          <option value="">-- Select division --</option>
          ${optionsHTML}
        </select>
        <button class="ra-btn-check-all" id="ra-pick-division-btn" disabled style="width:100%;">Use this division</button>
      </div>
      <div class="ra-footer">
        <div class="ra-progress">Progress: ${completedCount}/${totalEntries} entries</div>
      </div>
    `

    const picker = panel.querySelector("#ra-division-picker")
    const pickBtn = panel.querySelector("#ra-pick-division-btn")

    picker.addEventListener("change", () => {
      pickBtn.disabled = !picker.value
    })

    pickBtn.addEventListener("click", () => {
      const chosen = picker.value
      if (!chosen) return
      // Save this mapping so we don't ask again for this MileSplit division
      saveDivisionMapping(currentDivision, chosen)
      renderPanel(plan, currentDivision, currentEvent, totalEntries, completedCount)
    })
  }

  function renderPanel(plan, currentDivision, currentEvent, totalEntries, completedCount) {
    const panel = createPanel()
    const planDivision = findPlanDivision(plan, currentDivision)

    if (!planDivision) {
      renderDivisionPicker(plan, currentDivision, currentEvent, totalEntries, completedCount)
      return
    }

    const subtitleHTML = `${esc(planDivision)} &middot; ${esc(currentEvent)} <a href="#" class="ra-change-div">change</a>`

    function wireChangeDivLink(panel) {
      const link = panel.querySelector(".ra-change-div")
      if (link) {
        link.addEventListener("click", (e) => {
          e.preventDefault()
          // Clear saved mapping for this MileSplit division
          delete divisionMappings[currentDivision]
          storageApi.get(["divisionMappings"], (data) => {
            const mappings = data.divisionMappings || {}
            delete mappings[currentDivision]
            storageApi.set({ divisionMappings: mappings })
          })
          renderDivisionPicker(plan, currentDivision, currentEvent, totalEntries, completedCount)
        })
      }
    }

    const entries = plan.divisions[planDivision]?.[currentEvent]

    if (!entries || entries.length === 0) {
      panel.innerHTML = `
        <div class="ra-header">
          <h3>RaceApp Entries</h3>
          <div class="ra-subtitle">${subtitleHTML}</div>
        </div>
        <div class="ra-no-entries">
          <p><strong>No entries for this event</strong></p>
          <p>Click Save &amp; Continue to advance.</p>
        </div>
        <div class="ra-footer">
          <div class="ra-progress">Progress: ${completedCount}/${totalEntries} entries</div>
        </div>
      `
      wireChangeDivLink(panel)
      return
    }

    const checkboxes = getAllAthleteCheckboxes()
    const athleteMatches = []

    for (const name of entries) {
      const match = findBestMatch(name, checkboxes)
      athleteMatches.push({ name, match })
    }

    // Build athlete list HTML
    let athleteHTML = ""
    for (let i = 0; i < athleteMatches.length; i++) {
      const { name, match } = athleteMatches[i]
      const idx = i

      let matchHTML = ""
      if (!match || match.score === 0) {
        matchHTML = `
          <div class="ra-match ra-match-none">
            <span>No match found</span>
            <span class="ra-match-indicator">&cross;</span>
          </div>`
      } else if (match.score >= 90) {
        const alreadyChecked = match.checkbox.checked
        matchHTML = `
          <div class="ra-match ra-match-exact">
            <span>&rarr; ${esc(match.msName)}</span>
            <span class="ra-match-indicator">&check;</span>
          </div>
          ${alreadyChecked
            ? '<span class="ra-already-checked">Already entered</span>'
            : ""
          }`
      } else {
        matchHTML = `
          <div class="ra-match ra-match-fuzzy" data-idx="${idx}" title="Click to confirm this match">
            <span>&rarr; ${esc(match.msName)} <button class="ra-confirm-btn" data-idx="${idx}">Confirm</button></span>
            <span class="ra-match-indicator">?</span>
          </div>`
      }

      const alreadyChecked = match && match.score >= 90 && match.checkbox.checked
      const canCheck = match && match.score >= 90 && !alreadyChecked

      athleteHTML += `
        <div class="ra-athlete" data-idx="${idx}">
          <div class="ra-athlete-name">
            <span>${esc(name)}</span>
            ${canCheck
              ? `<button class="ra-check-btn" data-idx="${idx}">Check</button>`
              : alreadyChecked
                ? ""
                : `<button class="ra-check-btn" data-idx="${idx}" disabled>Check</button>`
            }
          </div>
          ${matchHTML}
        </div>`
    }

    const hasAutoCheckable = athleteMatches.some(
      (a) => a.match && a.match.score >= 90 && !a.match.checkbox.checked
    )

    const lastEventMsg = isLastEvent()
      ? "<p style='margin-top:6px; font-size:11px; color:#92400e;'>Last event in this division. Navigate to next division to continue.</p>"
      : ""

    panel.innerHTML = `
      <div class="ra-header">
        <h3>RaceApp Entries</h3>
        <div class="ra-subtitle">${subtitleHTML}</div>
      </div>
      <div class="ra-body">${athleteHTML}</div>
      <div class="ra-footer">
        <div class="ra-footer-btns">
          <button class="ra-btn-check-all" ${hasAutoCheckable ? "" : "disabled"}>
            Check All Matched
          </button>
        </div>
        <div class="ra-progress">Progress: ${completedCount}/${totalEntries} entries</div>
        ${lastEventMsg}
      </div>
    `

    wireChangeDivLink(panel)

    // Wire up individual check buttons
    panel.querySelectorAll(".ra-check-btn:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault()
        const idx = parseInt(btn.dataset.idx)
        const am = athleteMatches[idx]
        if (!am.match || am.match.checkbox.checked) return

        btn.disabled = true
        btn.textContent = "..."

        am.match.checkbox.click()
        await waitForLoaderDone()
        await sleep(300)

        btn.textContent = "Done"
        btn.classList.add("done")

        updateStats("checked", 1)
      })
    })

    // Wire up confirm buttons for fuzzy matches
    panel.querySelectorAll(".ra-confirm-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault()
        e.stopPropagation()
        const idx = parseInt(btn.dataset.idx)
        const am = athleteMatches[idx]
        if (!am.match) return

        // Upgrade to confirmed — enable the check button
        am.match.score = 90
        am.match.type = "exact"

        const athleteDiv = panel.querySelector(`.ra-athlete[data-idx="${idx}"]`)
        const checkBtn = athleteDiv.querySelector(".ra-check-btn")
        if (checkBtn) {
          checkBtn.disabled = false
        }

        // Update the match indicator
        const matchDiv = athleteDiv.querySelector(".ra-match-fuzzy")
        if (matchDiv) {
          matchDiv.className = "ra-match ra-match-exact"
          matchDiv.querySelector(".ra-match-indicator").innerHTML = "&check;"
          const confirmBtn = matchDiv.querySelector(".ra-confirm-btn")
          if (confirmBtn) confirmBtn.remove()
        }

        // Update check all button state
        const checkAllBtn = panel.querySelector(".ra-btn-check-all")
        if (checkAllBtn) {
          const anyCheckable = athleteMatches.some(
            (a) => a.match && a.match.score >= 90 && !a.match.checkbox.checked
          )
          checkAllBtn.disabled = !anyCheckable
        }
      })
    })

    // Wire up Check All Matched
    const checkAllBtn = panel.querySelector(".ra-btn-check-all")
    if (checkAllBtn) {
      checkAllBtn.addEventListener("click", async (e) => {
        e.preventDefault()
        checkAllBtn.disabled = true
        checkAllBtn.textContent = "Checking..."

        let checkedCount = 0
        for (let i = 0; i < athleteMatches.length; i++) {
          const am = athleteMatches[i]
          if (!am.match || am.match.score < 90 || am.match.checkbox.checked) continue

          const btn = panel.querySelector(
            `.ra-athlete[data-idx="${i}"] .ra-check-btn`
          )
          if (btn) {
            btn.disabled = true
            btn.textContent = "..."
          }

          am.match.checkbox.click()
          await waitForLoaderDone()
          await sleep(300)

          if (btn) {
            btn.textContent = "Done"
            btn.classList.add("done")
          }
          checkedCount++
        }

        checkAllBtn.textContent = `Checked ${checkedCount}`
        updateStats("checked", checkedCount)

        // Mark event as completed
        markEventCompleted(planDivision || currentDivision, currentEvent)
      })
    }

  }

  function showNoPlanPanel() {
    const panel = createPanel()
    panel.innerHTML = `
      <div class="ra-header">
        <h3>RaceApp Entries</h3>
        <div class="ra-subtitle">No plan loaded</div>
      </div>
      <div class="ra-no-entries">
        <p>Click the extension icon and paste your RaceApp JSON to get started.</p>
      </div>
    `
  }

  // =========================================
  // Storage helpers
  // =========================================

  function markEventCompleted(division, event) {
    storageApi.get(["completed"], (data) => {
      const completed = data.completed || {}
      completed[division + "::" + event] = true
      storageApi.set({ completed })
    })
  }

  function updateStats(field, increment) {
    storageApi.get(["stats"], (data) => {
      const stats = data.stats || { checked: 0, notFound: 0, skipped: 0 }
      if (field === "checked") stats.checked += increment
      else if (field === "notFound") stats.notFound += increment
      else if (field === "skipped") stats.skipped += increment
      storageApi.set({ stats })
    })
  }

  function countTotalEntries(plan) {
    let total = 0
    for (const div of Object.values(plan.divisions || {})) {
      for (const athletes of Object.values(div)) {
        total += athletes.length
      }
    }
    return total
  }

  function countCompletedEntries(plan, completed) {
    let count = 0
    for (const [divName, events] of Object.entries(plan.divisions || {})) {
      for (const [eventCode, athletes] of Object.entries(events)) {
        if (completed[divName + "::" + eventCode]) {
          count += athletes.length
        }
      }
    }
    return count
  }

  // =========================================
  // Main initialization
  // =========================================

  function init() {
    storageApi.get(["plan", "completed", "stats", "divisionMappings"], (data) => {
      divisionMappings = data.divisionMappings || {}
      if (!data.plan) {
        showNoPlanPanel()
        return
      }

      const plan = data.plan
      const completed = data.completed || {}
      const currentEvent = detectCurrentEvent()
      const currentDivision = detectCurrentDivision()

      if (!currentEvent || !currentDivision) {
        showNoPlanPanel()
        return
      }

      const totalEntries = countTotalEntries(plan)
      const completedEntries = countCompletedEntries(plan, completed)

      renderPanel(plan, currentDivision, currentEvent, totalEntries, completedEntries)
    })
  }

  // Run after a short delay to let MileSplit's JS initialize
  setTimeout(init, 1000)

  // Re-init when the event dropdown changes (MileSplit uses AJAX navigation)
  const eventSelect = document.querySelector("#event")
  if (eventSelect) {
    eventSelect.addEventListener("change", () => {
      setTimeout(init, 1500)
    })
  }
})()
