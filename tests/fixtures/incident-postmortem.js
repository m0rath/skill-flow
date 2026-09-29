// A large, nested skill used as a test fixture (it was the app's original built-in example).
export const EXAMPLE_MD = `---
name: incident-postmortem
description: Drafts a blameless postmortem from an incident ticket, chat export and alert logs. Use when the user asks to write up an incident, create a postmortem, or summarize an outage.
---
# Incident Postmortem

## Inputs
- Incident ticket ID or exported ticket JSON
- Slack or Teams channel export (optional)
- Alert log CSV from the monitoring system

## Workflow

### 1. Collect the incident record
Ask for the ticket ID if it was not provided. Fetch the ticket with \`scripts/fetch_ticket.py <id>\` and save it to \`work/ticket.json\`.

### 2. Classify severity
Read the \`severity\` field.
- If severity is SEV1 or SEV2, follow the full review path (steps 3-6).
- If severity is SEV3 or lower, fill \`templates/short_note.md\`, write \`output/note-<ticket-id>.md\` and skip to step 7.

### 3. Build the timeline
For each source (ticket comments, chat export, alert log):
1. Extract timestamped events.
2. Normalize times to UTC.
3. Append rows to \`work/timeline.csv\`.
If no chat export was provided, skip that source and note the gap.

### 4. Identify root cause and contributing factors
Use the 5 Whys technique. Read \`references/blameless-language.md\` before writing. Never name individuals; describe systems and decisions.

### 5. Draft action items
Write each action item with owner team, priority (P0-P2) and due date. When an action item has no clear owner, flag it as "Owner needed".

### 6. Assemble the document
Fill \`templates/postmortem.md\` and write \`output/postmortem-<ticket-id>.md\`. For SEV1 also create \`output/exec-summary.md\` (max 150 words).

### 7. Review with the user
Show the draft and ask for corrections. If the user requests changes, update the document and repeat this step. When approved, export to PDF with \`scripts/to_pdf.sh\`.

## Rules
- Times always in UTC.
- Keep the tone blameless.
`;
export const EXAMPLE_MODEL = {
  title: "incident-postmortem",
  summary: "Drafts a blameless postmortem from an incident ticket, chat export and alert logs.",
  trigger: "User asks to write up an incident, create a postmortem, or summarize an outage.",
  inputs: [
    "Incident ticket ID or exported ticket JSON",
    "Slack or Teams channel export (optional)",
    "Alert log CSV from the monitoring system",
  ],
  notes: ["All times in UTC.", "Keep the tone blameless: describe systems and decisions, never individuals."],
  steps: [
    {
      kind: "step",
      title: "Collect the incident record",
      detail: "Ask for the ticket ID if missing, then fetch the ticket with the helper script and save it locally.",
      creates: [{ name: "work/ticket.json", kind: "file" }],
      uses: ["scripts/fetch_ticket.py"],
      source: "Fetch the ticket with `scripts/fetch_ticket.py <id>` and save it to `work/ticket.json`.",
    },
    {
      kind: "decision",
      title: "Classify severity",
      question: "What is the incident severity?",
      detail: "The severity field decides between the full review and a short note.",
      uses: ["work/ticket.json"],
      source: "Read the `severity` field.",
      branches: [
        {
          label: "SEV1 or SEV2",
          steps: [
            {
              kind: "loop",
              title: "Build the timeline",
              over: "each source: ticket comments, chat export, alert log",
              detail: "Every source is processed the same way and appended to one timeline.",
              source: "For each source (ticket comments, chat export, alert log):",
              steps: [
                {
                  kind: "decision",
                  title: "Source available?",
                  question: "Was this source provided?",
                  source: "If no chat export was provided, skip that source and note the gap.",
                  branches: [
                    {
                      label: "Yes",
                      steps: [
                        {
                          kind: "step",
                          title: "Extract timestamped events",
                          detail: "Pull every event with a timestamp from the source.",
                          source: "Extract timestamped events.",
                        },
                        {
                          kind: "step",
                          title: "Normalize times to UTC",
                          detail: "Convert all timestamps to UTC.",
                          source: "Normalize times to UTC.",
                        },
                        {
                          kind: "step",
                          title: "Append rows to timeline",
                          detail: "Add the normalized events to the shared timeline CSV.",
                          creates: [{ name: "work/timeline.csv", kind: "file" }],
                          source: "Append rows to `work/timeline.csv`.",
                        },
                      ],
                    },
                    {
                      label: "No",
                      steps: [
                        {
                          kind: "step",
                          title: "Note the gap",
                          detail: "Skip the source and record that it was missing.",
                          source: "skip that source and note the gap",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              kind: "step",
              title: "Find root cause",
              detail:
                "Apply the 5 Whys to find root cause and contributing factors. Read the blameless language guide first.",
              uses: ["work/timeline.csv", "references/blameless-language.md"],
              source: "Use the 5 Whys technique. Read `references/blameless-language.md` before writing.",
            },
            {
              kind: "step",
              title: "Draft action items",
              detail:
                'Each action item gets an owner team, priority P0-P2 and a due date. Items without a clear owner are flagged "Owner needed".',
              creates: [{ name: "Action item list", kind: "data" }],
              source: "Write each action item with owner team, priority (P0-P2) and due date.",
            },
            {
              kind: "step",
              title: "Assemble the postmortem",
              detail: "Fill the postmortem template and write the final Markdown file.",
              creates: [{ name: "output/postmortem-<ticket-id>.md", kind: "file" }],
              uses: ["templates/postmortem.md", "Action item list"],
              source: "Fill `templates/postmortem.md` and write `output/postmortem-<ticket-id>.md`.",
            },
            {
              kind: "decision",
              title: "Executive summary needed?",
              question: "Is it SEV1?",
              source: "For SEV1 also create `output/exec-summary.md` (max 150 words).",
              branches: [
                {
                  label: "SEV1",
                  steps: [
                    {
                      kind: "step",
                      title: "Write executive summary",
                      detail: "A summary of at most 150 words.",
                      creates: [{ name: "output/exec-summary.md", kind: "file" }],
                      source: "For SEV1 also create `output/exec-summary.md` (max 150 words).",
                    },
                  ],
                },
                { label: "SEV2", steps: [] },
              ],
            },
          ],
        },
        {
          label: "SEV3 or lower",
          steps: [
            {
              kind: "step",
              title: "Write the short-form note",
              detail: "Fill the short note template instead of the full postmortem, then jump to review.",
              creates: [{ name: "output/note-<ticket-id>.md", kind: "file" }],
              uses: ["templates/short_note.md"],
              source: "fill `templates/short_note.md`, write `output/note-<ticket-id>.md` and skip to step 7.",
            },
          ],
        },
      ],
    },
    {
      kind: "loop",
      title: "Review with the user",
      over: "each round of feedback until approved",
      detail: "Show the draft, collect corrections and update until the user approves.",
      source: "If the user requests changes, update the document and repeat this step.",
      steps: [
        {
          kind: "step",
          title: "Show draft and ask for corrections",
          uses: ["output/postmortem-<ticket-id>.md"],
          source: "Show the draft and ask for corrections.",
        },
        {
          kind: "decision",
          title: "Approved?",
          question: "Did the user approve?",
          branches: [
            {
              label: "Changes requested",
              steps: [
                {
                  kind: "step",
                  title: "Update the document",
                  detail: "Apply the corrections, then repeat the review.",
                  source: "update the document and repeat this step",
                },
              ],
            },
            {
              label: "Approved",
              steps: [
                {
                  kind: "step",
                  title: "Export to PDF",
                  detail: "Convert the final document to PDF.",
                  uses: ["scripts/to_pdf.sh"],
                  creates: [{ name: "postmortem PDF", kind: "file" }],
                  source: "When approved, export to PDF with `scripts/to_pdf.sh`.",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
