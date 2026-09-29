// The skill shown on first visit. It is small but real, and each step shows off one feature of the app.
// Step 4 has a deliberate gap (no "otherwise" case) so the Suggestions tab has something to show.

export const EXAMPLE_MD = `---
name: pr-review
description: Reviews a pull request and writes clear, actionable feedback. Use when the user asks to review a PR, a diff or a branch.
---
# PR Review

## Inputs
- Pull request URL or a pasted diff
- Team style guide

## Workflow

### 1. Get the changes
Fetch the diff with \`scripts/get_diff.sh <pr>\` and save it to \`work/changes.diff\`. If the script fails, ask the user to paste the diff instead.

### 2. Check the size
- If the diff is over 500 lines, ask the author to split the PR and stop.
- Otherwise, continue with the review.

### 3. Review each changed file
For each file in \`work/changes.diff\`:
1. Check correctness and edge cases.
2. Check naming and style against the style guide.
3. Add findings to \`work/findings.md\`.

### 4. Check the tests
If the PR changes behaviour, confirm there are tests that cover it.

### 5. Write the review
Group findings into "must fix", "should fix" and "nit". Write \`output/review.md\` with a one-line summary at the top.

## Rules
- Quote the line you are commenting on and suggest a fix.
- Review the code, not the person.
`;

export const EXAMPLE_MODEL = {
  title: "pr-review",
  summary: "Reviews a pull request and writes clear, actionable feedback.",
  trigger: "User asks to review a PR, a diff or a branch.",
  inputs: ["Pull request URL or a pasted diff", "Team style guide"],
  notes: ["Quote the line you are commenting on and suggest a fix.", "Review the code, not the person."],
  steps: [
    {
      kind: "step",
      title: "Get the changes",
      detail:
        "Fetch the diff with the helper script and save it. If the script fails, ask the user to paste the diff. Try it: press → to walk through the steps in order.",
      creates: [{ name: "work/changes.diff", kind: "file" }],
      uses: ["scripts/get_diff.sh"],
      source: "Fetch the diff with `scripts/get_diff.sh <pr>` and save it to `work/changes.diff`.",
    },
    {
      kind: "decision",
      title: "Check the size",
      question: "Is the diff over 500 lines?",
      detail:
        "Big PRs are hard to review well, so they go back to the author. Try it: a decision gets one lane per outcome. Use the fold button to collapse it.",
      uses: ["work/changes.diff"],
      source: "If the diff is over 500 lines, ask the author to split the PR and stop.",
      branches: [
        {
          label: "Over 500 lines",
          steps: [
            {
              kind: "stop",
              title: "Ask the author to split the PR",
              detail: "The review ends here.",
              source: "ask the author to split the PR and stop",
            },
          ],
        },
        {
          label: "500 lines or fewer",
          steps: [
            {
              kind: "step",
              title: "Continue with the review",
              source: "Otherwise, continue with the review.",
            },
          ],
        },
      ],
    },
    {
      kind: "loop",
      title: "Review each changed file",
      over: "each file in work/changes.diff",
      detail:
        "The same checks run for every file. Try it: open the Mind map tab to see how work/changes.diff and work/findings.md link the steps together.",
      uses: ["work/changes.diff"],
      source: "For each file in `work/changes.diff`:",
      steps: [
        {
          kind: "step",
          title: "Check correctness and edge cases",
          source: "Check correctness and edge cases.",
        },
        {
          kind: "step",
          title: "Check naming and style",
          detail: "Compare against the team style guide.",
          uses: ["Team style guide"],
          source: "Check naming and style against the style guide.",
        },
        {
          kind: "step",
          title: "Add findings",
          creates: [{ name: "work/findings.md", kind: "file" }],
          source: "Add findings to `work/findings.md`.",
        },
      ],
    },
    {
      kind: "decision",
      title: "Check the tests",
      question: "Does the PR change behaviour?",
      detail:
        'The file only says what to do if behaviour changes, not what to do otherwise. Try it: open the Suggestions tab to see this gap, then click "Fix in file" (needs an API key).',
      source: "If the PR changes behaviour, confirm there are tests that cover it.",
      branches: [
        {
          label: "Behaviour changes",
          steps: [
            {
              kind: "step",
              title: "Confirm tests cover it",
              source: "confirm there are tests that cover it",
            },
          ],
        },
      ],
    },
    {
      kind: "step",
      title: "Write the review",
      detail:
        'Group findings into "must fix", "should fix" and "nit", with a one-line summary at the top. Try it: edit the text in the Source tab and watch the diagram update, then download the result.',
      uses: ["work/findings.md"],
      creates: [{ name: "output/review.md", kind: "file" }],
      source: "Write `output/review.md` with a one-line summary at the top.",
    },
  ],
};
