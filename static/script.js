/* =========================================================
   LIVING ATLAS — TRIPMATE AI
   Frontend logic for the FastAPI + LangGraph travel planner
   ========================================================= */

let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;


/* =========================================================
   AGENT LABELS
   ========================================================= */

const AGENT_LABELS = {
  flight_agent: "✈️ Flight Agent",
  hotel_agent: "🏨 Hotel Agent",
  weather_agent: "🌦️ Weather Agent",
  budget_agent: "💰 Budget Agent",
  itinerary_agent: "🗓️ Itinerary Agent",
  sightseeing_agent: "🗺️ Sightseeing Agent",
  transport_agent: "🚆 Transport Agent"
};


/* =========================================================
   QUICK PROMPTS
   ========================================================= */

function setPrompt(text) {
  const input = document.getElementById("userInput");

  if (!input) return;

  input.value = text;
  input.focus();
}


/* =========================================================
   LOADING STATE
   ========================================================= */

function setLoading(isLoading, mode = "draft") {
  const sendBtn = document.getElementById("sendBtn");
  const btnText = document.getElementById("btnText");
  const btnLoader = document.getElementById("btnLoader");

  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");

  if (sendBtn) {
    sendBtn.disabled = isLoading;
  }

  if (approveBtn) {
    approveBtn.disabled = isLoading;
  }

  if (reviseBtn) {
    reviseBtn.disabled = isLoading;
  }

  if (mode === "draft") {
    if (btnText) {
      btnText.classList.toggle("hidden", isLoading);
    }

    if (btnLoader) {
      btnLoader.classList.toggle("hidden", !isLoading);
    }
  }
}


/* =========================================================
   ERROR HANDLING
   ========================================================= */

function showError(message) {
  const errorBox = document.getElementById("errorBox");

  if (!errorBox) {
    console.error(message);
    return;
  }

  errorBox.textContent = message;
  errorBox.classList.remove("hidden");

  errorBox.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}


function hideError() {
  const errorBox = document.getElementById("errorBox");

  if (!errorBox) return;

  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}


/* =========================================================
   MARKDOWN RENDERING
   ========================================================= */

function renderMarkdown(element, markdown) {
  if (!element) return;

  if (typeof marked !== "undefined") {
    element.innerHTML = marked.parse(markdown || "");
  } else {
    element.textContent = markdown || "";
  }
}


/* =========================================================
   AGENT NAME NORMALIZATION
   ========================================================= */

function normalizeAgentName(agent) {
  if (typeof agent === "string") {
    return agent.trim();
  }

  if (agent && typeof agent === "object") {
    return (
      agent.name ||
      agent.agent_name ||
      agent.id ||
      agent.agent ||
      ""
    ).toString().trim();
  }

  return "";
}


function getAgentLabel(agentName) {
  const key = agentName
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return (
    AGENT_LABELS[key] ||
    agentName
      .replace(/_/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase())
  );
}


/* =========================================================
   SUPERVISOR WORKFLOW
   ========================================================= */

function showWorkflow(data = {}) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  if (!section || !reasoning || !chips || !guardrailBadge) {
    console.error(
      "Supervisor panel elements are missing. Check index.html element IDs."
    );
    return;
  }

  /*
   * Support different possible response field names.
   */

  const supervisorText =
    data.supervisor_reasoning ??
    data.execution_plan ??
    data.supervisor_message ??
    data.reasoning ??
    data.supervisor?.reasoning ??
    data.supervisor?.execution_plan ??
    null;


  const selectedAgents =
    data.selected_agents ??
    data.agents_selected ??
    data.selectedAgents ??
    data.supervisor?.selected_agents ??
    data.supervisor?.agents ??
    null;


  const guardrailAllowed =
    data.guardrail_allowed ??
    data.guardrail_passed ??
    data.guardrails_passed ??
    data.guardrail?.allowed ??
    data.guardrail?.passed ??
    null;


  /*
   * Display supervisor reasoning.
   */

  reasoning.textContent =
    typeof supervisorText === "string" && supervisorText.trim()
      ? supervisorText
      : "The supervisor execution plan was not included in the API response.";


  /*
   * Display selected agents.
   */

  chips.replaceChildren();

  let agents = [];

  if (Array.isArray(selectedAgents)) {
    agents = selectedAgents;

  } else if (typeof selectedAgents === "string") {
    agents = selectedAgents.split(",");

  } else if (
    selectedAgents &&
    typeof selectedAgents === "object"
  ) {
    agents = Object.keys(selectedAgents).filter(
      key => selectedAgents[key]
    );
  }


  agents
    .map(normalizeAgentName)
    .filter(Boolean)
    .forEach(agentName => {
      const chip = document.createElement("button");

      chip.type = "button";
      chip.className = "agent-chip";
      chip.textContent = getAgentLabel(agentName);
      chip.disabled = true;

      chip.setAttribute(
        "aria-label",
        getAgentLabel(agentName)
      );

      chips.appendChild(chip);
    });


  /*
   * Display an informative message if no agents were returned.
   */

  if (agents.length === 0) {
    const message = document.createElement("span");

    message.className = "agent-empty-message";
    message.textContent =
      "No selected agents were returned by the backend.";

    chips.appendChild(message);
  }


  /*
   * Display guardrail status.
   * Only show passed/blocked when the backend confirms it.
   */

  guardrailBadge.classList.remove("blocked");

  if (guardrailAllowed === true) {
    guardrailBadge.textContent = "Guardrail passed";

  } else if (guardrailAllowed === false) {
    guardrailBadge.textContent = "Guardrail blocked";
    guardrailBadge.classList.add("blocked");

  } else {
    guardrailBadge.textContent = "Guardrail status unavailable";
  }


  section.classList.remove("hidden");
}


/* =========================================================
   DISPLAY TRAVEL RESULT
   ========================================================= */

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");


  /*
   * Render the itinerary.
   */

  renderMarkdown(resultBox, latestAnswerMarkdown);


  /*
   * Display thread information.
   */

  if (threadInfo) {
    threadInfo.textContent = `Thread ID: ${threadId || "-"}`;
  }


  /*
   * Update result title.
   */

  if (resultTitle) {
    resultTitle.textContent = isDraft
      ? "Draft Travel Plan"
      : "Your Final AI Travel Plan";
  }


  /*
   * Show the result section.
   */

  if (resultSection) {
    resultSection.classList.remove("hidden");

    resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}


/* =========================================================
   HUMAN-IN-THE-LOOP APPROVAL
   ========================================================= */

function showApproval(data = {}) {
  waitingForApproval = true;

  const section = document.getElementById("approvalSection");
  const approvalRequest = document.getElementById("approvalRequest");

  if (approvalRequest) {
    approvalRequest.textContent =
      data.approval_request ||
      "Review the draft, approve it, or provide feedback before generating the final plan.";
  }

  if (section) {
    section.classList.remove("hidden");
  }
}


function hideApproval() {
  waitingForApproval = false;

  const section = document.getElementById("approvalSection");
  const feedback = document.getElementById("approvalFeedback");

  if (section) {
    section.classList.add("hidden");
  }

  if (feedback) {
    feedback.value = "";
  }
}


/* =========================================================
   API RESPONSE HANDLER
   ========================================================= */

async function readApiResponse(response) {
  let data;

  try {
    data = await response.json();

  } catch {
    throw new Error(
      "The server returned an invalid response. Please try again."
    );
  }


  if (!response.ok || !data.success) {
    throw new Error(
      data.error ||
      `Request failed with status ${response.status}.`
    );
  }

  return data;
}


/* =========================================================
   GENERATE TRAVEL PLAN
   API: POST /api/travel
   ========================================================= */

async function sendMessage() {
  hideError();


  /*
   * Prevent a new request while a draft is awaiting approval.
   */

  if (waitingForApproval) {
    showError(
      "Please approve or revise the current draft before starting another plan."
    );

    return;
  }


  const input = document.getElementById("userInput");

  if (!input) {
    showError("The travel planner input could not be found.");
    return;
  }


  const message = input.value.trim();


  /*
   * Validate user input.
   */

  if (!message) {
    showError("Please enter your travel request first.");
    input.focus();

    return;
  }


  setLoading(true, "draft");


  try {
    const response = await fetch("/api/travel", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        message: message,
        thread_id: currentThreadId
      })
    });


    const data = await readApiResponse(response);


    /*
     * Update thread ID.
     */

    currentThreadId = data.thread_id || currentThreadId;


    if (currentThreadId) {
      localStorage.setItem(
        "travel_thread_id",
        currentThreadId
      );
    }


    /*
     * Display supervisor execution details.
     */

    showWorkflow(data);


    /*
     * Handle approval workflow.
     */

    if (data.requires_approval) {
      showResult(
        data.itinerary || data.answer || "",
        currentThreadId,
        true
      );

      showApproval(data);

    } else {
      hideApproval();

      showResult(
        data.answer || data.itinerary || "",
        currentThreadId,
        false
      );
    }

  } catch (error) {
    console.error("Travel planning error:", error);

    showError(
      error.message || "Could not generate the travel plan."
    );

  } finally {
    setLoading(false, "draft");
  }
}


/* =========================================================
   APPROVE OR REVISE THE DRAFT
   API: POST /api/travel/approve
   ========================================================= */

async function submitApproval(approved) {
  hideError();


  /*
   * Check whether a draft is waiting.
   */

  if (!currentThreadId || !waitingForApproval) {
    showError("There is no draft waiting for approval.");

    return;
  }


  const feedbackInput = document.getElementById("approvalFeedback");

  const feedback = feedbackInput
    ? feedbackInput.value.trim()
    : "";


  /*
   * Revision requires feedback.
   */

  if (!approved && !feedback) {
    showError(
      "Please enter revision feedback before requesting changes."
    );

    if (feedbackInput) {
      feedbackInput.focus();
    }

    return;
  }


  setLoading(true, "approval");


  try {
    const response = await fetch("/api/travel/approve", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });


    const data = await readApiResponse(response);


    /*
     * Update thread ID.
     */

    currentThreadId = data.thread_id || currentThreadId;


    if (currentThreadId) {
      localStorage.setItem(
        "travel_thread_id",
        currentThreadId
      );
    }


    /*
     * Update workflow and display the final result.
     */

    showWorkflow(data);

    hideApproval();

    showResult(
      data.answer || data.itinerary || "",
      currentThreadId,
      false
    );

  } catch (error) {
    console.error("Approval workflow error:", error);

    showError(
      error.message || "Could not resume the travel workflow."
    );

  } finally {
    setLoading(false, "approval");
  }
}


/* =========================================================
   COPY TRAVEL PLAN
   ========================================================= */

async function copyResult() {
  const resultBox = document.getElementById("resultBox");

  const text = resultBox
    ? resultBox.innerText
    : "";


  if (!text) {
    showError("There is no travel plan to copy.");

    return;
  }


  try {
    await navigator.clipboard.writeText(text);


    /*
     * Temporarily update the copy button.
     */

    const copyBtn = document.querySelector(".copy-btn");

    if (copyBtn) {
      const oldText = copyBtn.textContent;

      copyBtn.textContent = "Copied!";


      setTimeout(() => {
        copyBtn.textContent = oldText;
      }, 1400);
    }

  } catch (error) {
    console.error("Clipboard error:", error);

    showError(
      "Could not copy result. Check browser clipboard permissions."
    );
  }
}


/* =========================================================
   DOWNLOAD TRAVEL PLAN AS PDF
   ========================================================= */

function downloadPDF() {
  const pdfContent = document.getElementById("pdfContent");


  /*
   * Validate PDF content.
   */

  if (!latestAnswerMarkdown || !pdfContent) {
    showError("No travel plan available to download.");

    return;
  }


  /*
   * Check whether html2pdf loaded.
   */

  if (typeof html2pdf === "undefined") {
    showError(
      "The PDF library did not load. Refresh the page and try again."
    );

    return;
  }


  const downloadBtn = document.querySelector(".download-btn");

  const oldText = downloadBtn
    ? downloadBtn.textContent
    : "Download PDF";


  if (downloadBtn) {
    downloadBtn.textContent = "Preparing PDF...";
    downloadBtn.disabled = true;
  }


  /*
   * PDF configuration.
   */

  const options = {
    margin: 0.5,

    filename: "ai-travel-plan.pdf",

    image: {
      type: "jpeg",
      quality: 0.98
    },

    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff"
    },

    jsPDF: {
      unit: "in",
      format: "a4",
      orientation: "portrait"
    },

    pagebreak: {
      mode: ["avoid-all", "css", "legacy"]
    }
  };


  /*
   * Generate and save the PDF.
   */

  html2pdf()
    .set(options)
    .from(pdfContent)
    .save()

    .then(() => {
      console.log("PDF downloaded successfully.");
    })

    .catch(error => {
      console.error("PDF generation failed:", error);

      showError("Could not download PDF.");
    })

    .finally(() => {
      if (downloadBtn) {
        downloadBtn.textContent = oldText;
        downloadBtn.disabled = false;
      }
    });
}


/* =========================================================
   KEYBOARD SHORTCUT
   Ctrl + Enter = Generate Travel Plan
   ========================================================= */

document.addEventListener("keydown", function(event) {
  if (
    event.ctrlKey &&
    event.key === "Enter"
  ) {
    event.preventDefault();

    sendMessage();
  }
});