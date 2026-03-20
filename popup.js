const browserApi = typeof browser !== "undefined" ? browser : chrome
const storageApi = browserApi.storage.local

// The scraper function that gets injected into the RaceApp event planner tab.
// It runs in the page context and returns the JSON payload.
function scrapeEventPlanner() {
  const RELAY_EVENTS = new Set(["4x100", "4x400", "4x800", "4x100m", "4x400m", "4x800m"])
  const EVENT_CODE_MAP = { "Shot": "S", "Discus": "D" }

  const gridBody = document.getElementById("event-grid-body")
  if (!gridBody) return { error: "No event grid found. Make sure you're on a RaceApp event planner page." }

  const meetName = document.querySelector(".print-title")?.textContent?.trim() || "Unknown Meet"
  const divisions = {}
  let currentDivision = null
  let skippedRelays = 0

  const rows = gridBody.querySelectorAll("tr")
  for (const row of rows) {
    if (row.classList.contains("division-header")) {
      currentDivision = row.dataset.division || "Unknown"
      continue
    }

    if (!row.classList.contains("athlete-row") || !currentDivision) continue

    const athleteName = row.dataset.athleteName
    if (!athleteName) continue

    const assignedCells = row.querySelectorAll("button.event-cell.assigned:not(.pending)")
    for (const cell of assignedCells) {
      const codeEl = cell.querySelector("strong.event-code")
      if (!codeEl) continue

      let eventCode = codeEl.textContent.trim()

      if (RELAY_EVENTS.has(eventCode)) {
        skippedRelays++
        continue
      }

      if (EVENT_CODE_MAP[eventCode]) {
        eventCode = EVENT_CODE_MAP[eventCode]
      }

      if (eventCode === "110H/100H" || eventCode === "100H/110H" || eventCode === "110H" || eventCode === "100H") {
        const divLower = currentDivision.toLowerCase()
        eventCode = divLower.includes("girl") || divLower.includes("women") ? "100H" : "110H"
      }

      if (!divisions[currentDivision]) divisions[currentDivision] = {}
      if (!divisions[currentDivision][eventCode]) divisions[currentDivision][eventCode] = []
      divisions[currentDivision][eventCode].push(athleteName)
    }
  }

  return {
    meet_name: meetName,
    divisions: divisions,
    skipped_relays: skippedRelays
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const loadView = document.getElementById("load-view")
  const planView = document.getElementById("plan-view")
  const jsonInput = document.getElementById("json-input")
  const loadBtn = document.getElementById("load-btn")
  const scrapeBtn = document.getElementById("scrape-btn")
  const loadError = document.getElementById("load-error")
  const clearBtn = document.getElementById("clear-btn")
  const pasteToggle = document.getElementById("paste-toggle")
  const pasteSection = document.getElementById("paste-section")

  function showError(msg) {
    loadError.textContent = msg
    loadError.className = "error"
    loadError.style.display = "block"
  }

  function hideError() {
    loadError.style.display = "none"
  }

  function countEntries(plan) {
    let total = 0
    for (const div of Object.values(plan.divisions || {})) {
      for (const athletes of Object.values(div)) {
        total += athletes.length
      }
    }
    return total
  }

  function loadPlan(parsed) {
    storageApi.set({
      plan: parsed,
      completed: {},
      stats: { checked: 0, notFound: 0, skipped: 0 }
    }, () => {
      storageApi.get(["plan", "completed", "stats"], (data) => {
        renderPlan(data)
      })
    })
  }

  function renderPlan(data) {
    const plan = data.plan
    if (!plan) {
      loadView.style.display = "block"
      planView.style.display = "none"
      return
    }

    loadView.style.display = "none"
    planView.style.display = "block"

    document.getElementById("meet-name").textContent = plan.meet_name || "Unknown Meet"
    document.getElementById("total-entries").textContent = countEntries(plan)
    document.getElementById("total-divisions").textContent = Object.keys(plan.divisions || {}).length

    const completed = data.completed || {}
    const stats = data.stats || { checked: 0, notFound: 0, skipped: 0 }

    document.getElementById("stat-checked").textContent = stats.checked
    document.getElementById("stat-not-found").textContent = stats.notFound
    document.getElementById("stat-skipped").textContent = stats.skipped

    const list = document.getElementById("division-list")
    list.innerHTML = ""

    for (const [divName, events] of Object.entries(plan.divisions || {})) {
      let divEntries = 0
      let divCompleted = 0
      let divTotal = 0
      for (const [eventCode, athletes] of Object.entries(events)) {
        divEntries += athletes.length
        divTotal++
        const key = divName + "::" + eventCode
        if (completed[key]) divCompleted++
      }

      const li = document.createElement("li")
      li.innerHTML = `
        <span class="division-name">${divName}</span>
        <span class="division-count">
          ${divCompleted}/${divTotal} events
          ${divCompleted === divTotal ? '<span class="check">&check;</span>' : ""}
          &middot; ${divEntries} entries
        </span>
      `
      list.appendChild(li)
    }
  }

  // Load existing plan on popup open
  storageApi.get(["plan", "completed", "stats"], (data) => {
    renderPlan(data)
  })

  // Scrape from active RaceApp tab
  scrapeBtn.addEventListener("click", async () => {
    hideError()
    scrapeBtn.disabled = true
    scrapeBtn.textContent = "Scraping..."

    try {
      const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true })

      if (!tab) {
        showError("No active tab found.")
        scrapeBtn.disabled = false
        scrapeBtn.textContent = "Scrape from RaceApp Tab"
        return
      }

      const results = await browserApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeEventPlanner
      })

      const result = results?.[0]?.result
      if (!result) {
        showError("Scraping returned no data. Is the event planner page open?")
        scrapeBtn.disabled = false
        scrapeBtn.textContent = "Scrape from RaceApp Tab"
        return
      }

      if (result.error) {
        showError(result.error)
        scrapeBtn.disabled = false
        scrapeBtn.textContent = "Scrape from RaceApp Tab"
        return
      }

      if (!result.divisions || Object.keys(result.divisions).length === 0) {
        showError("No event assignments found. Are athletes assigned to events?")
        scrapeBtn.disabled = false
        scrapeBtn.textContent = "Scrape from RaceApp Tab"
        return
      }

      loadPlan(result)
    } catch (err) {
      showError("Could not access tab: " + err.message)
      scrapeBtn.disabled = false
      scrapeBtn.textContent = "Scrape from RaceApp Tab"
    }
  })

  // Toggle paste section
  pasteToggle.addEventListener("click", () => {
    const visible = pasteSection.style.display === "block"
    pasteSection.style.display = visible ? "none" : "block"
    pasteToggle.textContent = visible ? "Paste JSON manually" : "Hide paste"
  })

  // Load from pasted JSON
  loadBtn.addEventListener("click", () => {
    hideError()
    const raw = jsonInput.value.trim()
    if (!raw) {
      showError("Paste the JSON first.")
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      showError("Invalid JSON: " + e.message)
      return
    }

    if (!parsed.divisions || typeof parsed.divisions !== "object") {
      showError("Missing or invalid 'divisions' in JSON.")
      return
    }

    loadPlan(parsed)
  })

  // Copy plan JSON to clipboard
  document.getElementById("copy-json-btn").addEventListener("click", () => {
    storageApi.get(["plan"], (data) => {
      if (!data.plan) return
      const json = JSON.stringify(data.plan, null, 2)
      navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById("copy-json-btn")
        btn.textContent = "Copied!"
        setTimeout(() => { btn.textContent = "Copy JSON" }, 1500)
      })
    })
  })

  clearBtn.addEventListener("click", () => {
    storageApi.remove(["plan", "completed", "stats", "divisionMappings"], () => {
      jsonInput.value = ""
      loadView.style.display = "block"
      planView.style.display = "none"
      hideError()
      scrapeBtn.disabled = false
      scrapeBtn.textContent = "Scrape from RaceApp Tab"
    })
  })
})
